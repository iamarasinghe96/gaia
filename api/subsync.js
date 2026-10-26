// POST /api/subsync — SubSync: identify a film from overheard dialogue and translate subtitle
// lines (Groq), search and download subtitles (OpenSubtitles). Vercel serverless function.
// Environment variables: GROQ_API_KEY, OPENSUBTITLES_API_KEY, OPENSUBTITLES_USERNAME,
// OPENSUBTITLES_PASSWORD, and the Firebase ones used for sign-in.
import { safeHandler } from '../lib/safe-handler.js';

const env = k => String(process.env[k] || '').trim();

export default safeHandler(async () => {
  const [{ makeSubSyncHandler }, { allow, isAllowedOrigin, verifyIdToken }] = await Promise.all([import('../lib/subsync-handler.js'), import('../lib/admin.js')]);
  return makeSubSyncHandler({
    groqKey: env('GROQ_API_KEY'), osKey: env('OPENSUBTITLES_API_KEY'), osUser: env('OPENSUBTITLES_USERNAME'), osPass: process.env.OPENSUBTITLES_PASSWORD || '',
    isAllowedOrigin, verifyIdToken, allow,
  });
});
