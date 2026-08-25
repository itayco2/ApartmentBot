import * as cheerio from 'cheerio';
import type { Listing } from '../../core/types.js';

const BASE = 'https://www.homeless.co.il';

/**
 * Each result card carries a comma-separated summary in its title attribute:
 *   "דירה,3,מודיעין מכבים רעות,נחל ירקון,נחל הירקון 5,2,85, "
 *    type ,rooms, city                 , neighborhood, street, floor, sqm
 * It is far more reliable to read than the surrounding markup, which mixes
 * &nbsp; and <br> between every field.
 */
const TITLE_FIELDS = ['type', 'rooms', 'city', 'neighborhood', 'street', 'floor', 'sqm'] as const;

export function parseHomelessListings(html: string): Listing[] {
  const $ = cheerio.load(html);
  const listings: Listing[] = [];

  $('a[href*="/rent/viewad,"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href') ?? '';
    const id = /viewad,(\d+)/.exec(href)?.[1];
    if (!id) return;
    // The mobile feed repeats a card in the "hot" strip and the main list.
    if (listings.some((l) => l.sourceId === id)) return;

    const fields = splitTitle(anchor.attr('title') ?? '');
    if (!fields.city) return;

    const card = anchor.closest('section, div.image-carousel');
    const price = parsePrice(card.text());

    listings.push({
      source: 'homeless',
      sourceId: id,
      url: `${BASE}/rent/viewad,${id}.aspx`,
      price,
      rooms: parseNumber(fields.rooms),
      city: fields.city,
      ...(fields.neighborhood ? { neighborhood: fields.neighborhood } : {}),
      ...(fields.street ? { address: fields.street } : {}),
      ...(fields.type ? { propertyType: fields.type } : {}),
      ...(parseNumber(fields.sqm) !== null ? { sqm: parseNumber(fields.sqm) as number } : {}),
      ...(formatFloor(fields.floor) ? { floor: formatFloor(fields.floor) as string } : {}),
      amenities: [],
      imageUrls: extractImages(card, $),
    });
  });

  return listings;
}

function splitTitle(title: string): Partial<Record<(typeof TITLE_FIELDS)[number], string>> {
  const parts = title.split(',').map((p) => p.trim());
  const result: Partial<Record<(typeof TITLE_FIELDS)[number], string>> = {};
  TITLE_FIELDS.forEach((field, index) => {
    const value = parts[index];
    if (value) result[field] = value;
  });
  return result;
}

/** Prices render as "6,000 ₪"; take the first such amount inside the card. */
function parsePrice(text: string): number | null {
  const match = /([\d,]{3,})\s*₪/.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The feed writes the floor as a bare "3", or as a word like "קרקע"/"פרטר".
 * A lone digit next to the size reads as noise, so it is spelled out.
 */
function formatFloor(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return `קומה ${text}`;
  if (text === 'קרקע') return 'קומת קרקע';
  return text;
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractImages(card: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string[] {
  const urls = new Set<string>();

  card.find('[style*="background-image"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const url = /url\((['"]?)(.*?)\1\)/.exec(style)?.[2];
    if (url) urls.add(absolute(url));
  });
  card.find('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && /uploads\.homeless/.test(src)) urls.add(absolute(src));
  });

  // Placeholder art appears when an ad has no photo of its own.
  return [...urls].filter((u) => !/nopic/i.test(u));
}

function absolute(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${BASE}${url}`;
  return url;
}
