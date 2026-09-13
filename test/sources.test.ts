import { describe, expect, it } from 'vitest';
import { buildAdapters, selectSources } from '../src/sources/index.js';

const stored = { find: () => undefined };
const names = (list: { name: string }[]) => list.map((a) => a.name);

describe('choosing which sources run', () => {
  it('runs every source when nothing is specified', () => {
    const all = buildAdapters(stored, undefined);
    expect(names(all)).toContain('yad2');
    expect(names(all)).toContain('realta');
    expect(names(all)).toContain('madlan');
    expect(all.length).toBeGreaterThan(5);
  });

  /**
   * The owner asked for Yad2 and Madlan only: the boards worth reading, and
   * nothing that pads the alert stream with half-priced offices. Keeping it a
   * config value rather than deleted code means the rest come back by editing
   * .env, with no release.
   */
  it('runs only the named sources when an allowlist is given', () => {
    const chosen = buildAdapters(stored, ['yad2', 'madlan']);
    expect(names(chosen).sort()).toEqual(['madlan', 'yad2']);
  });

  it('ignores a name that matches no source rather than running nothing', () => {
    expect(names(buildAdapters(stored, ['yad2', 'nosuchsource']))).toEqual(['yad2']);
  });

  it('treats an empty allowlist as "everything", so a blank setting is not a mute switch', () => {
    expect(buildAdapters(stored, []).length).toBeGreaterThan(5);
  });

  it('reads a comma separated list, tolerating spaces and case', () => {
    expect(selectSources(' Yad2 , MADLAN ')).toEqual(['yad2', 'madlan']);
    expect(selectSources(undefined)).toBeUndefined();
    expect(selectSources('')).toBeUndefined();
  });
});
