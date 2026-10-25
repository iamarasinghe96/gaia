// Job Search Assistant: turn "what I do" (or a CV summary) into job titles, weighted
// keywords and job categories for searching Australian job ads. Pure logic.
import { PolishError } from './polish.js';
import { CATEGORIES } from './jobs.js';

export const MAX_TEXT = 12000;
const MODELS = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant'];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const SYSTEM_PROMPT = [
  'You help people in Australia, many of them migrants looking for visa sponsorship, search job ads for roles that fit what they actually do.',
  'You will get either a short description of their work or a summary of their CV.',
  '',
  'Rules:',
  '1. Base everything only on what the person wrote. Never add skills, tools, licences or seniority they did not mention.',
  '2. "titles": 3 to 6 job titles an Australian employer would use in an ad for this person (Australian spelling and terms, e.g. "Electrician", "Registered Nurse", "Data Analyst"). Most likely first.',
  '3. "keywords": 6 to 14 words or short phrases that appear in matching job ads: skills, tools, systems, licences, certifications, industries. Lowercase. Each has a "weight" from 1 (minor) to 5 (core to their work).',
  '4. "categories": 1 to 3 tags from this fixed list, best match first, using the tag exactly: ' + Object.keys(CATEGORIES).join(', ') + '.',
  '5. "summary": one plain sentence describing the kind of role they are looking for, in the second person ("You are ...").',
  '6. Keep names of places, companies and qualifications exactly as written.',
  '7. Output a single JSON object: {"titles": [string], "keywords": [{"term": string, "weight": number}], "categories": [string], "summary": string}. Nothing else.',
].join('\n');

const str = v => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
/** Keep only well-formed values. */
export function normaliseKeywords(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const uniq = t => { const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true; };
  const titles = (Array.isArray(src.titles) ? src.titles : []).map(t => str(t).slice(0, 60)).filter(uniq).slice(0, 6);
  const keywords = (Array.isArray(src.keywords) ? src.keywords : []).map(k => {
    const term = str(typeof k === 'string' ? k : k && k.term).toLowerCase().slice(0, 60);
    const w = Number(k && k.weight);
    return { term, weight: Number.isFinite(w) ? Math.min(5, Math.max(1, Math.round(w))) : 3 };
  }).filter(k => uniq(k.term)).slice(0, 14);
  const categories = [...new Set((Array.isArray(src.categories) ? src.categories : []).filter(c => typeof c === 'string' && c in CATEGORIES))].slice(0, 3);
  return { titles, keywords, categories, summary: str(src.summary).slice(0, 300) };
}

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

/** Returns { titles, keywords, categories, summary }. Throws PolishError('busy' | 'unreadable' | 'too_long'). */
export async function extractKeywords(text, { apiKey, fetchImpl = fetch, sleep = sleepMs }) {
  const input = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (input.length < 3) throw new PolishError('unreadable');
  if (input.length > MAX_TEXT) throw new PolishError('too_long');
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetchImpl(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, temperature: 0.2, max_completion_tokens: 1200, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input }],
          }),
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new PolishError('busy');
      }
      if (res.status === 200) {
        const data = await res.json();
        const choice = (data.choices || [])[0] || {};
        let parsed;
        try { parsed = JSON.parse(String(choice.message?.content || '')); } catch { break; }
        const out = normaliseKeywords(parsed);
        if (!out.titles.length && !out.keywords.length) throw new PolishError('unreadable');
        return out;
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 0);
        if (attempt === 0 && wait > 0 && wait <= 8) { await sleep(wait * 1000); continue; }
        throw new PolishError('busy');
      }
      if ([400, 404, 413].includes(res.status)) break;
      throw new PolishError('busy');
    }
  }
  throw new PolishError('busy');
}
