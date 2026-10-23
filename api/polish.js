// POST /api/polish — spelling and grammar check for the CV Prompt Builder (Vercel serverless function).
// Environment variables: GROQ_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
import { makeHandler } from '../lib/polish-handler.js';
import { allow, isAllowedOrigin, verifyIdToken } from '../lib/admin.js';

export default makeHandler({ apiKey: process.env.GROQ_API_KEY, isAllowedOrigin, verifyIdToken, allow });
