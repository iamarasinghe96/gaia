// translator.js
// Subtitle translation with client-side caching.
//
// Two providers, with different shapes:
//   groq     — batched. Sends ~40 lines per request, so a feature film is a few
//              dozen calls rather than a couple of thousand. Runs on the Gaia
//              Symbiosis server, so it needs Google sign-in but no key.
//   mymemory — key-less, but one request per line and a small daily character
//              quota, so it can't realistically finish a whole film. Kept as a
//              fallback for short files and for anyone not signed in.

import { getCachedTranslation, putCachedTranslation } from './store.js';
import { call } from './api.js';

const PROVIDERS = {
  groq: {
    label: 'Groq AI (sign in with Google, much better Sinhala)',
    needsSignIn: true,
    batchSize: 40,

    // The prompt and the Groq key are on the Gaia Symbiosis server.
    async translateBatch(texts, src, tgt) {
      let out;
      try {
        ({ t: out } = await call({ action: 'translate', lines: texts, src, tgt }));
      } catch (err) {
        // A count mismatch would silently shift every later subtitle onto the
        // wrong line, so the server fails that batch rather than guessing.
        if (err.message === 'mismatch') throw new Error('count-mismatch');
        if (err.message === 'busy') throw new Error('rate-limited');
        throw err;
      }
      if (!Array.isArray(out) || out.length !== texts.length) throw new Error('count-mismatch');
      return out.map((s) => (typeof s === 'string' ? s : ''));
    },
  },

  mymemory: {
    label: 'MyMemory (free, no key, small daily quota)',
    needsSignIn: false,

    async translate(text, src, tgt, signal) {
      const url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(text) +
        '&langpair=' +
        encodeURIComponent(`${src}|${tgt}`);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      const out = data?.responseData?.translatedText;
      if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) {
        throw new Error('quota-or-invalid');
      }
      return out;
    },
  },
};

export function providerLabel(id) {
  return PROVIDERS[id]?.label || id;
}

export function providerNeedsSignIn(id) {
  return !!PROVIDERS[id]?.needsSignIn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(['signin', 'signin-unavailable', 'auth', 'not_configured', 'limit', 'network']);

/**
 * Translate an array of cues. Adds `.translated` to each cue in place.
 * options: { src, tgt, endpoint, concurrency, onProgress, signal }
 * Returns { done, failed }.
 */
export async function translateCues(cues, options) {
  const {
    src, tgt, endpoint = 'groq',
    concurrency = 3, onProgress = () => {}, signal,
  } = options;

  const provider = PROVIDERS[endpoint] || PROVIDERS.groq;

  // Repeated lines ("Yes.", "Come on!") are translated once.
  const unique = [...new Set(cues.map((c) => c.text))];
  const results = new Map();

  // Anything already cached costs nothing, including from a previous run that
  // failed partway.
  const pending = [];
  for (const text of unique) {
    const hit = await getCachedTranslation(text, src, tgt);
    if (hit) results.set(text, hit);
    else pending.push(text);
  }

  let done = unique.length - pending.length;
  let failed = 0;
  onProgress(done, unique.length, failed);

  const record = async (text, value) => {
    if (value) {
      results.set(text, value);
      await putCachedTranslation(text, src, tgt, value);
    } else {
      failed++;
    }
    done++;
  };

  if (provider.translateBatch) {
    const size = provider.batchSize || 25;
    let waits = 0;
    for (let i = 0; i < pending.length; i += size) {
      if (signal?.aborted) break;
      const batch = pending.slice(i, i + size);
      try {
        const out = await provider.translateBatch(batch, src, tgt, signal);
        for (let j = 0; j < batch.length; j++) await record(batch[j], out[j]);
        waits = 0;
      } catch (err) {
        if (signal?.aborted) break;
        // Not signed in, switched off, or over the hourly limit: every remaining
        // batch would fail too — stop rather than burning through the file to prove it.
        if (STOP.has(err.message)) throw err;
        if (err.message === 'rate-limited' && waits < 4) { waits++; await sleep(6000); i -= size; continue; }
        waits = 0;
        for (const text of batch) await record(text, null);
      }
      onProgress(done, unique.length, failed);
      await sleep(400);   // stay under the free tier's per-minute ceiling
    }
  } else {
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        if (signal?.aborted) return;
        const text = pending[cursor++];
        try {
          await record(text, await provider.translate(text, src, tgt, signal));
        } catch {
          if (signal?.aborted) return;
          await record(text, null);
        }
        onProgress(done, unique.length, failed);
        await sleep(120);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, worker),
    );
  }

  for (const c of cues) {
    c.translated = results.get(c.text) || c.translated || null;
  }
  return { done, failed };
}
