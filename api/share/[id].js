// GET /api/share/<id>: the setup a short link names (see ../_share.js).
import { readShare } from '../_share.js';
import { store } from '../_upstash.js';

/** @param {Request} request */
export const GET = (request) => readShare(request, store);
