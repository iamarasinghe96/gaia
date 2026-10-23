import { PolishError } from './polish.js';
import { extractProfile, MAX_TEXT } from './import.js';

const PER_USER_PER_HOUR = 6;
const SITE_PER_MINUTE = 15;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const STATUS = { auth: 401, forbidden: 403, method: 405, too_long: 413, limit: 429, bad_request: 400, unreadable: 422, busy: 503, not_configured: 500 };

/**
 * deps: { verifyIdToken, allow, apiKey, fetchImpl?, isAllowedOrigin, pdfToText(bytes) -> string }
 * Body: { text } for text the browser already extracted, or { pdf: base64 } for a PDF.
 */
export function makeImportHandler(deps) {
  return async function handler(req, res) {
    const send = (code, body) => {
      res.setHeader('Cache-Control', 'no-store');
      if (code === 503) res.setHeader('Retry-After', '60');
      res.status(code).json(body);
    };
    const fail = error => send(STATUS[error] || 500, { ok: false, error });

    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail('method'); }
    const origin = req.headers.origin;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!origin || !(origin === `https://${host}` || deps.isAllowedOrigin(origin))) return fail('forbidden');
    if (!deps.apiKey) return fail('not_configured');

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return fail('auth');
    let uid;
    try { uid = await deps.verifyIdToken(token); } catch { uid = null; }
    if (!uid) return fail('auth');

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || (typeof body.text !== 'string' && typeof body.pdf !== 'string')) return fail('bad_request');

    let text = typeof body.text === 'string' ? body.text : '';
    if (typeof body.pdf === 'string') {
      if (body.pdf.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) return fail('too_long');
      const bytes = Buffer.from(body.pdf, 'base64');
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return fail('unreadable');
      try { text = await deps.pdfToText(new Uint8Array(bytes)); } catch { return fail('unreadable'); }
    }
    if (text.length > MAX_TEXT) return fail('too_long');
    if (text.trim().length < 40) return fail('unreadable');

    const now = Date.now();
    try {
      if (!(await deps.allow(`imp_${uid}_${Math.floor(now / 3600000)}`, PER_USER_PER_HOUR, 3600))) return fail('limit');
      if (!(await deps.allow(`site_${Math.floor(now / 60000)}`, SITE_PER_MINUTE, 120))) return fail('busy');
    } catch (err) {
      console.error('rate limit check failed', err);
      return fail('busy');
    }

    try {
      const profile = await extractProfile(text, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl || fetch });
      return send(200, { ok: true, profile });
    } catch (err) {
      if (err instanceof PolishError) return fail(err.code);
      console.error('import failed', err);
      return fail('busy');
    }
  };
}
