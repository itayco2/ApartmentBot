import { Agent, setGlobalDispatcher } from 'undici';
import { BlockedError } from '../core/types.js';
import { logger } from '../logger.js';

/**
 * Cloudflare fingerprints the TLS handshake, and Node's defaults are a known
 * automation signature: every request was answered with a "Just a moment…"
 * challenge (HTTP 403, cf-mitigated: challenge) even with browser headers.
 *
 * Negotiating HTTP/2 with Chrome's cipher ordering matches what the User-Agent
 * claims to be, and the sites answer normally. Verified against both
 * homeless.co.il and madlan.co.il.
 *
 * Do not add explicit ecdhCurve/sigalgs here - pinning those was tested and
 * made the fingerprint fail again.
 */
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

setGlobalDispatcher(
  new Agent({
    allowH2: true,
    connect: {
      ciphers: CHROME_CIPHERS,
      ALPNProtocols: ['h2', 'http/1.1'],
      minVersion: 'TLSv1.2',
      timeout: 15_000,
    },
    // This dispatcher is global, so it also governs the Gemini SDK's requests.
    // Undici's defaults let a stalled HTTP/2 stream sit for five minutes, and
    // one hung model call stretched an entire poll cycle to 303 seconds.
    headersTimeout: 60_000,
    bodyTimeout: 90_000,
  }),
);

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Madlan returns 403 to a bare request but 200 with the full client-hint set,
 * so these headers are required, not cosmetic.
 */
function desktopHeaders(): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

function mobileHeaders(): Record<string, string> {
  return {
    'User-Agent': MOBILE_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

const lastRequestAt = new Map<string, number>();

/**
 * Per-host cookie store.
 *
 * Without it every request arrives with no cookies, which reads as a brand-new
 * visitor each time - the opposite of the returning browser the User-Agent
 * claims to be. Cloudflare in particular hands out a clearance cookie that is
 * pointless unless it is sent back.
 *
 * Deliberately minimal: no path/expiry handling, because the bot talks to a
 * handful of hosts and only needs continuity within a session.
 */
const cookieJar = new Map<string, Map<string, string>>();

function storeCookies(host: string, response: Response): void {
  const headers = response.headers.getSetCookie?.() ?? [];
  if (headers.length === 0) return;

  const jar = cookieJar.get(host) ?? new Map<string, string>();
  for (const header of headers) {
    const pair = header.split(';')[0]?.trim();
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  cookieJar.set(host, jar);
}

function cookieHeader(host: string): string | undefined {
  const jar = cookieJar.get(host);
  if (!jar || jar.size === 0) return undefined;
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Spaces out consecutive requests to the same host by a random interval. */
async function throttleHost(host: string, delayRange: [number, number]): Promise<void> {
  const previous = lastRequestAt.get(host);
  if (previous !== undefined) {
    const wait = randomBetween(delayRange[0], delayRange[1]) - (Date.now() - previous);
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(host, Date.now());
}

export interface FetchTextOptions {
  /** Source name, used to label a BlockedError. */
  source: string;
  profile?: 'desktop' | 'mobile';
  timeoutMs?: number;
  retries?: number;
  delayRange?: [number, number];
  headers?: Record<string, string>;
  /**
   * A JSON body to POST. Absent means a GET.
   *
   * Kept inside `fetchText` rather than given its own function so a POSTing
   * source still gets the host throttle, the Chrome TLS profile, the cookie
   * jar and - most of all - `detectBlockPage`, which is what stands between a
   * bot-challenge page and an adapter reporting "no listings today".
   */
  json?: unknown;
}

/**
 * Fetches a page as text with browser-like headers, host throttling and
 * retries. Retries only transient failures - a 404 or 403 is returned to the
 * caller immediately so an adapter can classify it.
 */
export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  const {
    source,
    profile = 'desktop',
    timeoutMs = 30_000,
    retries = 2,
    delayRange = [1_500, 4_000],
    headers = {},
    json,
  } = options;

  const host = new URL(url).host;
  const baseHeaders = profile === 'mobile' ? mobileHeaders() : desktopHeaders();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttleHost(host, delayRange);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const cookies = cookieHeader(host);
      const response = await fetch(url, {
        method: json === undefined ? 'GET' : 'POST',
        headers: {
          ...baseHeaders,
          ...(cookies ? { Cookie: cookies } : {}),
          ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        signal: controller.signal,
        redirect: 'follow',
      });

      storeCookies(host, response);
      const body = await response.text();

      // Challenges arrive as 403 or as a 200 with a challenge page, so the
      // body is inspected either way before the status is judged.
      const challenge = detectBlockPage(body);
      if (challenge) throw new BlockedError(source, `${challenge} (HTTP ${response.status})`);

      if (!response.ok) {
        // 4xx means the request itself is wrong or refused; retrying will not help.
        if (response.status < 500) throw new Error(`HTTP ${response.status} for ${url}`);
        throw new RetryableError(`HTTP ${response.status} for ${url}`);
      }

      return body;
    } catch (error) {
      lastError = error;
      // Never retry a challenge: repeating it is what deepens a block.
      if (error instanceof BlockedError) throw error;

      const retryable = error instanceof RetryableError || isAbortOrNetworkError(error);
      if (!retryable || attempt === retries) break;

      const backoff = 2_000 * 2 ** attempt + randomBetween(0, 1_000);
      logger.warn({ url, attempt, backoff: Math.round(backoff) }, 'request failed, retrying');
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

class RetryableError extends Error {}

function isAbortOrNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TypeError' || 'cause' in error;
}

/**
 * Bot-protection pages are served with HTTP 200, so a block can only be
 * recognised from the body. Yad2 (Radware) and Cloudflare are covered here.
 */
export function detectBlockPage(html: string): string | null {
  const markers: Array<[RegExp, string]> = [
    // Yad2's gateway serves "Radware Bot Manager Captcha" today and "Radware
    // Page" before that; the title is the only stable marker across versions.
    [/<title>[^<]*Radware[^<]*<\/title>/i, 'Radware challenge'],
    [/validate\.perfdrive\.com/i, 'ShieldSquare redirect'],
    [/Just a moment\.\.\./i, 'Cloudflare interstitial'],
    [/<title>[^<]*Attention Required[^<]*<\/title>/i, 'Cloudflare block'],
    [/Verifying your browser before proceeding/i, 'browser verification'],
    [/g-recaptcha|hcaptcha\.com\/captcha/i, 'captcha challenge'],
    // Madlan serves its own Hebrew rate-limit page: "something in your browser
    // made us think you are a robot / you are browsing at superhuman speed".
    [/לחשוב שאתה רובוט/, 'Madlan bot page'],
    [/סליחה על ההפרעה/, 'Madlan rate limit'],
  ];
  for (const [pattern, label] of markers) {
    if (pattern.test(html)) return label;
  }
  return null;
}
