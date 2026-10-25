// POST /api/keywords — Job Search Assistant: AI turns "what I do" or a CV summary into
// job titles, keywords and categories (Vercel serverless function). Uses GROQ_API_KEY.
import { makeKeywordsHandler } from '../lib/search-handlers.js';
import { allow, isAllowedOrigin, verifyIdToken } from '../lib/admin.js';

export default makeKeywordsHandler({ apiKey: process.env.GROQ_API_KEY, isAllowedOrigin, verifyIdToken, allow });
