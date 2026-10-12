// What a share link carries, and how it's written: the setup as JSON, compressed with raw DEFLATE,
// in base64url, after the format's version (`1.<data>`). A long link holds it after `#share=`; a
// short one names it, stored on Bench's server (api/). Plain JavaScript, typed with JSDoc, so the
// Vercel functions can run it as it is: Vercel's builder can't compile TypeScript 7.

/**
 * Everything a link carries.
 * @typedef {object} Setup
 * @property {import('./sim/leds').Output} output
 * @property {string} board
 * @property {import('./sim/controls/bench').PartSpec[]} parts The parts you added (the board's own come with the board).
 * @property {Record<string, string>} connections Each of the app's controls, by name: the part and channel it reads ('part:channel', or 'none').
 * @property {{ bundled: string } | { name: string, code: string, description?: string }} app A bundled app by its id, or your own as its code.
 */

/** The format, first in the data: a later Bench can still read links made today. */
const VERSION = '1';
/** Decompressed, a setup Bench made is far smaller than this; a bigger one isn't read. */
const MAX_BYTES = 1 << 20;

/**
 * A setup as link data (`1.<base64url>`).
 * @param {Setup} setup
 * @returns {Promise<string>}
 */
export async function encodeSetup(setup) {
  const packed = await through(new TextEncoder().encode(JSON.stringify(setup)), new CompressionStream('deflate-raw'));
  return `${VERSION}.${toBase64Url(packed)}`;
}

/**
 * The setup in link data; null if it's damaged, cut short or not a setup.
 * @param {string} data
 * @returns {Promise<Setup | null>}
 */
export async function decodeSetup(data) {
  if (!data.startsWith(`${VERSION}.`)) return null;
  try {
    const bytes = await through(fromBase64Url(data.slice(VERSION.length + 1)), new DecompressionStream('deflate-raw'), MAX_BYTES);
    return asSetup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Decoded JSON as a Setup, or null if it isn't one (the rest is checked as it's opened).
 * @param {any} s
 * @returns {Setup | null}
 */
function asSetup(s) {
  const app = s?.app;
  const ok =
    typeof s?.output?.kind === 'string' &&
    typeof s.board === 'string' &&
    Array.isArray(s.parts) &&
    s.parts.every((/** @type {any} */ p) => typeof p?.id === 'string' && typeof p.kind === 'string' && typeof p.label === 'string') &&
    typeof s.connections === 'object' &&
    s.connections !== null &&
    Object.values(s.connections).every((c) => typeof c === 'string') &&
    (typeof app?.bundled === 'string' ||
      (typeof app?.name === 'string' && typeof app.code === 'string' && (app.description === undefined || typeof app.description === 'string')));
  return ok ? s : null;
}

/**
 * Runs bytes through a (de)compression stream, giving up past `limit` bytes out.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {CompressionStream | DecompressionStream} stream
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function through(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Base64 with the URL-safe alphabet and no padding: nothing a chat app or browser rewrites.
 * @param {Uint8Array} bytes
 */
export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} text */
function fromBase64Url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
