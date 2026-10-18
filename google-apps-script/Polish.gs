/**
 * Gaia Symbiosis: "Polish with AI" proxy for the CV Prompt Builder.
 *
 * Holds the Groq API key on Google's servers (never in the browser), checks the
 * caller is signed in to the site, limits usage, and asks Groq to proofread only.
 *
 * Setup (standalone project at script.google.com, separate from the booking script):
 * 1. New project, paste this file, Save.
 * 2. Project Settings (gear) > Script Properties > Add property:
 *      GROQ_API_KEY = your key from https://console.groq.com/keys
 * 3. Run testPolish once and allow the permissions (it calls Groq with a sample).
 * 4. Deploy > New deployment > Web app: Execute as Me, Who has access: Anyone.
 *    Send the Web app URL to be added to js/firebase-config.js (polishUrl).
 */

const FIREBASE_WEB_API_KEY = 'AIzaSyCRoGQU9TAHv4w21RfZdqjzA7wDbGjHse4';
const SITE = 'https://gaiasymbiosis.com/';
const MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const MAX_INPUT = 60000;          // characters
const CHUNK = 5000;               // characters per Groq request
const PER_USER_PER_HOUR = 8;
const SITE_PER_MINUTE = 15;

const SYSTEM_PROMPT = [
  'You are a meticulous proofreader for CV content written by job seekers in Australia.',
  'Correct ONLY clear spelling mistakes, grammar errors and punctuation. Keep the writer\'s own words, voice, tone and sentence structure.',
  'Do not rephrase, shorten, expand, reorder or "improve" anything that is already correct. When in doubt, leave it exactly as written.',
  '',
  'Follow every rule exactly:',
  '1. Return exactly the same number of lines, in the same order. Never merge, split, add, remove or reorder lines. Keep every blank line where it is.',
  '2. Do not change section headings (lines written in CAPITALS) or any "STORY n:" number.',
  '3. Where a line starts with a label and a colon (for example "Employer:", "Period:", "Title:", "Best used for:"), keep the label exactly as written.',
  '4. Copy lines starting with Full Name, Date of Birth, Address, Mobile, Phone, Email, LinkedIn, Portfolio, Right to Work, Employer, Period, Title or any URL label character for character.',
  '5. Keep every number, figure, percentage, dollar amount, date, email address and URL exactly as written.',
  '6. NEVER change names of people, places, streets, suburbs, organisations, schools, universities, products, projects, qualifications or certifications. This includes names from every language and culture, such as Sinhala, Tamil, Hindi, Chinese, Arabic, Pacific and Aboriginal names. A word you do not recognise is NOT a spelling mistake: leave it exactly as written.',
  '7. Never translate words, change the capitalisation of names or acronyms, or alter technical terms, tools, software or programming languages.',
  '8. Do not add or remove facts, skills, achievements, results or claims.',
  '9. Use Australian English spelling (organisation, programme, licence).',
  '10. Plain text only. Output only the corrected text, with no code block, heading, note or commentary.',
].join('\n');

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply_({ ok: false, error: 'bad_request' }); }

  const uid = verifyUser_(body.idToken);
  if (!uid) return reply_({ ok: false, error: 'auth' });

  const text = String(body.text || '');
  if (!text.trim()) return reply_({ ok: false, error: 'empty' });
  if (text.length > MAX_INPUT) return reply_({ ok: false, error: 'too_long' });

  if (!allow_('u_' + uid, PER_USER_PER_HOUR, 3600)) return reply_({ ok: false, error: 'limit' });
  if (!allow_('site_' + Math.floor(Date.now() / 60000), SITE_PER_MINUTE, 120)) return reply_({ ok: false, error: 'busy' });

  const key = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!key) return reply_({ ok: false, error: 'not_configured' });

  const out = [];
  let skipped = 0;
  for (const chunk of chunks_(text)) {
    const r = polishChunk_(chunk, key);
    if (r.busy) return reply_({ ok: false, error: 'busy' });
    if (r.skipped) skipped++;
    out.push(r.text);
  }
  return reply_({ ok: true, text: out.join('\n'), skipped: skipped });
}

/** Confirms the Firebase sign-in token belongs to a real user of this project. */
function verifyUser_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4000) return null;
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }),
    headers: { Referer: SITE }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  const users = JSON.parse(res.getContentText()).users || [];
  return users.length && users[0].localId ? users[0].localId : null;
}

function allow_(key, max, seconds) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key) || 0);
    if (n >= max) return false;
    cache.put(key, String(n + 1), seconds);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Splits the text into pieces of whole lines, preferring to break at blank lines. */
function chunks_(text) {
  const lines = text.split('\n');
  const out = [];
  let start = 0, size = 0, lastBlank = -1;
  for (let i = 0; i < lines.length; i++) {
    size += lines[i].length + 1;
    if (!lines[i].trim()) lastBlank = i;
    if (size >= CHUNK) {
      const end = lastBlank > start ? lastBlank : i;
      out.push(lines.slice(start, end + 1).join('\n'));
      start = end + 1; lastBlank = -1;
      size = lines.slice(start, i + 1).join('\n').length;
    }
  }
  if (start < lines.length) out.push(lines.slice(start).join('\n'));
  return out;
}

/** Proofreads one chunk. Returns the original text if Groq changes the line layout. */
function polishChunk_(chunk, key) {
  const lines = chunk.split('\n');
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  const core = lines.slice(a, b).join('\n');
  if (!core.trim() || !/[a-z]/i.test(core)) return { text: chunk };

  for (let m = 0; m < MODELS.length; m++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({
          model: MODELS[m], temperature: 0, max_completion_tokens: 4096,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: core }],
        }),
      });
      const code = res.getResponseCode();
      if (code === 200) {
        const data = JSON.parse(res.getContentText());
        const choice = (data.choices || [])[0] || {};
        let txt = String((choice.message || {}).content || '').replace(/\r\n?/g, '\n');
        const fence = txt.match(/```[^\n]*\n([\s\S]*?)\n?```/);
        if (fence) txt = fence[1];
        txt = txt.replace(/^\s*\n/, '').replace(/\s+$/, '');
        const sameLayout = choice.finish_reason !== 'length' && txt.split('\n').length === b - a;
        if (!sameLayout) return { text: chunk, skipped: true };
        return { text: lines.slice(0, a).concat(txt.split('\n'), lines.slice(b)).join('\n') };
      }
      if (code === 429) {
        const wait = Number(res.getHeaders()['retry-after'] || res.getHeaders()['Retry-After'] || 0);
        if (attempt === 0 && wait > 0 && wait <= 12) { Utilities.sleep(wait * 1000); continue; }
        return { busy: true };
      }
      if (code === 400 || code === 404 || code === 413) break;   // model unavailable or request too large: try the next model
      return { busy: true };                                      // 5xx and anything unexpected
    }
  }
  return { text: chunk, skipped: true };
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to grant permissions and check your key works. */
function testPolish() {
  const key = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!key) throw new Error('Add GROQ_API_KEY in Project Settings > Script Properties first.');
  const sample = 'PROFESSIONAL SUMMARY\nI am a experienced project officer who have worked with Wijesinghe Holdings in Kurunegala.';
  console.log(polishChunk_(sample, key));
}
