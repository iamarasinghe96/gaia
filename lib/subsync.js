// SubSync: work out which film is playing and translate subtitle lines (Groq), and
// search and download subtitle files (OpenSubtitles). Pure logic; keys come from the caller.

export class SubSyncError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

export const LANGS = { en: 'English', si: 'Sinhala', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', zh: 'Chinese' };
export const MAX_TRANSCRIPT = 4000;
export const MAX_LINES = 40;
export const MAX_LINE = 500;
const MAX_FILE = 3 * 1024 * 1024;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'];
const OS_URL = 'https://api.opensubtitles.com/api/v1';
const OS_AGENT = 'GaiaSymbiosis SubSync v1.0';
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

// json_object mode is supported far more widely across Groq's models than
// json_schema, so the shape is specified in the prompt and validated here.
export const IDENTIFY_PROMPT = `You identify films from short, noisy snippets of their dialogue.

The transcript comes from a phone microphone pointed at a TV, so expect dropped
words, misheard names and run-together lines. Work from distinctive phrasing,
character names and subject matter rather than exact wording.

Reply with JSON only, in exactly this shape:

{"guesses": [{"title": "…", "year": 1999, "confidence": "high", "why": "…"}]}

Rules:
- At most 4 guesses, most likely first.
- "confidence" is exactly one of "high", "medium", "low". Use "high" only when
  the dialogue is genuinely distinctive to one film.
- "year" is the release year as a number. Use 0 if you truly don't know it.
- "why" is one short sentence naming the specific clue you used.
- If the snippet is generic small talk that could belong to almost anything,
  return low confidence or an empty list. Do not invent a plausible title.`;

export function translatePrompt(src, tgt) {
  return `You translate film subtitles from ${LANGS[src]} into ${LANGS[tgt]}.

You receive a JSON array of subtitle lines. Reply with JSON only, in exactly
this shape, with the translations in the same order and the same count:

{"t": ["…", "…"]}

Rules:
- Translate every line. Never merge, split, drop or reorder lines, and never
  add commentary — the count must match exactly.
- Keep any newline inside a line where it is; subtitles are laid out in two
  short lines and that break matters.
- Use natural spoken ${LANGS[tgt]}, the way people actually talk, not a
  stiff literal rendering. These are characters speaking to each other.
- Leave proper nouns, place names and brand names in their usual form.
- Preserve the tone: keep swearing as swearing, jokes as jokes, and keep
  formal or informal address consistent with the speaker.
- Keep lines short enough to read on screen in the time available.
- If a line is only a sound effect or music marker like [gunshot] or ♪,
  return it unchanged.`;
}

/** One JSON answer from Groq, trying the next model when one is busy or retired. */
async function groqJSON({ system, user, maxTokens, temperature, apiKey, fetchImpl = fetch, sleep = sleepMs }) {
  let busy = false;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetchImpl(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, temperature, max_completion_tokens: maxTokens, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch {
        throw new SubSyncError('busy');
      }
      if (res.status === 200) {
        const choice = ((await res.json()).choices || [])[0] || {};
        if (choice.finish_reason === 'length') break;
        try { return JSON.parse(String(choice.message?.content || '')); } catch { break; }
      }
      if (res.status === 429) {
        busy = true;
        const wait = Number(res.headers.get('retry-after') || 0);
        if (attempt === 0 && wait > 0 && wait <= 8) { await sleep(wait * 1000); continue; }
        break;
      }
      if ([400, 404, 413].includes(res.status)) break;
      throw new SubSyncError('busy');
    }
  }
  throw new SubSyncError(busy ? 'busy' : 'unreadable');
}

const CONFIDENCES = new Set(['high', 'medium', 'low']);
const text = (v, max) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Keep only well-formed guesses. */
export function normaliseGuesses(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.guesses)) return [];
  return raw.guesses
    .filter(g => g && typeof g.title === 'string' && g.title.trim())
    .slice(0, 4)
    .map(g => ({
      title: text(g.title, 120),
      year: Number.isInteger(g.year) && g.year > 1800 && g.year < 2200 ? g.year : null,
      confidence: CONFIDENCES.has(g.confidence) ? g.confidence : 'low',
      why: text(g.why, 240),
    }));
}

/** Candidate films for a snippet of overheard dialogue. */
export async function identifyFilm(transcript, opts) {
  const heard = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (heard.length < 12) throw new SubSyncError('unreadable');
  if (heard.length > MAX_TRANSCRIPT) throw new SubSyncError('too_long');
  const raw = await groqJSON({ ...opts, system: IDENTIFY_PROMPT, user: `Dialogue heard from the film:\n\n"""${heard}"""`, maxTokens: 700, temperature: 0.2 });
  return normaliseGuesses(raw);
}

/** Checks a translate request; returns { lines, src, tgt } or throws bad_request / too_long. */
export function readTranslate(body) {
  const { lines, src, tgt } = body || {};
  if (!Array.isArray(lines) || !lines.length || !(src in LANGS) || !(tgt in LANGS) || src === tgt) throw new SubSyncError('bad_request');
  if (lines.length > MAX_LINES) throw new SubSyncError('too_long');
  if (!lines.every(l => typeof l === 'string')) throw new SubSyncError('bad_request');
  if (lines.some(l => l.length > MAX_LINE)) throw new SubSyncError('too_long');
  return { lines, src, tgt };
}

