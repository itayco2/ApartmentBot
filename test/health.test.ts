import { describe, expect, it } from 'vitest';
import { HealthTracker } from '../src/core/health.js';
import { BlockedError } from '../src/core/types.js';
import { detectBlockPage } from '../src/util/http.js';
import { madlanAdapter } from '../src/sources/madlan/madlanAdapter.js';
import { realtaAdapter } from '../src/sources/realta/realtaAdapter.js';
import { createYad2Adapter } from '../src/sources/yad2/yad2Adapter.js';

const yad2Adapter = createYad2Adapter();

describe('block page detection', () => {
  it('recognises the Cloudflare interstitial that Node fetch used to receive', () => {
    expect(detectBlockPage('<title>Just a moment...</title>')).toBe('Cloudflare interstitial');
  });

  it("recognises Madlan's own rate-limit page", () => {
    // Real wording: "something in your browser made us think you are a robot".
    const page = '<html><body>משהו בדפדפן שלך גרם לנו לחשוב שאתה רובוט</body></html>';
    expect(detectBlockPage(page)).toBe('Madlan bot page');
  });

  it('recognises the Radware challenge that guards Yad2', () => {
    expect(detectBlockPage('<title>Radware Page</title>')).toBe('Radware challenge');
    expect(detectBlockPage('<a href="https://validate.perfdrive.com/abc">')).toBe(
      'ShieldSquare redirect',
    );
  });

  it('does not flag an ordinary listing page', () => {
    expect(detectBlockPage('<html><title>דירות להשכרה במודיעין</title></html>')).toBeNull();
  });
});

describe('adapter health', () => {
  it('stays quiet for the first failures and alerts once on the third', () => {
    const health = new HealthTracker();

    expect(health.recordFailure('madlan', new Error('boom'), false)).toBeNull();
    expect(health.recordFailure('madlan', new Error('boom'), false)).toBeNull();

    const alert = health.recordFailure('madlan', new Error('boom'), false);
    expect(alert).toContain('madlan');

    // Further failures must not produce a message every cycle.
    expect(health.recordFailure('madlan', new Error('boom'), false)).toBeNull();
  });

  it('announces recovery only if it had alerted', () => {
    const health = new HealthTracker();

    health.recordFailure('madlan', new Error('x'), false);
    expect(health.recordSuccess('madlan')).toBeNull(); // never alerted, stay quiet

    for (let i = 0; i < 3; i++) health.recordFailure('madlan', new Error('x'), false);
    expect(health.recordSuccess('madlan')).toContain('madlan');
  });

  it('skips cycles after a block, and backs off further the longer it lasts', () => {
    const health = new HealthTracker();

    health.recordFailure('madlan', new BlockedError('madlan', 'bot page'), true);
    expect(health.get('madlan').backoffCycles).toBe(2);

    expect(health.shouldSkip('madlan')).toBe(true);
    expect(health.shouldSkip('madlan')).toBe(true);
    expect(health.shouldSkip('madlan')).toBe(false); // window elapsed

    health.recordFailure('madlan', new BlockedError('madlan', 'bot page'), true);
    expect(health.get('madlan').backoffCycles).toBe(4);
  });

  it('caps the backoff so a source is never abandoned for good', () => {
    const health = new HealthTracker();
    for (let i = 0; i < 12; i++) {
      health.recordFailure('madlan', new BlockedError('madlan', 'bot page'), true);
    }
    expect(health.get('madlan').backoffCycles).toBeLessThanOrEqual(16);
  });

  it('clears the backoff as soon as a fetch succeeds', () => {
    const health = new HealthTracker();
    health.recordFailure('madlan', new BlockedError('madlan', 'bot page'), true);

    health.recordSuccess('madlan');
    expect(health.get('madlan').backoffCycles).toBe(0);
    expect(health.shouldSkip('madlan')).toBe(false);
  });

  /**
   * Madlan used to be best-effort because being blocked was its normal state
   * and saying so daily was noise. It is read through its own GraphQL API
   * now, which answers ordinary requests, so a failure is a regression and
   * the owner should hear about it like any other source.
   */
  it('alerts on Madlan failures now that it is a working source', () => {
    expect(madlanAdapter.bestEffort).toBeUndefined();
    // Every city in one sweep, so it no longer needs a once-a-day cadence to
    // stay polite - but it is still the whole country per call, not one city.
    expect(madlanAdapter.cadenceMinutes).toBeGreaterThan(0);
  });

  it('leaves the primary sources alerting normally', () => {
    expect(yad2Adapter.bestEffort).toBeUndefined();
    expect(realtaAdapter.bestEffort).toBeUndefined();
  });

  it('tracks each source independently', () => {
    const health = new HealthTracker();
    for (let i = 0; i < 3; i++) health.recordFailure('madlan', new Error('x'), false);

    expect(health.get('homeless').consecutiveFailures).toBe(0);
    expect(health.shouldSkip('homeless')).toBe(false);
  });
});

describe('session expiry', () => {
  it('tells the owner once, backs the source off, and clears on recovery', () => {
    // An expired Facebook login used to be swallowed per group: the adapter
    // returned [] and health recorded a success, so nobody was ever told.
    const health = new HealthTracker();

    const first = health.recordSessionExpired('facebook');
    expect(first).toContain('npm run fb-login');
    expect(health.recordSessionExpired('facebook')).toBeNull();
    expect(health.shouldSkip('facebook')).toBe(true);

    expect(health.recordSuccess('facebook')).not.toBeNull();
    expect(health.recordSessionExpired('facebook')).toContain('npm run fb-login');
  });
});
