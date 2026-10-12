// A link that opens your setup in someone else's Bench: the output and the board driving it, the
// parts you put on the bench, what each of the app's controls is connected to, and the app (a
// bundled one by its id, your own as its code). Share stores the setup on Bench's server and gives
// a short link, /s/<id>, that fits anywhere a link goes (LinkedIn caps a whole post at 3,000
// characters). If it can't be stored, Share gives the long link, which carries the setup itself
// after #share= (src/share-format.js) and never reaches a server.
//
// Opening a link writes the setup where Bench keeps its own (localStorage, read on start) before
// the first render. What it replaces is kept until you choose: the note saying a link was opened
// comes back on every load until you go back to your bench or keep this one.

import { type LiveApp, session } from './resident/session';
import { residentApps } from './resident-apps';
import { decodeSetup, encodeSetup, type Setup } from './share-format';
import { boardsFor } from './sim/boards';
import { CHANNELS } from './sim/controls/bench';
import { outputDevice } from './sim/devices';
import { MATRIX_SIZES, RING_COUNTS, STRIP_COUNTS } from './sim/leds';

export type { Setup };

/** What opening a link did, for the note that says so. */
export interface Opened {
  /** The app it opened, unless this Bench doesn't have it. */
  app: string | null;
  /** The display or LED chain it opened on. */
  output: string;
  /** What this Bench doesn't have, so left out. */
  missing: string[];
}

const PREFIX = '#share=';
/** A short link's path: /s/ and the id its setup is stored under (api/_share.js). */
const SHORT = /^\/s\/([A-Za-z0-9_-]{12})$/;
/** What the last link opened replaced, and what it opened, until you choose. */
const PENDING = 'bench:shared';
/** The keys a link writes (App's persisted settings, the bench's parts, the connections) and the
 *  app that becomes yours: what "Back to my bench" puts back. */
const REPLACED = /^bench:(sketch|device|output-(kind|strip|ring|matrix)|boards|parts|resident:live|binding:.*)$/;

/**
 * A link to Bench at `base` (its origin and a slash) that opens `setup`: the short one if the setup
 * can be stored there, else the long one.
 */
export async function shareLink(setup: Setup, base: string): Promise<string> {
  const data = await encodeSetup(setup);
  try {
    const r = await fetch(`${base}api/share`, { method: 'POST', body: data, headers: { 'content-type': 'text/plain' } });
    if (r.ok) return `${base}s/${((await r.json()) as { id: string }).id}`;
  } catch {
    /* offline, or no server (a static copy of Bench): the long link carries it all */
  }
  return `${base}${PREFIX}${data}`;
}

/** The long link to `base` that carries `setup` itself. */
export async function longLink(setup: Setup, base: string): Promise<string> {
  return `${base}${PREFIX}${await encodeSetup(setup)}`;
}

/** The setup in a long link's fragment (`#share=…`); null if it's damaged or cut short. */
export async function readLink(hash: string): Promise<Setup | null> {
  return hash.startsWith(PREFIX) ? decodeSetup(hash.slice(PREFIX.length)) : null;
}

/**
 * Writes a setup to `store` where Bench reads its own on start. Returns your-own app it brings (for
 * the session to load, as a dropped file is) and what it opened. Whatever this Bench doesn't have (a
 * display, board, part or app from another version) is left as it was, and listed.
 */
export function applySetup(setup: Setup, store: Storage): { live: LiveApp | null; opened: Opened } {
  const put = (key: string, v: unknown) => store.setItem(`bench:${key}`, JSON.stringify(v));
  const missing: string[] = [];

  const o = setup.output;
  const known =
    (o.kind === 'display' && outputDevice(o)) ||
    (o.kind === 'strip' && STRIP_COUNTS.includes(o.count)) ||
    (o.kind === 'ring' && RING_COUNTS.includes(o.count)) ||
    (o.kind === 'matrix' && MATRIX_SIZES.some(([w, h]) => w === o.w && h === o.h));
  const device = known ? outputDevice(o) : undefined;
  if (device) {
    put('output-kind', o.kind);
    if (o.kind === 'display') put('device', o.device);
    if (o.kind === 'strip') put('output-strip', o.count);
    if (o.kind === 'ring') put('output-ring', o.count);
    if (o.kind === 'matrix') put('output-matrix', `${o.w}x${o.h}`);
    if (boardsFor(device).some((b) => b.id === setup.board)) put('boards', { ...stored(store, 'bench:boards'), [device.id]: setup.board });
    else missing.push(`the board "${setup.board}"`);
  } else missing.push(o.kind === 'display' ? `the display "${o.device}"` : `that LED ${o.kind}`);

  for (const p of setup.parts) if (!Object.hasOwn(CHANNELS, p.kind)) missing.push(`the part "${p.kind}"`);
  put('parts', setup.parts.filter((p) => Object.hasOwn(CHANNELS, p.kind)).map(({ id, kind, label }) => ({ id, kind, label })));

  let live: LiveApp | null = null;
  let app: { sketch: string; name: string } | null = null;
  if ('bundled' in setup.app) {
    const id = setup.app.bundled;
    const bundled = residentApps.find((a) => a.id === id);
    if (bundled) app = { sketch: `resident:${id}`, name: bundled.name };
    else missing.push(`the app "${id}"`);
  } else {
    const { name, code, description } = setup.app;
    live = { name, code, description, source: 'link' };
    app = { sketch: 'resident:live', name };
  }
  if (app) {
    put('sketch', app.sketch);
    // The app's connections are the link's alone (App keeps them unencoded, one key per control).
    const prefix = `bench:binding:${app.sketch}:`;
    for (const k of keys(store)) if (k.startsWith(prefix)) store.removeItem(k);
    for (const [control, source] of Object.entries(setup.connections)) store.setItem(prefix + control, source);
  }

  return { live, opened: { app: app?.name ?? null, output: device?.name ?? 'your output', missing: [...new Set(missing)] } };
}

