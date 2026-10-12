// The guide (src/ui/Guide.tsx) walks someone new through Bench by the names on its buttons, menus and
// panels. A renamed control would leave it pointing at nothing, so every name it wraps in <Ui> must
// still be in Bench's UI, or be a bundled app's name.

import { describe, expect, it } from 'vitest';
import guide from '../src/ui/Guide.tsx?raw';

const ui = import.meta.glob(['../src/App.tsx', '../src/ui/*.tsx', '!../src/ui/Guide.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const apps = import.meta.glob('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const source = Object.values(ui).join('\n');
/** Each bundled app's name: line 1, `-- Name: what it does`. */
const appNames = Object.values(apps).map((code) => code.match(/^-- ([^:\n]+):/)?.[1]);
const named = [...guide.matchAll(/<Ui>([^<]+)<\/Ui>/g)].map((m) => m[1]);

describe('the guide', () => {
  it('names controls', () => {
    expect(named.length).toBeGreaterThan(20);
  });

  it.each([...new Set(named)])('names "%s", which Bench has', (name) => {
    expect(source.includes(name) || appNames.includes(name)).toBe(true);
  });
});
