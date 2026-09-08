import { sleep as realSleep } from './http.js';

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts: number;
  /** Pause before attempt n+1; the last entry repeats if there are more attempts. */
  backoffMs: number[];
  /** Recognises a quota/rate-limit error, which gets `quotaBackoffMs` instead. */
  isQuotaError?: (error: unknown) => boolean;
  quotaBackoffMs?: number;
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `fn` until it succeeds or the attempts run out, pausing between tries.
 *
 * Retrying a quota error quickly only deepens it - the free tier counts the
 * failed calls too - so those get a longer, separate pause.
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts - 1) break;

      const quota = options.isQuotaError?.(error) ?? false;
      const backoff = quota
        ? (options.quotaBackoffMs ?? options.backoffMs.at(-1) ?? 0)
        : (options.backoffMs[attempt] ?? options.backoffMs.at(-1) ?? 0);
      await sleep(backoff);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
