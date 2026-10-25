// POST /api/keywords — Job Search Assistant: AI turns "what I do" or a CV summary into
// job titles, keywords and categories (Vercel serverless function). Uses GROQ_API_KEY.
import { safeHandler } from '../lib/safe-handler.js';

export default safeHandler(async () => {
  const [{ makeKeywordsHandler }, { allow, isAllowedOrigin, verifyIdToken }] = await Promise.all([import('../lib/search-handlers.js'), import('../lib/admin.js')]);
  return makeKeywordsHandler({ apiKey: process.env.GROQ_API_KEY, isAllowedOrigin, verifyIdToken, allow });
});
