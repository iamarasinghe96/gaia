// Job Search Assistant: search Adzuna, score each job against the user's keywords,
// flag employers on the sponsor list and sort the results into groups.
// Pure logic; the HTTP handler supplies the Adzuna keys and fetch.
import SBS_NAMES from './sbs-companies.js';

export class JobsError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const ADZUNA = 'https://api.adzuna.com/v1/api/jobs/au/search/1';
export const MAX_TERMS = 8;
export const MAX_CALLS = 6;

// Adzuna's Australian job categories (tag -> label)
export const CATEGORIES = {
  'accounting-finance-jobs': 'Accounting & Finance', 'admin-jobs': 'Admin', 'charity-voluntary-jobs': 'Charity & Voluntary',
  'consultancy-jobs': 'Consultancy', 'creative-design-jobs': 'Creative & Design', 'customer-services-jobs': 'Customer Services',
  'domestic-help-cleaning-jobs': 'Domestic help & Cleaning', 'energy-oil-gas-jobs': 'Energy, Oil & Gas', 'engineering-jobs': 'Engineering',
  'graduate-jobs': 'Graduate', 'healthcare-nursing-jobs': 'Healthcare & Nursing', 'hospitality-catering-jobs': 'Hospitality & Catering',
  'hr-jobs': 'HR & Recruitment', 'it-jobs': 'IT', 'legal-jobs': 'Legal', 'logistics-warehouse-jobs': 'Logistics & Warehouse',
  'maintenance-jobs': 'Maintenance', 'manufacturing-jobs': 'Manufacturing', 'other-general-jobs': 'Other/General',
  'pr-advertising-marketing-jobs': 'PR, Advertising & Marketing', 'property-jobs': 'Property', 'retail-jobs': 'Retail',
  'sales-jobs': 'Sales', 'scientific-qa-jobs': 'Scientific & QA', 'social-work-jobs': 'Social work', 'teaching-jobs': 'Teaching',
  'trade-construction-jobs': 'Trade & Construction', 'travel-jobs': 'Travel',
};
export const LOCATIONS = {
  '': '', NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA: 'Western Australia',
  SA: 'South Australia', TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory',
};

// ─── Sponsor list matching ───
const LEGAL = new Set(['pty', 'ltd', 'limited', 'proprietary', 'inc', 'incorporated', 'australia', 'aust', 'aus', 'the', 'co', 'company', 'and', 'p', 'l']);
// Words too common to identify a business on their own
const GENERIC = new Set(['group', 'holdings', 'services', 'service', 'solutions', 'health', 'care', 'medical', 'engineering', 'construction',
  'consulting', 'management', 'enterprises', 'international', 'global', 'national', 'trading', 'industries', 'systems', 'technology',
  'technologies', 'australian', 'partners', 'investments', 'property', 'properties', 'resources', 'school', 'college', 'university',
  'hospital', 'clinic', 'healthcare', 'staff', 'staffing', 'recruitment', 'personnel', 'labour', 'people', 'workforce', 'restaurant', 'cafe', 'hotel', 'trust', 'family', 'new', 'south', 'north', 'east', 'west', 'city', 'council']);
export function normaliseCompany(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(t => t && !LEGAL.has(t)).join(' ');
}
function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
export function makeSponsorIndex(names) {
  const byNorm = new Map(), byToken = new Map();
  for (const original of names) {
    const norm = normaliseCompany(original);
    if (!norm || byNorm.has(norm)) continue;
    byNorm.set(norm, original);
    for (const t of new Set(norm.split(' '))) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(norm);
    }
  }
  const distinctive = tokens => tokens.filter(t => !GENERIC.has(t) && t.length >= 3);
  return {
    size: byNorm.size,
    match(employer) {
      const e = normaliseCompany(employer);
      if (!e) return null;
      if (byNorm.has(e)) return byNorm.get(e);
      const eTokens = e.split(' ');
      const candidates = new Set();
      eTokens.forEach(t => (byToken.get(t) || []).forEach(n => candidates.add(n)));
      let best = null, bestScore = 0;
      for (const n of candidates) {
        const nTokens = n.split(' ');
        // One name starts with the other ("Pinaroo Roma" vs "Pinaroo", "Woodside" vs
        // "Woodside Energy"), but only on words that actually identify a business,
        // never on generic words like "health"
        const [small, big] = nTokens.length <= eTokens.length ? [nTokens, eTokens] : [eTokens, nTokens];
        const key = distinctive(small);
        if (key.length && small.every((t, i) => big[i] === t) && key.join('').length >= 5) return byNorm.get(n);
        const s = similarity(e, n);
        if (s > bestScore) { bestScore = s; best = n; }
      }
      return bestScore >= 0.88 ? byNorm.get(best) : null;
    },
  };
}
export const SPONSORS = makeSponsorIndex(SBS_NAMES);

