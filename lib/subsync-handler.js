// POST /api/subsync for SubSync. Same protections as the other tools: same-site Origin,
// Firebase sign-in, per-user and site-wide rate limits, input checks, and no keys or raw errors
// in responses. Body: { action: 'identify' | 'translate' | 'search' | 'download', ... }.
import { replier, guard, limits } from './search-handlers.js';
import { SubSyncError, identifyFilm, readTranslate, translateLines, readSearch, searchSubtitles, downloadSubtitle, makeTokenStore } from './subsync.js';

const NEEDS = {
  identify: ['groqKey'], translate: ['groqKey'], search: ['osKey'], download: ['osKey', 'osUser', 'osPass'],
};
const ENV = { groqKey: 'GROQ_API_KEY', osKey: 'OPENSUBTITLES_API_KEY', osUser: 'OPENSUBTITLES_USERNAME', osPass: 'OPENSUBTITLES_PASSWORD' };

/** deps: { verifyIdToken, allow, isAllowedOrigin, groqKey, osKey, osUser, osPass, fetchImpl?, tokens?, files? } */
export function makeSubSyncHandler(deps) {
  const tokens = deps.tokens || makeTokenStore();
  const files = deps.files || new Map();         // the same file again within the hour costs no download
  const fetchImpl = deps.fetchImpl || fetch;
  return async function handler(req, res) {
    const r = replier(res);
    const g = await guard(req, res, deps, true, r);
    if (!g) return;
    const { body, uid } = g;
    const action = typeof body.action === 'string' && Object.hasOwn(NEEDS, body.action) ? body.action : null;
    if (!action) return r.fail('bad_request');
    const missing = NEEDS[action].filter(k => !deps[k]).map(k => ENV[k]);
    if (missing.length) return r.fail('not_configured', `Missing on the server: ${missing.join(', ')}`);
    const now = Date.now(), hour = Math.floor(now / 3600000), minute = Math.floor(now / 60000);
    const ai = { apiKey: deps.groqKey, fetchImpl };
    try {
      if (action === 'identify') {
        if (typeof body.transcript !== 'string') return r.fail('bad_request');
        if (!(await limits(r, deps, [[`ss_id_${uid}_${hour}`, 15, 3600, 'limit'], [`ss_ai_site_${minute}`, 40, 120, 'busy']]))) return;
        return r.ok({ guesses: await identifyFilm(body.transcript, ai) });
      }
      if (action === 'translate') {
        const job = readTranslate(body);
        if (!(await limits(r, deps, [[`ss_tr_${uid}_${hour}`, 150, 3600, 'limit'], [`ss_ai_site_${minute}`, 40, 120, 'busy']]))) return;
        return r.ok({ t: await translateLines(job, ai) });
      }
      if (action === 'search') {
        const q = readSearch(body);
        if (!(await limits(r, deps, [[`ss_se_${uid}_${hour}`, 40, 3600, 'limit']]))) return;
        return r.ok({ hits: await searchSubtitles(q, { apiKey: deps.osKey, fetchImpl }) });
      }
      const fileId = Number(body.fileId);
      if (!Number.isSafeInteger(fileId) || fileId <= 0) return r.fail('bad_request');
      const hit = files.get(fileId);
      if (hit && now - hit.at < 3600000) return r.ok({ ...hit.file, remaining: null });
      if (!(await limits(r, deps, [[`ss_dl_${uid}_${Math.floor(now / 86400000)}`, 10, 86400, 'limit']]))) return;
      const file = await downloadSubtitle(fileId, { apiKey: deps.osKey, username: deps.osUser, password: deps.osPass, fetchImpl, tokens });
      files.set(fileId, { at: now, file: { name: file.name, text: file.text } });
      if (files.size > 40) files.delete(files.keys().next().value);
      return r.ok(file);
    } catch (err) {
      if (err instanceof SubSyncError) {
        if (err.detail) console.error(`subsync ${action}: ${err.code}`, err.detail);
        return r.fail(err.code);
      }
      console.error(`subsync ${action} failed`, err);
      return r.fail('busy');
    }
  };
}
