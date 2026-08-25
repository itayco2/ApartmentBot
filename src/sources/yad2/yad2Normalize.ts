import { z } from 'zod';
import type { Listing } from '../../core/types.js';

const ITEM_BASE = 'https://www.yad2.co.il/realestate/item';

const markerSchema = z.object({
  token: z.string().min(1),
  price: z.number().nullish(),
  adType: z.string().nullish(),
  address: z
    .object({
      city: z.object({ text: z.string().nullish() }).nullish(),
      neighborhood: z.object({ text: z.string().nullish() }).nullish(),
      street: z.object({ text: z.string().nullish() }).nullish(),
      house: z.object({ number: z.number().nullish(), floor: z.number().nullish() }).nullish(),
    })
    .nullish(),
  additionalDetails: z
    .object({
      property: z.object({ text: z.string().nullish() }).nullish(),
      roomsCount: z.number().nullish(),
      squareMeter: z.number().nullish(),
    })
    .nullish(),
  metaData: z
    .object({
      coverImage: z.string().nullish(),
      images: z.array(z.string()).nullish(),
    })
    .nullish(),
  tags: z.array(z.object({ name: z.string().nullish() }).passthrough()).nullish(),
});

export const yad2MapSchema = z.object({
  data: z
    .object({
      // Everything else in the payload is paid placement or map furniture.
      markers: z.array(z.unknown()).default([]),
    })
    .nullish(),
  markers: z.array(z.unknown()).nullish(),
});

/**
 * Yad2's rental feed also carries storage units, parking spaces and business
 * premises. None of them are somewhere to live, so they are dropped rather
 * than alerted on.
 */
const NON_RESIDENTIAL = /מחסן|חניה|חנייה|משרד|חנות|מסחרי|קליניקה|מבנה|מגרש|תעשי/;

/** Israel runs UTC+3 in summer; the stamps are written in local time. */
const ISRAEL_UTC_OFFSET_HOURS = 3;

/**
 * Recovers a posting date from a photo URL.
 *
 * Yad2's API publishes no date field anywhere, but its images live under a
 * path that encodes when they were uploaded, which happens within minutes of
 * the ad going live (checked against Realta's publish times: consistently 3-7
 * minutes apart). It is the only way to apply "posted in the last 30 days" to
 * the largest source.
 *
 * Three shapes, in decreasing precision:
 *   .../y2_1pa_010595_20260816161412.jpeg   second precision
 *   .../y2_1pa_010595_20260816.jpeg         day precision (agency bulk uploads)
 *   .../Pic/202608/16/...                   day precision, from the path itself
 */
export function dateFromImageUrl(url: string | null | undefined): Date | undefined {
  const text = url ?? '';
  if (!text) return undefined;

  const toDate = (iso: string): Date | undefined => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    const year = date.getFullYear();
    return year >= 2015 && date.getTime() <= Date.now() + 86_400_000 ? date : undefined;
  };
  const utc = (parts: string[]) =>
    `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3] ?? '00'}:${parts[4] ?? '00'}:${parts[5] ?? '00'}` +
    `+0${ISRAEL_UTC_OFFSET_HOURS}:00`;

  const second = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(?:jpe?g|png|webp)/i.exec(text);
  if (second) return toDate(utc(second.slice(1)));

  const day = /_(\d{4})(\d{2})(\d{2})\.(?:jpe?g|png|webp)/i.exec(text);
  if (day) return toDate(utc(day.slice(1)));

  const path = /\/Pic\/(\d{4})(\d{2})\/(\d{2})\//.exec(text);
  if (path) return toDate(utc([path[1]!, path[2]!, path[3]!]));

  return undefined;
}

/**
 * The earliest photo, which is when the ad first went up - a listing edited
 * later carries newer photos alongside the originals.
 */
function earliestImageDate(urls: string[]): Date | undefined {
  const dates = urls.map(dateFromImageUrl).filter((d): d is Date => d !== undefined);
  if (dates.length === 0) return undefined;
  return dates.reduce((earliest, d) => (d < earliest ? d : earliest));
}

/**
 * Parses the raw response body. A non-JSON body is a challenge page served
 * with HTTP 200 - that is a failure the health tracker must hear about, not an
 * empty city.
 */
export function parseYad2Body(body: string, fallbackCity: string): Listing[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('yad2 returned a non-JSON body');
  }
  return parseYad2Markers(payload, fallbackCity);
}

export function parseYad2Markers(payload: unknown, fallbackCity: string): Listing[] {
  const outer = yad2MapSchema.safeParse(payload);
  if (!outer.success) return [];

  const markers = outer.data.data?.markers ?? outer.data.markers ?? [];
  const listings: Listing[] = [];

  for (const raw of markers) {
    const parsed = markerSchema.safeParse(raw);
    // One odd marker must not discard the rest of the city.
    if (!parsed.success) continue;

    const m = parsed.data;
    const propertyType = m.additionalDetails?.property?.text ?? undefined;
    if (propertyType && NON_RESIDENTIAL.test(propertyType)) continue;

    const images = [m.metaData?.coverImage, ...(m.metaData?.images ?? [])].filter(
      (u): u is string => typeof u === 'string' && u.startsWith('https://'),
    );
    const postedAt = earliestImageDate(images);

    const street = m.address?.street?.text ?? null;
    const houseNumber = m.address?.house?.number ?? null;
    const address = street ? `${street}${houseNumber ? ` ${houseNumber}` : ''}` : undefined;
    const floor = m.address?.house?.floor;

    listings.push({
      source: 'yad2',
      sourceId: m.token,
      url: `${ITEM_BASE}/${m.token}`,
      price: typeof m.price === 'number' && m.price > 0 ? Math.round(m.price) : null,
      rooms: m.additionalDetails?.roomsCount ?? null,
      city: m.address?.city?.text ?? fallbackCity,
      ...(m.address?.neighborhood?.text ? { neighborhood: m.address.neighborhood.text } : {}),
      ...(address ? { address } : {}),
      ...(propertyType ? { propertyType } : {}),
      ...(m.additionalDetails?.squareMeter ? { sqm: m.additionalDetails.squareMeter } : {}),
      ...(typeof floor === 'number'
        ? { floor: floor === 0 ? 'קומת קרקע' : `קומה ${floor}` }
        : {}),
      amenities: (m.tags ?? [])
        .map((t) => t.name)
        .filter((n): n is string => Boolean(n))
        .slice(0, 6),
      // coverImage is the photo Yad2 itself leads with; images[] is the gallery.
      imageUrls: images.slice(0, 1),
      ...(postedAt ? { postedAt } : {}),
      originalSource: 'יד2',
      // Yad2 labels by-owner ads "private" and agency ads "commercial".
      ...(m.adType ? { isBroker: m.adType !== 'private' } : {}),
    });
  }

  return listings;
}
