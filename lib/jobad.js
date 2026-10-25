// Job Search Assistant: fetch the full text of one job ad, because the Adzuna API
// only returns the first few hundred characters. Only Adzuna's own ad pages are
// fetched (never any other address), one ad per click.
const HOSTS = new Set(['www.adzuna.com.au', 'adzuna.com.au']);
export const MAX_AD = 20000;

/** Returns a safe https URL for an Adzuna ad page, or null. */
export function adPageUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || !/^\/details\/\d{4,20}$/.test(u.pathname)) return null;
  return `https://www.adzuna.com.au${u.pathname}`;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', hellip: '…' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : (ENT[e.toLowerCase()] ?? m));

/** HTML to readable plain text, keeping paragraphs and bullet points. */
export function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|section|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Pull the job description out of an Adzuna ad page. Returns '' if none is found. */
export function extractAd(html) {
  const page = String(html || '');
  // 1. Structured data (schema.org JobPosting), when the page has it
  for (const m of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = [].concat(data, data && data['@graph'] || []);
    const job = items.find(x => x && /JobPosting/.test([].concat(x['@type'] || []).join(' ')) && x.description);
    if (job) return htmlToText(job.description).slice(0, MAX_AD);
  }
  // 2. The ad body section of the page
  const body = page.match(/<(section|div)[^>]+class=["'][^"']*\badp-body\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (body) return htmlToText(body[2]).slice(0, MAX_AD);
  return '';
}

/** Fetch one ad page and return its full text, or '' if it can't be read. */
export async function fetchAd(url, { fetchImpl = fetch } = {}) {
  const safe = adPageUrl(url);
  if (!safe) return '';
  let res;
  try {
    res = await fetchImpl(safe, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; GaiaSymbiosisJobSearch/1.0; +https://gaiasymbiosis.com)' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch {
    return '';
  }
  if (res.status !== 200) return '';
  const html = await res.text().catch(() => '');
  return extractAd(html.slice(0, 2000000));
}
