import { CHAT_MODELS, groqBody } from './groq.js';
// Proofreading with Groq for "Polish with AI". Pure logic: the HTTP handler supplies
// the API key, fetch and the rate limiter, which keeps this easy to test.

export const MODELS = CHAT_MODELS;   // lib/groq.js
export const MAX_INPUT = 60000;
const CHUNK = 5000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const SYSTEM_PROMPT = [
  'You are a meticulous proofreader for CV content written by job seekers in Australia.',
  "Correct ONLY clear spelling mistakes, grammar errors and punctuation. Keep the writer's own words, voice, tone and sentence structure.",
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

export class PolishError extends Error {
  constructor(code, detail) { super(code); this.code = code; if (detail) this.detail = detail; }
}

/** Splits text into pieces of whole lines, preferring to break at blank lines. Joining with '\n' restores it exactly. */
export function chunk(text, size = CHUNK) {
  const lines = text.split('\n');
  const out = [];
  let start = 0, len = 0, lastBlank = -1;
  for (let i = 0; i < lines.length; i++) {
    len += lines[i].length + 1;
    if (!lines[i].trim()) lastBlank = i;
    if (len >= size) {
      const end = lastBlank > start ? lastBlank : i;
      out.push(lines.slice(start, end + 1).join('\n'));
      start = end + 1;
      lastBlank = -1;
      len = lines.slice(start, i + 1).join('\n').length;
    }
  }
  if (start < lines.length) out.push(lines.slice(start).join('\n'));
  return out;
}

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

/** Proofreads one piece. Returns the original if Groq changes the line layout. Throws PolishError('busy'). */
export async function polishChunk(piece, { apiKey, fetchImpl = fetch, sleep = sleepMs }) {
  const lines = piece.split('\n');
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  const core = lines.slice(a, b).join('\n');
  if (!core.trim() || !/[a-z]/i.test(core)) return { text: piece, skipped: false };

  let busy = false;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetchImpl(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(groqBody(model, {
            model, temperature: 0, max_completion_tokens: 4096,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: core }],
          })),
          signal: AbortSignal.timeout(25000),
        });
      } catch {
        busy = true;                                      // no reply in time: the next model
        break;
      }
      if (res.status === 200) {
        const data = await res.json();
        const choice = (data.choices || [])[0] || {};
        if (choice.finish_reason === 'length') break;    // ran out of room: the next model
        let txt = String(choice.message?.content || '').replace(/\r\n?/g, '\n');
        const fence = txt.match(/```[^\n]*\n([\s\S]*?)\n?```/);
        if (fence) txt = fence[1];
        txt = txt.replace(/^\s*\n/, '').replace(/\s+$/, '');
        const sameLayout = choice.finish_reason !== 'length' && txt.split('\n').length === b - a;
        if (!sameLayout) return { text: piece, skipped: true };
        return { text: [...lines.slice(0, a), ...txt.split('\n'), ...lines.slice(b)].join('\n'), skipped: false };
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 0);
        if (attempt === 0 && wait > 0 && wait <= 12) { await sleep(wait * 1000); continue; }
        busy = true;
      }
      if (res.status >= 500) busy = true;
      break;                                              // busy, retired, too large or erroring: next model
    }
  }
  if (busy) throw new PolishError('busy');
  return { text: piece, skipped: true };
}

/** Proofreads a whole CV bank. Returns { text, skipped }. */
export async function polishText(text, opts) {
  if (!text.trim()) throw new PolishError('empty');
  if (text.length > MAX_INPUT) throw new PolishError('too_long');
  const out = [];
  let skipped = 0;
  for (const piece of chunk(text)) {
    const r = await polishChunk(piece, opts);
    if (r.skipped) skipped++;
    out.push(r.text);
  }
  return { text: out.join('\n'), skipped };
}
