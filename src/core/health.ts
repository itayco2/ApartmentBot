import { logger } from '../logger.js';

const FAILURES_BEFORE_ALERT = 3;

export interface AdapterHealth {
  name: string;
  consecutiveFailures: number;
  failingSince: Date | null;
  lastError: string | null;
  lastSuccessAt: Date | null;
  /** Cycles still to skip because the source answered with a block page. */
  backoffCycles: number;
  /** The owner has been told the login expired; say nothing more until it recovers. */
  sessionExpired: boolean;
}

/** How long a source with an expired login waits before checking again. */
const SESSION_EXPIRED_BACKOFF_CYCLES = 16;

/**
 * Tracks whether each source is working, so one broken site produces a single
 * alert rather than a message every cycle, and a blocked site is left alone
 * for a while instead of being hammered.
 */
export class HealthTracker {
  private readonly states = new Map<string, AdapterHealth>();

  private state(name: string): AdapterHealth {
    let state = this.states.get(name);
    if (!state) {
      state = {
        name,
        consecutiveFailures: 0,
        failingSince: null,
        lastError: null,
        lastSuccessAt: null,
        backoffCycles: 0,
        sessionExpired: false,
      };
      this.states.set(name, state);
    }
    return state;
  }

  all(): AdapterHealth[] {
    return [...this.states.values()];
  }

  get(name: string): AdapterHealth {
    return this.state(name);
  }

  /** True when this source should sit out the current cycle. */
  shouldSkip(name: string): boolean {
    const state = this.state(name);
    if (state.backoffCycles > 0) {
      state.backoffCycles--;
      logger.debug({ source: name, remaining: state.backoffCycles }, 'skipping source, backing off');
      return true;
    }
    return false;
  }

  /** Returns a message to send the owner when a source has just recovered. */
  recordSuccess(name: string): string | null {
    const state = this.state(name);
    const wasAlerting = state.consecutiveFailures >= FAILURES_BEFORE_ALERT;

    state.consecutiveFailures = 0;
    state.failingSince = null;
    state.lastError = null;
    state.lastSuccessAt = new Date();
    state.backoffCycles = 0;
    state.sessionExpired = false;

    return wasAlerting ? `✅ ${name} חזר לעבוד.` : null;
  }

  /**
   * Returns the message to send the owner the first time a source's login
   * is found to have expired, and nothing on later cycles until it recovers.
   * Counts as an alert, so the recovery is announced too.
   */
  recordSessionExpired(name: string, instruction = 'npm run fb-login'): string | null {
    const state = this.state(name);
    state.failingSince ??= new Date();
    state.lastError = `session expired - run ${instruction}`;
    state.backoffCycles = SESSION_EXPIRED_BACKOFF_CYCLES;
    state.consecutiveFailures = Math.max(state.consecutiveFailures, FAILURES_BEFORE_ALERT);

    if (state.sessionExpired) return null;
    state.sessionExpired = true;
    return `⚠️ ${name}: הסשן פג. הרץ <code>${instruction}</code> ואז הפעל מחדש את הבוט.`;
  }

  /**
   * Returns a message to send the owner on the failure that crosses the
   * threshold, and nothing on the failures after it.
   */
  recordFailure(name: string, error: unknown, blocked: boolean): string | null {
    const state = this.state(name);
    state.consecutiveFailures++;
    state.failingSince ??= new Date();
    state.lastError = error instanceof Error ? error.message : String(error);

    if (blocked) {
      // 2, 4, 8 … cycles, capped so a source is never abandoned entirely.
      state.backoffCycles = Math.min(16, 2 ** state.consecutiveFailures);
    }

    if (state.consecutiveFailures !== FAILURES_BEFORE_ALERT) return null;

    const since = state.failingSince.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `⚠️ ${name} נכשל מאז ${since}: ${state.lastError}`;
  }
}
