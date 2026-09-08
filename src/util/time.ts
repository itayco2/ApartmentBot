export interface QuietHours {
  startMinutes: number;
  endMinutes: number;
}

/** Accepts "23:00-07:30"; returns null when the text is not a valid window. */
export function parseQuietHours(raw: string): QuietHours | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!match) return null;

  const [, sh, sm, eh, em] = match;
  const startMinutes = Number(sh) * 60 + Number(sm);
  const endMinutes = Number(eh) * 60 + Number(em);

  const valid = (v: number, h: string | undefined, m: string | undefined) =>
    Number(h) < 24 && Number(m) < 60 && v >= 0;
  if (!valid(startMinutes, sh, sm) || !valid(endMinutes, eh, em)) return null;
  if (startMinutes === endMinutes) return null;

  return { startMinutes, endMinutes };
}

export function formatQuietHours(window: QuietHours): string {
  return `${toClock(window.startMinutes)}-${toClock(window.endMinutes)}`;
}

/** Windows normally wrap past midnight, so both orderings are handled. */
export function isWithinQuietHours(window: QuietHours, at: Date = new Date()): boolean {
  const minutes = at.getHours() * 60 + at.getMinutes();
  const { startMinutes, endMinutes } = window;

  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

/**
 * Reads the date wording Israeli boards use: "היום", "אתמול",
 * "לפני 3 ימים", "10/08/2023", or an ISO timestamp.
 *
 * Returns null when the text carries no date, which callers must treat as
 * "age unknown" rather than "fresh".
 */
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const HEBREW_DAY_MONTH = new RegExp(`(\\d{1,2})\\s+ב(${HEBREW_MONTHS.join('|')})`);

export function parsePostedDate(raw: string | null | undefined, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (/היום|today/i.test(text)) return now;
  if (/אתמול|yesterday/i.test(text)) return daysAgo(now, 1);

  const relativeDays = /לפני\s+(\d+)\s*(?:ימים|יום)/.exec(text);
  if (relativeDays?.[1]) return daysAgo(now, Number(relativeDays[1]));

  const relativeWeeks = /לפני\s+(\d+)\s*(?:שבועות|שבוע)/.exec(text);
  if (relativeWeeks?.[1]) return daysAgo(now, Number(relativeWeeks[1]) * 7);

  const relativeMonths = /לפני\s+(\d+)\s*(?:חודשים|חודש)/.exec(text);
  if (relativeMonths?.[1]) return daysAgo(now, Number(relativeMonths[1]) * 30);

  if (/לפני\s+\S*\s*(?:שעה|שעות|דקה|דקות)/.test(text)) return now;

  // Facebook stamps a post "15 באוגוסט ב-22:14": the year is implied, and is
  // the latest one in which that day has already happened.
  const dayMonth = HEBREW_DAY_MONTH.exec(text);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = HEBREW_MONTHS.indexOf(dayMonth[2]!);
    const thisYear = new Date(now.getFullYear(), month, day);
    return thisYear.getTime() > now.getTime() + 86_400_000
      ? new Date(now.getFullYear() - 1, month, day)
      : thisYear;
  }

  // Israeli boards write day-first, so 10/08/2023 is 10 August 2023.
  const dmy = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(text);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = Date.parse(text);
  return Number.isNaN(iso) ? null : new Date(iso);
}

/**
 * Reads a move-in date as ads write it: "מיידי", "1.10", "15/3/2027",
 * "אמצע אוקטובר". A day and month with no year is the next such date; a
 * bare month with a position word is its 1st, 15th or 28th. Null when the
 * text carries no date ("גמיש").
 */
export function parseEntryDate(raw: string | null | undefined, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (/מי+די|immediate/i.test(text)) return now;

  const full = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  if (full) {
    const year = full[3]!.length === 2 ? 2000 + Number(full[3]) : Number(full[3]);
    const date = new Date(year, Number(full[2]) - 1, Number(full[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayMonth = /(\d{1,2})[./](\d{1,2})(?![./\d])/.exec(text);
  if (dayMonth) {
    return nextOccurrence(Number(dayMonth[2]) - 1, Number(dayMonth[1]), now);
  }

  // "15 באוקטובר" states a day; it must win over the bare-month reading.
  const dayNamed = HEBREW_DAY_MONTH.exec(text);
  if (dayNamed) {
    return nextOccurrence(HEBREW_MONTHS.indexOf(dayNamed[2]!), Number(dayNamed[1]), now);
  }

  const named = new RegExp(`(תחילת|אמצע|סוף)?\\s*ב?(${HEBREW_MONTHS.join('|')})`).exec(text);
  if (named) {
    const day = named[1] === 'אמצע' ? 15 : named[1] === 'סוף' ? 28 : 1;
    return nextOccurrence(HEBREW_MONTHS.indexOf(named[2]!), day, now);
  }

  return null;
}

/** The next date with this month and day, counting today as "next". */
function nextOccurrence(month: number, day: number, now: Date): Date | null {
  const candidate = new Date(now.getFullYear(), month, day);
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate.getTime() < now.getTime() - 86_400_000
    ? new Date(now.getFullYear() + 1, month, day)
    : candidate;
}

export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function toClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
