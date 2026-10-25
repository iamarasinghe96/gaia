// POST /api/jobs — Job Search Assistant: searches Adzuna and flags employers on the
// sponsor list (Vercel serverless function). Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.
// Modules load inside the handler so that any start-up problem is reported as JSON
// with a reason (and logged) instead of a bare HTTP 500.
import { safeHandler } from '../lib/safe-handler.js';

export default safeHandler(async () => {
  const [{ makeJobsHandler }, { allow, isAllowedOrigin, verifyIdToken }] = await Promise.all([import('../lib/search-handlers.js'), import('../lib/admin.js')]);
  const appId = (process.env.ADZUNA_APP_ID || '').trim(), appKey = (process.env.ADZUNA_APP_KEY || '').trim();
  // Names only, never values: which variable this deployment can't see, and which deployment it is
  const missing = [!appId && 'ADZUNA_APP_ID', !appKey && 'ADZUNA_APP_KEY'].filter(Boolean);
  const configDetail = missing.length ? `${missing.join(' and ')} not set in this deployment (${process.env.VERCEL_ENV || 'unknown'} ${String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)})`.trim() : '';
  return makeJobsHandler({ appId, appKey, configDetail, isAllowedOrigin, verifyIdToken, allow });
});
