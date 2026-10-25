// HTTP handlers for the Job Search Assistant: POST /api/keywords and POST /api/jobs.
// Same protections as /api/polish: same-site Origin, Firebase sign-in, per-user and
// site-wide rate limits, input checks, and no secrets or raw errors in responses.
import { PolishError } from './polish.js';
import { extractKeywords, MAX_TEXT } from './keywords.js';
import { searchJobs, readSearch, JobsError } from './jobs.js';

const STATUS = { auth: 401, forbidden: 403, method: 405, too_long: 413, limit: 429, bad_request: 400, unreadable: 422, busy: 503, not_configured: 500 };
const safeJson = s => { try { return JSON.parse(s); } catch { return null; } };

/** Shared checks. Returns { uid, body } or null after sending an error. */
async function guard(req, res, deps, needsKey) {
  const send = (code, body) => {
    res.setHeader('Cache-Control', 'no-store');
    if (code === 503) res.setHeader('Retry-After', '60');
    res.status(code).json(body);
  };
  const fail = error => { send(STATUS[error] || 500, { ok: false, error }); return null; };
  res.ok = body => send(200, { ok: true, ...body });
  res.fail = fail;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail('method'); }
  const origin = req.headers.origin;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!origin || !(origin === `https://${host}` || deps.isAllowedOrigin(origin))) return fail('forbidden');
  if (!needsKey) return fail('not_configured');
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
async function limits(res, deps, checks) {
  try {
    for (const [id, max, ttl, error] of checks) if (!(await deps.allow(id, max, ttl))) { res.fail(error); return false; }
    return true;
  } catch (err) {
    console.error('rate limit check failed', err);
    res.fail('busy');
    return false;
  }
}

/** deps: { verifyIdToken, allow, apiKey (Groq), fetchImpl?, isAllowedOrigin } */
export function makeKeywordsHandler(deps) {
  return async function handler(req, res) {
    const g = await guard(req, res, deps, !!deps.apiKey);
    if (!g) return;
    const text = typeof g.body.text === 'string' ? g.body.text : null;
    if (text === null) return res.fail('bad_request');
    if (text.length > MAX_TEXT) return res.fail('too_long');
    if (text.trim().length < 3) return res.fail('unreadable');
    const now = Date.now();
    if (!(await limits(res, deps, [[`kw_${g.uid}_${Math.floor(now / 3600000)}`, 20, 3600, 'limit'], [`site_${Math.floor(now / 60000)}`, 15, 120, 'busy']]))) return;
    try {
      return res.ok(await extractKeywords(text, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl || fetch }));
    } catch (err) {
      if (err instanceof PolishError) return res.fail(err.code);
      console.error('keywords failed', err);
      return res.fail('busy');
    }
  };
}

/** deps: { verifyIdToken, allow, appId, appKey (Adzuna), fetchImpl?, isAllowedOrigin, cache? } */
export function makeJobsHandler(deps) {
  const cache = deps.cache || new Map();          // same search within 20 minutes reuses the result
  return async function handler(req, res) {
    const g = await guard(req, res, deps, !!(deps.appId && deps.appKey));
    if (!g) return;
    let search;
    try { search = readSearch(g.body); } catch { return res.fail('bad_request'); }
    const key = JSON.stringify(search), hit = cache.get(key);
    if (hit && Date.now() - hit.at < 20 * 60000) return res.ok(hit.data);
    const now = Date.now();
    if (!(await limits(res, deps, [[`jobs_${g.uid}_${Math.floor(now / 3600000)}`, 12, 3600, 'limit'], [`jobs_site_${Math.floor(now / 60000)}`, 4, 120, 'busy']]))) return;
    try {
      const data = await searchJobs(search, { appId: deps.appId, appKey: deps.appKey, fetchImpl: deps.fetchImpl || fetch });
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return res.ok(data);
    } catch (err) {
      if (err instanceof JobsError) return res.fail(err.code);
      console.error('jobs search failed', err);
      return res.fail('busy');
    }
  };
}