/** The note Bench shows after opening a link. */
export function openedNote(o: Opened): string {
  const left = o.missing.length ? ` This Bench doesn't have ${o.missing.join(', ')}, so ${o.missing.length > 1 ? 'those were' : 'that was'} left out.` : '';
  return `Opened a shared bench: ${o.app ? `${o.app} on ` : ''}${o.output}, with its parts and connections, in place of yours.${left}`;
}

/**
 * Call once before the first render. Opens the share link the page was loaded with, if it was: keeps
 * what the setup replaces, writes it, loads its app, and takes the link out of the address bar, so a
 * reload keeps the setup without opening the link again. Returns what a link opened, until you've
 * chosen to keep it or go back (a string: why the link couldn't be opened).
 */
export async function openShared(): Promise<Opened | string | null> {
  // A long link pasted into a tab already on Bench changes only the fragment: open it as a fresh page.
  addEventListener('hashchange', () => location.hash.startsWith(PREFIX) && location.reload());
  const pending = readPending();
  const short = SHORT.exec(location.pathname);
  if (!short && !location.hash.startsWith(PREFIX)) return pending?.opened ?? null;
  let setup: Setup | null = null;
  let why = "That share link didn't open: it's damaged or cut short (chat apps with a message limit cut long links off). Your bench is as it was.";
  if (short) {
    try {
      const r = await fetch(`/api/share/${short[1]}`);
      if (r.ok) setup = await decodeSetup(await r.text());
      else if (r.status === 404) why = "That share link didn't open: nothing is stored under it. Check that the whole link was copied. Your bench is as it was.";
    } catch {
      // The link stays in the address bar, so a reload tries again.
      return "That share link didn't open: Bench's server couldn't be reached. Reload to try again.";
    }
  } else setup = await readLink(location.hash);
  history.replaceState(null, '', (short ? '/' : location.pathname) + location.search);
  if (!setup) return why;
  try {
    // Opened link after link without choosing, "Back to my bench" still goes back to yours.
    const before = pending?.before ?? snapshot(localStorage);
    const { live, opened } = applySetup(setup, localStorage);
    localStorage.setItem(PENDING, JSON.stringify({ before, opened } satisfies Pending));
    if (live) session.setLive(live);
    return opened;
  } catch {
    return "That share link didn't open: this browser won't let Bench save a setup (storage is blocked or full).";
  }
}

/** Puts back the setup a link replaced, and starts Bench on it. */
export function backToMyBench(): void {
  const pending = readPending();
  try {
    if (pending) restore(localStorage, pending.before);
    localStorage.removeItem(PENDING);
  } catch {
    /* nothing kept to go back to */
  }
  location.reload();
}

/** Keeps the shared setup as yours: there's nothing to go back to. */
export function keepShared(): void {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    /* nothing kept */
  }
}

interface Pending {
  before: Record<string, string>;
  opened: Opened;
}
function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null;
    return p?.before && p.opened ? p : null;
  } catch {
    return null;
  }
}

/** What a link would replace in `store`. */
export function snapshot(store: Storage): Record<string, string> {
  return Object.fromEntries(keys(store).flatMap((k) => (REPLACED.test(k) ? [[k, store.getItem(k)!]] : [])));
}

/** Puts `store` back as `snapshot` found it: what a link added goes, what it changed comes back. */
export function restore(store: Storage, before: Record<string, string>): void {
  for (const k of keys(store)) if (REPLACED.test(k) && !Object.hasOwn(before, k)) store.removeItem(k);
  for (const [k, v] of Object.entries(before)) store.setItem(k, v);
}

function keys(store: Storage): string[] {
  return Array.from({ length: store.length }, (_, i) => store.key(i) ?? '');
}
function stored(store: Storage, key: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(store.getItem(key) ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
