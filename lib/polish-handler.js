import { polishText, PolishError, MAX_INPUT } from './polish.js';

const PER_USER_PER_HOUR = 8;
const SITE_PER_MINUTE = 15;

const STATUS = { auth: 401, forbidden: 403, method: 405, too_long: 413, limit: 429, empty: 400, bad_request: 400, busy: 503, not_configured: 500 };

/**
 * deps: { verifyIdToken(token) -> uid, allow(id, max, ttlSeconds) -> boolean,
 *         apiKey, fetchImpl?, isAllowedOrigin(origin) -> boolean }
 */
export function makeHandler(deps) {
  return async function handler(req, res) {
    const send = (code, body) => {
      res.setHeader('Cache-Control', 'no-store');
      if (code === 503) res.setHeader('Retry-After', '60');
      res.status(code).json(body);
    };
    const fail = error => send(STATUS[error] || 500, { ok: false, error });

    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail('method'); }
    const origin = req.headers.origin;
    if (origin && !deps.isAllowedOrigin(origin)) return fail('forbidden');
    if (!deps.apiKey) return fail('not_configured');

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return fail('auth');
    let uid;
    try { uid = await deps.verifyIdToken(token); } catch { uid = null; }
    if (!uid) return fail('auth');

    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    const text = body && typeof body.text === 'string' ? body.text : null;
    if (text === null) return fail('bad_request');
    if (!text.trim()) return fail('empty');
    if (text.length > MAX_INPUT) return fail('too_long');

    const now = Date.now();
    try {
      if (!(await deps.allow(`u_${uid}_${Math.floor(now / 3600000)}`, PER_USER_PER_HOUR, 3600))) return fail('limit');
      if (!(await deps.allow(`site_${Math.floor(now / 60000)}`, SITE_PER_MINUTE, 120))) return fail('busy');
    } catch (err) {
      console.error('rate limit check failed', err);
      return fail('busy');
    }

    try {
      const out = await polishText(text, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl || fetch });
      return send(200, { ok: true, text: out.text, skipped: out.skipped });
    } catch (err) {
      if (err instanceof PolishError) return fail(err.code);
      console.error('polish failed', err);
      return fail('busy');
    }
  };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
