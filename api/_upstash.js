// Where short share links are kept on Vercel: Upstash Redis (from the Vercel Marketplace), whose
// connection Vercel puts in the environment. Each setup is one key, `share:<id>`, kept for good.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Link data goes in and comes out as the text it is (it isn't JSON).
const values = Redis.fromEnv({ automaticDeserialization: false });

/** @type {import('./_share.js').ShareStore} */
export const store = {
  get: (id) => /** @type {Promise<string | null>} */ (values.get(`share:${id}`)),
  // Set once: an id is its setup's hash, so what's there already is the same setup.
  add: async (id, data) => void (await values.set(`share:${id}`, data, { nx: true })),
};

// 30 shares an hour from one address: far more than anyone sharing their bench needs.
const limit = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(30, '1 h'), prefix: 'share-limit' });

/** @param {string} who */
export const allow = async (who) => (await limit.limit(who)).success;
