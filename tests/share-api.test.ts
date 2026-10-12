// Short share links: the server keeps only setups Bench can open, under an id that is the setup's own
// hash, and gives each back unchanged for good.

import { describe, expect, it } from 'vitest';
import { createShare, ID, MAX_DATA, readShare, type ShareStore } from '../api/_share.js';
import { residentApps } from '../src/resident-apps';
import { decodeSetup, encodeSetup, type Setup } from '../src/share-format';

const setup: Setup = {
  output: { kind: 'matrix', w: 16, h: 16 },
  board: 'seeed-xiao-esp32s3',
  parts: [{ id: 'knob-1', kind: 'knob', label: 'Encoder 1' }],
  connections: { speed: 'knob-1:rotate' },
  app: { name: 'fire', code: residentApps.find((a) => a.id === 'led-fire')!.code },
};

function memoryStore(): ShareStore & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return { kept, get: async (id) => kept.get(id) ?? null, add: async (id, data) => void (kept.has(id) || kept.set(id, data)) };
}
const post = (body: string, headers: Record<string, string> = {}) => new Request('https://bench.porous.systems/api/share', { method: 'POST', body, headers });
const get = (id: string) => new Request(`https://bench.porous.systems/api/share/${id}`);

describe('short share links', () => {
  it('keep a setup under its hash, so the same setup always gets the same link', async () => {
    const store = memoryStore();
    const data = await encodeSetup(setup);
    const first = await createShare(post(data), store);
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    expect(id).toMatch(ID);
    expect(((await (await createShare(post(data), store)).json()) as { id: string }).id).toBe(id);
    expect(store.kept.size).toBe(1);

    const other = await createShare(post(await encodeSetup({ ...setup, board: 'esp32-devkitc' })), store);
    expect(((await other.json()) as { id: string }).id).not.toBe(id);
  });

  it('give the setup back unchanged, cached for good', async () => {
    const store = memoryStore();
    const data = await encodeSetup(setup);
    const { id } = (await (await createShare(post(data), store)).json()) as { id: string };
    const r = await readShare(get(id), store);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(await decodeSetup(await r.text())).toEqual(setup);
  });

  it("say so when nothing is stored under a link, and don't cache that", async () => {
    const store = memoryStore();
    for (const id of ['AAAAAAAAAAAA', 'short', '../../etc', '']) {
      const r = await readShare(get(id), store);
      expect(r.status, id).toBe(404);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('keep only setups Bench can open, and only so big', async () => {
    const store = memoryStore();
    expect((await createShare(post('hello'), store)).status).toBe(400);
    expect((await createShare(post('1.not-deflate'), store)).status).toBe(400);
    // Compressed right, but not a setup.
    expect((await createShare(post(await encodeSetup({ hello: 'there' } as unknown as Setup)), store)).status).toBe(400);
    expect((await createShare(post('1.' + 'A'.repeat(MAX_DATA)), store)).status).toBe(413);
    expect((await createShare(post('1.x', { 'content-length': String(MAX_DATA + 1) }), store)).status).toBe(413);
    expect((await createShare(new Request('https://bench.porous.systems/api/share'), store)).status).toBe(405);
    expect(store.kept.size).toBe(0);
  });

  it('turn away a sender who has stored too many lately', async () => {
    const store = memoryStore();
    const asked: string[] = [];
    const allow = async (who: string) => (asked.push(who), false);
    const r = await createShare(post(await encodeSetup(setup), { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), store, allow);
    expect(r.status).toBe(429);
    expect(asked).toEqual(['203.0.113.7']);
    expect(store.kept.size).toBe(0);
  });

  it('fit twice the biggest app so far', async () => {
    // The biggest app written on Bench is ~74 KB of Lua; every bundled app together is about twice that.
    const code = residentApps.map((a) => a.code).join('\n');
    expect(code.length).toBeGreaterThan(140_000);
    const data = await encodeSetup({ ...setup, app: { name: 'everything', code } });
    expect(data.length).toBeLessThan(MAX_DATA);
    expect((await createShare(post(data), memoryStore())).status).toBe(201);
  });
});
