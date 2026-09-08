/**
 * Lets at most `max` jobs run at once; the rest wait their turn in order.
 *
 * Replaces a hand-rolled counter that incremented twice per acquisition and so
 * never actually enforced its limit under contention.
 */
export class Semaphore {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await job();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      // The releaser hands the slot straight over, so the count stays put.
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.running--;
  }
}
