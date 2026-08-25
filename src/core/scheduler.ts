import { config } from '../config.js';
import { logger } from '../logger.js';
import { randomBetween } from '../util/http.js';
import type { PollCycle } from './pollCycle.js';

/**
 * Chained timer rather than cron, for two reasons: a cycle can outlast its own
 * interval without cycles ever overlapping, and each delay carries jitter so
 * requests do not arrive on a suspiciously exact schedule.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private nextRunAt: Date | null = null;

  constructor(private readonly cycle: PollCycle) {}

  start(): void {
    this.stopped = false;
    // A short first delay lets the bot finish starting before it makes requests.
    this.schedule(5_000);
    logger.info({ everyMinutes: config.pollMinutes }, 'scheduler started');
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  getNextRunAt(): Date | null {
    return this.nextRunAt;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Runs a cycle immediately, unless one is already in flight. */
  async runNow(): Promise<void> {
    if (this.running) return;
    await this.tick();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.nextRunAt = new Date(Date.now() + delayMs);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const started = Date.now();
      const result = await this.cycle.run();
      logger.info({ ...result, ms: Date.now() - started }, 'poll cycle finished');
    } catch (error) {
      // The cycle isolates source failures itself; reaching here means a bug,
      // and the loop must survive it or the bot goes silent.
      logger.error({ err: error }, 'poll cycle threw unexpectedly');
    } finally {
      this.running = false;
      this.schedule(this.nextDelayMs());
    }
  }

  private nextDelayMs(): number {
    const base = config.pollMinutes * 60_000;
    const spread = base * config.jitterFraction;
    return randomBetween(base - spread, base + spread);
  }
}
