// HTTP handlers for the Job Search Assistant: POST /api/keywords and POST /api/jobs.
// Same protections as /api/polish: same-site Origin, Firebase sign-in, per-user and
// site-wide rate limits, input checks, and no secrets or raw errors in responses.
import { PolishError } from './polish.js';
import { extractKeywords, MAX_TEXT } from './keywords.js';
import { searchJobs, readSearch, JobsError } from './jobs.js';
import { fetchAd, adPageUrl } from './jobad.js';

const STATUS = { auth: 401, forbidden: 403, method: 405, too_long: 413, limit: 429, bad_request: 400, unreadable: 422, busy: 503, not_configured: 500, adzuna_auth: 502, adzuna_limit: 503, adzuna_down: 502 };
const safeJson = s => { try { return JSON.parse(s); } catch { return null; } };

/** Reply helpers that don't touch the response object's own properties. */
function replier(res) {
  const send = (code, body) => {
    res.setHeader('Cache-Control', 'no-store');
    if (code === 503) res.setHeader('Retry-After', '60');
    res.status(code).json(body);
  };
  return { ok: body => send(200, { ok: true, ...body }), fail: (error, detail) => { send(STATUS[error] || 500, detail ? { ok: false, error, detail } : { ok: false, error }); return null; } };
}

/** Shared checks. Returns { uid, body } or null after sending an error. */
async function guard(req, res, deps, needsKey, r) {
  const fail = r.fail;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail('method'); }
  const origin = req.headers.origin;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!origin || !(origin === `https://${host}` || deps.isAllowedOrigin(origin))) return fail('forbidden');
  if (!needsKey) return fail('not_configured', deps.configDetail);
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 4096) return fail('auth');
  let uid;
  try { uid = await deps.verifyIdToken(token); } catch { uid = null; }
  if (!uid) return fail('auth');
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  if (!body || typeof body !== 'object') return fail('bad_request');
  return { uid, body };
}
// If the shared counter store is unreachable, count in this server instance instead,
// so a database problem doesn't block every search (and is logged so it gets fixed).
const memory = new Map();
function memAllow(id, max, ttl) {
  const now = Date.now(), e = memory.get(id);
  if (!e || e.until < now) { memory.set(id, { n: 1, until: now + ttl * 1000 }); return true; }
  if (e.n >= max) return false;
  e.n++; return true;
}
async function limits(r, deps, checks) {
  for (const [id, max, ttl, error] of checks) {
    let ok;
    try { ok = await deps.allow(id, max, ttl); } catch (err) {
      console.error('rate limit store unavailable, counting in memory:', err && err.message);
      ok = memAllow(id, max, ttl);
    }
    if (!ok) { r.fail(error); return false; }
  }
  return true;
}

/** deps: { verifyIdToken, allow, apiKey (Groq), fetchImpl?, isAllowedOrigin } */
export function makeKeywordsHandler(deps) {
  return async function handler(req, res) {
    const r = replier(res);
    const g = await guard(req, res, deps, !!deps.apiKey, r);
    if (!g) return;
    const text = typeof g.body.text === 'string' ? g.body.text : null;
    if (text === null) return r.fail('bad_request');
    if (text.length > MAX_TEXT) return r.fail('too_long');
    if (text.trim().length < 3) return r.fail('unreadable');
    const now = Date.now();
    if (!(await limits(r, deps, [[`kw_${g.uid}_${Math.floor(now / 3600000)}`, 20, 3600, 'limit'], [`site_${Math.floor(now / 60000)}`, 15, 120, 'busy']]))) return;
    try {
      return r.ok(await extractKeywords(text, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl || fetch }));
    } catch (err) {
      if (err instanceof PolishError) return r.fail(err.code);
      console.error('keywords failed', err);
      return r.fail('busy');
    }
  };
}

/** deps: { verifyIdToken, allow, appId, appKey (Adzuna), fetchImpl?, isAllowedOrigin, cache? } */
export function makeJobsHandler(deps) {
  const cache = deps.cache || new Map();          // same search within 20 minutes reuses the result
  return async function handler(req, res) {
    const r = replier(res);
    const g = await guard(req, res, deps, !!(deps.appId && deps.appKey), r);
    if (!g) return;
    let search;
    try { search = readSearch(g.body); } catch { return r.fail('bad_request'); }
    const key = JSON.stringify(search), hit = cache.get(key);
    if (hit && Date.now() - hit.at < 20 * 60000) return r.ok(hit.data);
    const now = Date.now();
    if (!(await limits(r, deps, [[`jobs_${g.uid}_${Math.floor(now / 3600000)}`, 12, 3600, 'limit'], [`jobs_site_${Math.floor(now / 60000)}`, 4, 120, 'busy']]))) return;
    try {
      const data = await searchJobs(search, { appId: deps.appId, appKey: deps.appKey, fetchImpl: deps.fetchImpl || fetch });
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return r.ok(data);
    } catch (err) {
      if (err instanceof JobsError) return r.fail(err.code, err.detail);
      console.error('jobs search failed', err);
      return r.fail('busy');
    }
  };
}

/** deps: { verifyIdToken, allow, fetchImpl?, isAllowedOrigin }. Body { url }: an Adzuna ad page. */
export function makeJobAdHandler(deps) {
  return async function handler(req, res) {
    const r = replier(res);
    const g = await guard(req, res, deps, true, r);
    if (!g) return;
    if (!adPageUrl(g.body.url)) return r.fail('bad_request');
    if (!(await limits(r, deps, [[`ad_${g.uid}_${Math.floor(Date.now() / 3600000)}`, 60, 3600, 'limit']]))) return;
    const text = await fetchAd(g.body.url, { fetchImpl: deps.fetchImpl || fetch });
    return text.length >= 200 ? r.ok({ text }) : r.fail('unreadable');
  };
}
