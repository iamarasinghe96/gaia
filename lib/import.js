// "Import from CV": turn the text of any CV into the CV Prompt Builder's profile fields.
// Pure logic; the HTTP handler supplies the API key and fetch.
import { PolishError } from './polish.js';

export const MAX_TEXT = 60000;
const MODELS = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant'];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Shape of the profile, with the meaning of each field. Mirrors defaultP() in the app.
const SCHEMA = {
  personal: {
    fullName: 'Full name', dob: 'Date of birth',
    street: 'Street address, e.g. "12 Oak Street"', street2: 'Unit, building or second address line', suburb: 'Suburb or city',
    state: 'State or province', postcode: 'Postcode', country: 'Country',
    location: 'City and state, e.g. "Albury, NSW"',
    phone: 'Main phone', phone2: 'Second phone', email: 'Email', linkedin: 'LinkedIn URL', portfolio: 'Portfolio, website or GitHub URL',
    rtwUrl: 'Right-to-work document URL', seekUrl: 'SEEK profile URL', rightToWork: 'Work rights / visa status statement',
    languages: 'Languages spoken, comma separated, with level in brackets if given, e.g. "English (fluent), Sinhala (native)"',
    nic: 'National ID number', sex: 'Sex', civilStatus: 'Marital status', ethnicGroup: 'Ethnic group',
  },
  otherLinks: [{ label: 'Site name, e.g. "Facebook", "Behance", "YouTube"', url: 'Any other profile or website URL not covered above' }],
  summary: { headline: 'Short professional headline', tagline: 'Personal tagline or motto', paragraphs: 'Professional summary / profile / objective text' },
  skills: [{ category: 'Skill group name', items: 'Skills in the group, one per line' }],
  workHistory: [{ title: 'Job title', employer: 'Employer and location', startDate: 'Start date', endDate: 'End date or "Present"', nature: 'Employment type, e.g. "Full-time, Permanent"', description: 'Paragraph describing the position, only if the CV has one', bullets: 'Responsibilities and achievements, one per line. If a point contains a URL, remove it from the sentence and put it on its own line straight after that point as "Link: <the words it belongs to> | <url>"', respUrl: 'URL', milestonesUrl: 'URL' }],
  education: [{ degree: 'Qualification', institution: 'Institution and location', startYear: 'Start year', endYear: 'End year', gpa: 'Grade or GPA', thesis: 'Thesis or major project', notes: 'Other notes', credentialsUrl: 'URL' }],
  certifications: [{ category: 'Group name, e.g. "Technology"', items: 'Certifications and licences, one per line' }],
  publications: { academic: 'Publications, one per line', awards: 'Awards, one per line' },
  storyBank: [{ title: 'Story title', usedFor: 'Roles it suits', text: 'The story' }],
  projects: [{ name: 'Project name', description: 'Description', url: 'URL' }],
  achievements: [{ category: 'Group name', items: 'Achievements, volunteering or activities, one per line' }],
  referees: [{ name: 'Referee name', title: 'Their job title and organisation', email: 'Email', phone: 'Phone', linkedin: 'LinkedIn URL' }],
  usageNotes: 'Leave empty',
};

export const SYSTEM_PROMPT = [
  'You copy information from a CV into a JSON profile. You are a careful data-entry assistant, not a writer.',
  '',
  'Rules:',
  '1. Copy text exactly as it appears in the CV: same words, spelling, capitalisation, names, dates, numbers and URLs. Do not rewrite, summarise, translate, correct or improve anything.',
  '2. Never invent or guess. If the CV does not contain something, use an empty string "" (or an empty list). Do not fill fields with placeholders.',
  '3. Names of people, places and organisations from any language (Sinhala, Tamil, Chinese, Arabic and so on) must be copied exactly.',
  '4. Put every job in workHistory, every qualification in education, every referee in referees, in the order they appear.',
  '5. For "bullets" and "items", put one entry per line (separated by \\n), without bullet symbols.',
  '6. Keep URLs only if they are written in the CV.',
  '7. Output a single JSON object with exactly these keys, and nothing else:',
  JSON.stringify(SCHEMA, null, 1),
].join('\n');

const str = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n') : '').replace(/\r\n?/g, '\n').trim().slice(0, 20000);

/** Keep only known fields, coerce to strings, cap sizes. */
export function normalizeProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const obj = (shape, value) => {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const out = {};
    for (const k of Object.keys(shape)) out[k] = str(v[k]);
    return out;
  };
  const out = {};
  for (const [key, shape] of Object.entries(SCHEMA)) {
    if (Array.isArray(shape)) {
      const list = Array.isArray(src[key]) ? src[key].slice(0, 40) : [];
      const rows = list.map(item => obj(shape[0], item)).filter(row => Object.values(row).some(Boolean));
      out[key] = rows.length ? rows : [obj(shape[0], {})];
    } else if (typeof shape === 'object') {
      out[key] = obj(shape, src[key]);
    } else {
      out[key] = '';
    }
  }
  return out;
}

export const filledSections = p =>
  ['personal', 'summary', 'skills', 'workHistory', 'education', 'certifications', 'projects', 'achievements', 'referees']
    .filter(k => (Array.isArray(p[k]) ? p[k] : [p[k]]).some(row => Object.values(row).some(Boolean))).length;

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

/** Returns a normalised profile. Throws PolishError('busy' | 'empty' | 'too_long' | 'unreadable'). */
export async function extractProfile(text, { apiKey, fetchImpl = fetch, sleep = sleepMs }) {
  const cv = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (cv.length < 40) throw new PolishError('unreadable');
  if (cv.length > MAX_TEXT) throw new PolishError('too_long');
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetchImpl(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, temperature: 0, max_completion_tokens: 8192, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: 'CV:\n\n' + cv }],
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch {
        throw new PolishError('busy');
      }
      if (res.status === 200) {
        const data = await res.json();
        const choice = (data.choices || [])[0] || {};
        if (choice.finish_reason === 'length') break;                 // too long for this model: try the next
        let parsed;
        try { parsed = JSON.parse(String(choice.message?.content || '')); } catch { break; }
        const profile = normalizeProfile(parsed);
        if (!filledSections(profile)) throw new PolishError('unreadable');
        return profile;
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 0);
        if (attempt === 0 && wait > 0 && wait <= 12) { await sleep(wait * 1000); continue; }
        throw new PolishError('busy');
      }
      if ([400, 404, 413].includes(res.status)) break;
      throw new PolishError('busy');
    }
  }
  throw new PolishError('busy');
}
