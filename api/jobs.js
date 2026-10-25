// POST /api/jobs — Job Search Assistant: searches Adzuna and flags employers on the
// sponsor list (Vercel serverless function). Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.
import { makeJobsHandler } from '../lib/search-handlers.js';
import { allow, isAllowedOrigin, verifyIdToken } from '../lib/admin.js';

export default makeJobsHandler({ appId: process.env.ADZUNA_APP_ID, appKey: process.env.ADZUNA_APP_KEY, isAllowedOrigin, verifyIdToken, allow });