/** Translations in the same order and count. A count mismatch would shift every later line, so it fails. */
export async function translateLines({ lines, src, tgt }, opts) {
  // Sinhala is script-heavy: budget well above the input's token count.
  const out = await groqJSON({ ...opts, system: translatePrompt(src, tgt), user: JSON.stringify(lines), maxTokens: 8000, temperature: 0.3 });
  if (!out || !Array.isArray(out.t) || out.t.length !== lines.length) throw new SubSyncError('mismatch');
  return out.t.map(s => (typeof s === 'string' ? s.slice(0, MAX_LINE * 3) : ''));
}

/** Checks a search request; returns { title, year, language }. */
export function readSearch(body) {
  const title = text(body && body.title, 120);
  const year = Number(body && body.year);
  const language = body && body.language;
  if (title.length < 1 || !(language in LANGS)) throw new SubSyncError('bad_request');
  return { title, year: Number.isInteger(year) && year > 1800 && year < 2200 ? year : null, language };
}

// OpenSubtitles explains refusals in the body; keep a short, key-free version for the log.
async function explain(res) {
  try {
    const body = await res.json();
    const msg = body?.message || (Array.isArray(body?.errors) ? body.errors.join('; ') : '');
    return String(msg).slice(0, 160);
  } catch { return ''; }
}

const osHeaders = (apiKey, token, json) => ({
  'Api-Key': apiKey, 'User-Agent': OS_AGENT, Accept: 'application/json',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function osFetch(fetchImpl, url, init) {
  try { return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) }); } catch { throw new SubSyncError('busy'); }
}

/** Search by film title. Most-downloaded first: the release most people actually have. */
export async function searchSubtitles({ title, year, language }, { apiKey, fetchImpl = fetch }) {
  const params = new URLSearchParams({ languages: language, query: title, type: 'movie' });
  if (year) params.set('year', String(year));
  const res = await osFetch(fetchImpl, `${OS_URL}/subtitles?${params}`, { headers: osHeaders(apiKey) });
  if (res.status === 401 || res.status === 403) throw new SubSyncError('os_auth', await explain(res));
  if (res.status === 429) throw new SubSyncError('busy');
  if (!res.ok) throw new SubSyncError('busy', `HTTP ${res.status}`);
  const { data } = await res.json();
  return (Array.isArray(data) ? data : [])
    .map(row => {
      const a = row.attributes || {};
      const file = (a.files || [])[0] || {};
      return {
        fileId: Number(file.file_id) || 0,
        name: text(file.file_name || a.release || title, 200),
        release: text(a.release, 200),
        downloads: Number(a.download_count) || 0,
        language: text(a.language, 10),
        filmTitle: text(a.feature_details?.title || title, 120),
        filmYear: Number(a.feature_details?.year) || null,
      };
    })
    .filter(s => s.fileId > 0)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, 20);
}

/** Login tokens last about a day; keep one per server instance and log in again well before. */
export function makeTokenStore(now = () => Date.now()) {
  let held = null;
  return {
    get: () => (held && now() < held.until ? held.value : null),
    set: value => { held = { value, until: now() + 20 * 3600 * 1000 }; },
    clear: () => { held = null; },
  };
}

async function login({ apiKey, username, password, fetchImpl, tokens }) {
  const have = tokens.get();
  if (have) return have;
  const res = await osFetch(fetchImpl, `${OS_URL}/login`, { method: 'POST', headers: osHeaders(apiKey, null, true), body: JSON.stringify({ username, password }) });
  if (res.status === 401 || res.status === 403) throw new SubSyncError('os_auth', await explain(res));
  if (!res.ok) throw new SubSyncError('busy', `HTTP ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new SubSyncError('os_auth', 'no token');
  tokens.set(token);
  return token;
}

/** Only OpenSubtitles' own download links are fetched. */
export function isDownloadLink(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' && /(^|\.)opensubtitles\.(com|org)$/i.test(u.hostname);
  } catch { return false; }
}

/** A search hit to .srt text. Two hops: /download hands back a short-lived link, which serves the file. */
export async function downloadSubtitle(fileId, { apiKey, username, password, fetchImpl = fetch, tokens }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login({ apiKey, username, password, fetchImpl, tokens });
    const res = await osFetch(fetchImpl, `${OS_URL}/download`, { method: 'POST', headers: osHeaders(apiKey, token, true), body: JSON.stringify({ file_id: fileId }) });
    if (res.status === 401 && attempt === 0) { tokens.clear(); continue; }   // token expired early
    if (res.status === 406) throw new SubSyncError('os_quota');
    if (res.status === 401 || res.status === 403) throw new SubSyncError('os_auth', await explain(res));
    if (res.status === 429) throw new SubSyncError('busy');
    if (!res.ok) throw new SubSyncError('busy', `HTTP ${res.status}`);
    const { link, file_name: name, remaining } = await res.json();
    if (!isDownloadLink(link)) throw new SubSyncError('busy', 'unexpected download link');
    const file = await osFetch(fetchImpl, link, { headers: { 'User-Agent': OS_AGENT } });
    if (!file.ok) throw new SubSyncError('busy', `file HTTP ${file.status}`);
    const body = await file.text();
    if (body.length > MAX_FILE) throw new SubSyncError('too_long');
    return { name: text(name, 200) || 'subtitles.srt', text: body, remaining: Number.isInteger(remaining) ? remaining : null };
  }
  throw new SubSyncError('os_auth');
}