// ─── Signals in the ad text ───
const BLOCKERS = /\b(australian citizens?( or (australian )?permanent residents?)? only|must (be|hold) (an? )?(australian )?(citizen|citizenship|permanent resident|pr)\b|permanent residents? only|citizens? (and|or) permanent residents? only|(full|unrestricted) (australian )?working rights (are )?(required|essential)|must have (full |unrestricted )?(australian )?working rights|nv1|nv2|negative vetting|baseline (security )?clearance|security clearance (is )?(required|essential)|no (visa )?sponsorship|not (able to )?(offer|offering|provide|providing) (visa )?sponsorship|unable to (offer|provide) (visa )?sponsorship|sponsorship (is )?not (available|offered))\b/i;
const SPONSOR_HINT = /\b(visa sponsorship|sponsorship (is |may be )?(available|offered|provided|considered)|will (consider )?sponsor|happy to sponsor|open to sponsor(ing|ship)?|sponsor(ship)? for the right candidate|482|tss visa|494 visa|186 visa|subclass (482|494|186)|employer[- ]sponsored|dama|labour agreement)\b/i;
export function adSignals(text) {
  const blocked = BLOCKERS.test(text);
  return { blocked, sponsorHint: !blocked && SPONSOR_HINT.test(text) };
}

// ─── Searching ───
const cleanTerm = t => String(t || '').replace(/[^\p{L}\p{N} +#&./-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
/** Validate the request. Returns { terms: [{term, weight}], categories, where, maxDays }. */
export function readSearch(body) {
  const src = body && typeof body === 'object' ? body : {};
  const seen = new Set();
  const terms = (Array.isArray(src.keywords) ? src.keywords : []).map(k => {
    const term = cleanTerm(typeof k === 'string' ? k : k && k.term);
    const w = Number(k && k.weight);
    return { term, weight: Number.isFinite(w) ? Math.min(5, Math.max(1, Math.round(w))) : 3 };
  }).filter(k => k.term.length >= 2 && !seen.has(k.term.toLowerCase()) && seen.add(k.term.toLowerCase())).slice(0, MAX_TERMS);
  const categories = [...new Set((Array.isArray(src.categories) ? src.categories : []).filter(c => typeof c === 'string' && c in CATEGORIES))].slice(0, 3);
  if (!terms.length && !categories.length) throw new JobsError('bad_request');
  const where = typeof src.where === 'string' && src.where in LOCATIONS ? src.where : '';
  const maxDays = [7, 14, 30].includes(Number(src.maxDays)) ? Number(src.maxDays) : 30;
  return { terms, categories, where, maxDays };
}
/** Up to MAX_CALLS Adzuna searches: one per top keyword, plus one per category using the keywords together. */
export function buildQueries({ terms, categories }) {
  const byWeight = [...terms].sort((a, b) => b.weight - a.weight);
  const queries = [];
  const perTerm = categories.length ? Math.max(1, MAX_CALLS - categories.length) : MAX_CALLS;
  byWeight.slice(0, perTerm).forEach(t => queries.push({ what: t.term }));
  const anyOf = byWeight.slice(0, 6).map(t => t.term.split(' ')[0]).join(' ');
  categories.forEach(c => queries.push(anyOf ? { category: c, what_or: anyOf } : { category: c }));
  return queries.slice(0, MAX_CALLS);
}
const decode = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

async function adzuna(query, { appId, appKey, where, maxDays, fetchImpl }) {
  const params = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: '50', max_days_old: String(maxDays), 'content-type': 'application/json' });
  if (where) params.set('where', LOCATIONS[where]);
  for (const [k, v] of Object.entries(query)) params.set(k, v);
  let res;
  try {
    res = await fetchImpl(`${ADZUNA}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch {
    return { ok: false, retry: false };
  }
  if (res.status === 200) {
    const data = await res.json().catch(() => null);
    return { ok: true, results: Array.isArray(data?.results) ? data.results : [] };
  }
  if (res.status === 401 || res.status === 403) throw new JobsError('not_configured');
  if (res.status === 429) throw new JobsError('busy');
  return { ok: false, retry: res.status === 400 && 'category' in query };
}

/** Score one job against the keywords: a keyword in the title counts double. */
export function scoreJob(job, terms, categories) {
  const title = job.title.toLowerCase(), text = `${job.title} ${job.description}`.toLowerCase();
  let score = 0; const hits = [];
  for (const { term, weight } of terms) {
    const t = term.toLowerCase();
    if (title.includes(t)) { score += weight * 2; hits.push(term); } else if (text.includes(t)) { score += weight; hits.push(term); }
  }
  if (job.categoryTag && categories.includes(job.categoryTag)) score += 3;
  return { score, hits };
}
const STRONG = 10;

export function shapeJob(r) {
  const lo = Number(r.salary_min) || 0, hi = Number(r.salary_max) || lo;
  return {
    id: String(r.id || r.redirect_url || ''),
    title: decode(r.title).slice(0, 160),
    employer: decode(r.company?.display_name).slice(0, 120),
    location: decode(r.location?.display_name).slice(0, 120),
    created: String(r.created || '').slice(0, 10),
    url: /^https:\/\/[^\s]+$/.test(String(r.redirect_url || '')) ? String(r.redirect_url) : '',
    description: decode(r.description).slice(0, 1200),
    salary: lo ? (hi > lo ? `$${Math.round(lo).toLocaleString('en-AU')} – $${Math.round(hi).toLocaleString('en-AU')}` : `$${Math.round(lo).toLocaleString('en-AU')}`) : '',
    categoryTag: String(r.category?.tag || ''),
    category: decode(r.category?.label).slice(0, 60),
  };
}

/** Sort shaped jobs into the groups shown on the page. */
export function classify(jobs, { terms, categories }, sponsors = SPONSORS) {
  const groups = { sponsorStrong: [], sponsorHint: [], sponsorOther: [], strongOther: [], closed: [] };
  for (const job of jobs) {
    const { score, hits } = scoreJob(job, terms, categories);
    const sponsor = sponsors.match(job.employer);
    const { blocked, sponsorHint } = adSignals(`${job.title} ${job.description}`);
    const row = { ...job, score, hits: hits.slice(0, 10), sponsor, sponsorHint, blocked };
    if (blocked) { if (sponsor || score >= STRONG) groups.closed.push(row); }
    else if (sponsor && score >= STRONG) groups.sponsorStrong.push(row);
    else if (sponsorHint && score > 0) groups.sponsorHint.push(row);
    else if (sponsor && score > 0) groups.sponsorOther.push(row);
    else if (score >= STRONG) groups.strongOther.push(row);
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score || b.created.localeCompare(a.created));
  groups.strongOther = groups.strongOther.slice(0, 40);
  groups.closed = groups.closed.slice(0, 20);
  return groups;
}

/** Run the searches and return { groups, total, searched }. */
export async function searchJobs(search, { appId, appKey, fetchImpl = fetch, sponsors = SPONSORS }) {
  if (!appId || !appKey) throw new JobsError('not_configured');
  const queries = buildQueries(search);
  const seen = new Map();
  let anyOk = false;
  for (const q of queries) {
    let r = await adzuna(q, { appId, appKey, where: search.where, maxDays: search.maxDays, fetchImpl });
    if (!r.ok && r.retry) { const { category, ...rest } = q; r = await adzuna(Object.keys(rest).length ? rest : { what: CATEGORIES[category] }, { appId, appKey, where: search.where, maxDays: search.maxDays, fetchImpl }); }
    if (!r.ok) continue;
    anyOk = true;
    for (const raw of r.results) {
      const job = shapeJob(raw);
      if (job.id && job.title && !seen.has(job.id)) seen.set(job.id, job);
    }
  }
  if (!anyOk) throw new JobsError('busy');
  const groups = classify([...seen.values()], search, sponsors);
  return { groups, total: seen.size, searched: queries.length, sponsors: sponsors.size };
}
