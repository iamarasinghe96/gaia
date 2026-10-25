// POST /api/jobad — Job Search Assistant: the full text of one Adzuna ad (the search
// API only returns a short preview). Only Adzuna ad pages are fetched.
import { safeHandler } from '../lib/safe-handler.js';

export default safeHandler(async () => {
  const [{ makeJobAdHandler }, { allow, isAllowedOrigin, verifyIdToken }] = await Promise.all([import('../lib/search-handlers.js'), import('../lib/admin.js')]);
  return makeJobAdHandler({ isAllowedOrigin, verifyIdToken, allow });
});
