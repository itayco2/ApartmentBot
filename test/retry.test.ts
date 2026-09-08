import { describe, expect, it } from 'vitest';
import { withRetries } from '../src/util/retry.js';
import { Semaphore } from '../src/util/semaphore.js';

/** Records requested pauses instead of waiting for them. */
function fakeSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe('retry policy', () => {
  it('returns the first successful result without retrying', async () => {
    const { waits, sleep } = fakeSleep();
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls++;
        return 'ok';
      },
      { attempts: 3, backoffMs: [2_000, 6_000], sleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it('retries up to the attempt limit, pausing for the configured backoff', async () => {
    const { waits, sleep } = fakeSleep();
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      },
      { attempts: 3, backoffMs: [2_000, 6_000], sleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([2_000, 6_000]);
  });

  it('throws the last error once every attempt has failed', async () => {
    const { sleep } = fakeSleep();
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, backoffMs: [1, 1], sleep },
      ),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });

  it('waits longer after a quota error, because retrying fast makes it worse', async () => {
    const { waits, sleep } = fakeSleep();
    let calls = 0;
    await withRetries(
      async () => {
        calls++;
        if (calls === 1) throw new Error('429 RESOURCE_EXHAUSTED: quota exceeded');
        return 'ok';
      },
      {
        attempts: 3,
        backoffMs: [2_000, 6_000],
        quotaBackoffMs: 20_000,
        isQuotaError: (e) => /429|RESOURCE_EXHAUSTED|quota/i.test(String(e)),
        sleep,
      },
    );
    expect(waits).toEqual([20_000]);
  });
});

describe('semaphore', () => {
  it('never lets more than the limit run at once, and runs the rest afterwards', async () => {
    const gate = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const finished: number[] = [];

    const job = (id: number) =>
      gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        finished.push(id);
      });

    await Promise.all([job(1), job(2), job(3), job(4), job(5)]);

    expect(peak).toBe(2);
    expect(finished.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('releases the slot when the job throws', async () => {
    const gate = new Semaphore(1);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // If the slot leaked, this would hang forever.
    await expect(gate.run(async () => 'after')).resolves.toBe('after');
  });
});
