// POST /api/share: keep a setup, answer its id (see ../_share.js).
import { createShare } from '../_share.js';
import { allow, store } from '../_upstash.js';

/** @param {Request} request */
export const POST = (request) => createShare(request, store, allow);
