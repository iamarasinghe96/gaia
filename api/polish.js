// POST /api/polish — "Polish with AI" for the CV Prompt Builder (Vercel serverless function).
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   GROQ_API_KEY            Groq key (https://console.groq.com/keys)
//   FIREBASE_PROJECT_ID     gaia-symbiosis
//   FIREBASE_CLIENT_EMAIL   from a Firebase service account key
//   FIREBASE_PRIVATE_KEY    from the same key (paste the whole -----BEGIN PRIVATE KEY----- block)
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { makeHandler } from '../lib/polish-handler.js';

function app() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getApps()[0];
}

const ALLOWED = new Set(['https://gaiasymbiosis.com', 'https://www.gaiasymbiosis.com']);

export default makeHandler({
  apiKey: process.env.GROQ_API_KEY,
  isAllowedOrigin: origin =>
    ALLOWED.has(origin) ||
    (process.env.VERCEL_ENV !== 'production' && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) ||
    (process.env.VERCEL_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/.test(origin)),
  verifyIdToken: async token => (await getAuth(app()).verifyIdToken(token)).uid,
  // Fixed-window counters in Firestore (ratelimits/{id}); browsers can't read or write them.
  allow: async (id, max, ttlSeconds) => {
    const db = getFirestore(app());
    const ref = db.collection('ratelimits').doc(id);
    return db.runTransaction(async t => {
      const snap = await t.get(ref);
      const n = snap.exists ? snap.get('count') || 0 : 0;
      if (n >= max) return false;
      t.set(ref, { count: n + 1, expireAt: Timestamp.fromMillis(Date.now() + ttlSeconds * 1000) });
      return true;
    });
  },
});
