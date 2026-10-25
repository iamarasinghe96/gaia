// POST /api/jobs — Job Search Assistant: searches Adzuna and flags employers on the
// sponsor list (Vercel serverless function). Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.
// Modules load inside the handler so that any start-up problem is reported as JSON
// with a reason (and logged) instead of a bare HTTP 500.
import { safeHandler } from '../lib/safe-handler.js';

export default safeHandler(async () => {
  const [{ makeJobsHandler }, { allow, isAllowedOrigin, verifyIdToken }] = await Promise.all([import('../lib/search-handlers.js'), import('../lib/admin.js')]);
  return makeJobsHandler({ appId: (process.env.ADZUNA_APP_ID || '').trim(), appKey: (process.env.ADZUNA_APP_KEY || '').trim(), isAllowedOrigin, verifyIdToken, allow });
});
