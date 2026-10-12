// Short share links. Bench's Share button stores a setup here and gets back an id, and
// bench.porous.systems/s/<id> opens it. The setup is kept as a long link would carry it
// (src/share-format.js), under an id made from its own hash: the same setup always gets the same
// link, and no one can change what a link opens. The store is passed in: Upstash on Vercel
// (_upstash.js), a Map in the dev server (vite.config.ts).

import { decodeSetup, toBase64Url } from '../src/share-format.js';

/** Characters of link data a setup may take (64 KB compressed): the biggest app so far is a third of that. */
export const MAX_DATA = 90_000;
/** An id: the first 12 characters of the data's SHA-256 in base64url (72 bits, so not guessable). */
export const ID = /^[A-Za-z0-9_-]{12}$/;

/** @typedef {{ get(id: string): Promise<string | null>, add(id: string, data: string): Promise<void> }} ShareStore */

/**
 * The id for some link data.
 * @param {string} data
 */
export async function shareId(data) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(hash)).slice(0, 12);
}

/**
 * POST /api/share with link data as the body: keeps it if it's a setup Bench can open, and answers
 * `{ id }`. `allow(who)` says no when the sender has stored too many lately.
 * @param {Request} request
 * @param {ShareStore} store
 * @param {(who: string) => Promise<boolean>} [allow]
 */
export async function createShare(request, store, allow = async () => true) {
  if (request.method !== 'POST') return text('Send a setup with POST.', 405, { allow: 'POST' });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_DATA) return text('That setup is too big to store.', 413);
  const who = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'someone';
  if (!(await allow(who))) return text('Too many shares for now: try again in a while.', 429);
  const data = (await request.text()).trim();
  if (data.length > MAX_DATA) return text('That setup is too big to store.', 413);
  if (!(await decodeSetup(data))) return text("That isn't a setup Bench can open.", 400);
  const id = await shareId(data);
  await store.add(id, data);
  return Response.json({ id }, { status: 201 });
}

/**
 * GET /api/share/<id>: the link data kept under it. What an id names never changes, so it's cached
 * for good.
 * @param {Request} request
 * @param {ShareStore} store
 */
export async function readShare(request, store) {
  if (request.method !== 'GET') return text('Read a setup with GET.', 405, { allow: 'GET' });
  const id = new URL(request.url).pathname.split('/').pop() ?? '';
  const data = ID.test(id) ? await store.get(id) : null;
  if (data === null) return text('Nothing is stored under that link.', 404);
  return new Response(data, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', 'cdn-cache-control': 'max-age=31536000' },
  });
}

/**
 * @param {string} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
function text(body, status, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
