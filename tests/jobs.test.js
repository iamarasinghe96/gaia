import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSponsorIndex, normaliseCompany, adSignals, readSearch, buildQueries, searchJobs, classify, shapeJob, SPONSORS, MAX_CALLS, JobsError } from '../lib/jobs.js';
import { normaliseKeywords, extractKeywords, SYSTEM_PROMPT } from '../lib/keywords.js';
import { makeJobsHandler, makeKeywordsHandler } from '../lib/search-handlers.js';

const idx = makeSponsorIndex(['Pinaroo Pty Ltd', 'Woodside Energy Ltd', 'Health Services Australia Pty Ltd', 'IBM AUSTRALIA LTD', 'Crawford & Company (AUSTRALIA) Pty Ltd']);

test('sponsor matching: exact, legal suffixes, contained names and fuzzy', () => {
  assert.equal(normaliseCompany('Crawford & Company (AUSTRALIA) Pty Ltd'), 'crawford');
  assert.equal(idx.match('IBM'), 'IBM AUSTRALIA LTD');
  assert.equal(idx.match('Pinaroo Roma'), 'Pinaroo Pty Ltd');
  assert.equal(idx.match('Woodside'), 'Woodside Energy Ltd');
  assert.equal(idx.match('Crawford and Co.'), 'Crawford & Company (AUSTRALIA) Pty Ltd');
  assert.equal(idx.match('Woodsyde Energy'), 'Woodside Energy Ltd');
});

test('sponsor matching never matches on generic words alone', () => {
  assert.equal(idx.match('Albury Health'), null);
  assert.equal(idx.match('Health Services'), 'Health Services Australia Pty Ltd');
  assert.equal(idx.match('Murray Health Services Group'), null);
  assert.equal(idx.match(''), null);
  assert.ok(SPONSORS.size > 3000);
});

test('ad signals: sponsorship hints and citizen-only roles', () => {
  assert.deepEqual(adSignals('Visa sponsorship available for the right candidate'), { blocked: false, sponsorHint: true });
  assert.deepEqual(adSignals('We can sponsor on a 482 visa'), { blocked: false, sponsorHint: true });
  assert.equal(adSignals('Applicants must be Australian citizens only').blocked, true);
  assert.equal(adSignals('No visa sponsorship is offered for this role').blocked, true);
  assert.equal(adSignals('Baseline security clearance required').blocked, true);
  assert.deepEqual(adSignals('Great team, flexible hours'), { blocked: false, sponsorHint: false });
});

test('readSearch keeps only safe, known values', () => {
  const s = readSearch({ keywords: ['CCTV technician', { term: 'access control', weight: 9 }, 'cctv technician', '<script>', 'x'], categories: ['it-jobs', 'evil', 'it-jobs'], where: 'NSW', maxDays: 3 });
  assert.deepEqual(s.terms.map(t => t.term), ['CCTV technician', 'access control', 'script']);
  assert.equal(s.terms[1].weight, 5);
  assert.deepEqual(s.categories, ['it-jobs']);
  assert.equal(s.where, 'NSW');
  assert.equal(s.maxDays, 30);
  assert.equal(readSearch({ keywords: ['a b'], where: 'Mars' }).where, '');
  assert.throws(() => readSearch({ keywords: [] }), JobsError);
  assert.equal(readSearch({ keywords: Array.from({ length: 30 }, (_, i) => `skill ${i}`) }).terms.length, 8);
});

test('buildQueries never makes more than MAX_CALLS searches', () => {
  const terms = Array.from({ length: 8 }, (_, i) => ({ term: `t${i}x`, weight: i % 5 + 1 }));
  assert.equal(buildQueries({ terms, categories: [] }).length, MAX_CALLS);
  const q = buildQueries({ terms, categories: ['it-jobs', 'engineering-jobs'] });
  assert.equal(q.length, MAX_CALLS);
  assert.equal(q.filter(x => x.category).length, 2);
  assert.deepEqual(buildQueries({ terms: [], categories: ['it-jobs'] }), [{ category: 'it-jobs' }]);
});

const AD = (id, title, company, extra = {}) => ({ id, title, company: { display_name: company }, location: { display_name: 'Albury, NSW' }, created: '2026-10-20T00:00:00Z', redirect_url: `https://www.adzuna.com.au/details/${id}`, description: 'Install and commission CCTV and access control systems.', ...extra });

test('searchJobs: dedupes, cleans text, groups results and keeps keys private', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return { status: 200, json: async () => ({ results: [
      AD(1, '<strong>CCTV</strong> Technician', 'Pinaroo'),
      AD(1, 'CCTV Technician', 'Pinaroo'),
      AD(2, 'Security Systems Engineer', 'SecureTech', { description: 'CCTV install. Visa sponsorship available.' }),
      AD(3, 'CCTV Technician', 'Defence Co', { description: 'CCTV. Must be an Australian citizen.' }),
      AD(4, 'Barista', 'Cafe Ltd', { description: 'Coffee.' }),
      AD(5, 'CCTV Technician', 'Unknown Co', { salary_min: 80000, salary_max: 95000 }),
    ] }) };
  };
  const out = await searchJobs(readSearch({ keywords: [{ term: 'cctv', weight: 5 }], where: 'VIC' }), { appId: 'id', appKey: 'secret-key', fetchImpl, sponsors: idx });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /where=Victoria/);
  assert.equal(out.total, 5);
  const g = out.groups;
  assert.equal(JSON.stringify(out).includes('secret-key'), false);
  assert.equal(g.sponsorHint[0].title, 'Security Systems Engineer');
  assert.equal(g.closed[0].employer, 'Defence Co');
  assert.equal(g.strongOther.find(j => j.id === '5').salary, '$80,000 – $95,000');
  assert.ok(!Object.values(g).flat().some(j => j.title === 'Barista'));
  assert.ok(Object.values(g).flat().every(j => !/[<>]/.test(j.title)));
});

test('classify uses the sponsor list', () => {
  const jobs = [shapeJob(AD(1, 'CCTV Technician', 'Pinaroo Roma'))];
  const g = classify(jobs, { terms: [{ term: 'cctv', weight: 5 }], categories: [] }, idx);
  assert.equal(g.sponsorStrong[0].sponsor, 'Pinaroo Pty Ltd');
});

test('searchJobs errors: bad keys, rate limit, category retry', async () => {
  const s = readSearch({ keywords: ['cctv'] });
  await assert.rejects(searchJobs(s, { appId: '', appKey: '' }), e => e.code === 'not_configured');
  await assert.rejects(searchJobs(s, { appId: 'a', appKey: 'b', fetchImpl: async () => ({ status: 401 }) }), e => e.code === 'not_configured');
  await assert.rejects(searchJobs(s, { appId: 'a', appKey: 'b', fetchImpl: async () => ({ status: 429 }) }), e => e.code === 'busy');
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return /category=/.test(url) ? { status: 400 } : { status: 200, json: async () => ({ results: [AD(9, 'IT Support', 'X')] }) }; };
  const out = await searchJobs(readSearch({ categories: ['it-jobs'] }), { appId: 'a', appKey: 'b', fetchImpl });
  assert.equal(urls.length, 2);
  assert.match(urls[1], /what=IT/);
  assert.equal(out.total, 1);
});

test('keywords: prompt rules, cleaning and JSON mode', async () => {
  assert.match(SYSTEM_PROMPT, /Never add skills/);
  assert.match(SYSTEM_PROMPT, /it-jobs/);
  const n = normaliseKeywords({ titles: ['Electrician', 'electrician', 5], keywords: [{ term: 'Solar', weight: 7 }, 'conduit'], categories: ['trade-construction-jobs', 'bogus'], summary: 'You are an electrician.' });
  assert.deepEqual(n.titles, ['Electrician']);
  assert.deepEqual(n.keywords, [{ term: 'solar', weight: 5 }, { term: 'conduit', weight: 3 }]);
  assert.deepEqual(n.categories, ['trade-construction-jobs']);
  let sent;
  const fetchImpl = async (url, opts) => { sent = JSON.parse(opts.body); return { status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ titles: ['Nurse'], keywords: [{ term: 'aged care', weight: 4 }], categories: ['healthcare-nursing-jobs'], summary: 'x' }) } }] }) }; };
  const out = await extractKeywords('I am a registered nurse in aged care', { apiKey: 'k', fetchImpl });
  assert.equal(sent.response_format.type, 'json_object');
  assert.deepEqual(out.titles, ['Nurse']);
  await assert.rejects(extractKeywords('', { apiKey: 'k', fetchImpl }), e => e.code === 'unreadable');
});

function mockRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const okDeps = extra => ({ isAllowedOrigin: () => false, verifyIdToken: async t => (t === 'good' ? 'u1' : null), allow: async () => true, ...extra });
const req = (body, headers = {}) => ({ method: 'POST', headers: { origin: 'https://gaiasymbiosis.com', host: 'gaiasymbiosis.com', authorization: 'Bearer good', ...headers }, body });

test('jobs handler: origin, sign-in, limits, validation and cache', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return { status: 200, json: async () => ({ results: [AD(1, 'CCTV Technician', 'Pinaroo')] }) }; };
  const h = makeJobsHandler(okDeps({ appId: 'a', appKey: 'b', fetchImpl }));
  let r = mockRes(); await h(req({ keywords: ['cctv'] }, { origin: 'https://evil.example' }), r); assert.equal(r.code, 403);
  r = mockRes(); await h(req({ keywords: ['cctv'] }, { authorization: 'Bearer bad' }), r); assert.equal(r.code, 401);
  r = mockRes(); await h(req({ keywords: [] }), r); assert.equal(r.code, 400);
  r = mockRes(); await h(req({ keywords: ['cctv'] }), r); assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  r = mockRes(); await h(req({ keywords: ['cctv'] }), r); assert.equal(r.code, 200); assert.equal(n, 1);
  r = mockRes(); await makeJobsHandler(okDeps({ appId: '', appKey: '' }))(req({ keywords: ['cctv'] }), r); assert.equal(r.code, 500); assert.equal(r.body.error, 'not_configured');
  r = mockRes(); await makeJobsHandler(okDeps({ appId: 'a', appKey: 'b', fetchImpl, allow: async () => false }))(req({ keywords: ['nurse'] }), r); assert.equal(r.code, 429);
  r = mockRes(); await h({ ...req({}), method: 'GET' }, r); assert.equal(r.code, 405);
});

test('keywords handler: checks input and sign-in', async () => {
  const fetchImpl = async () => ({ status: 200, json: async () => ({ choices: [{ message: { content: '{"titles":["Chef"],"keywords":[],"categories":[],"summary":""}' } }] }) });
  const h = makeKeywordsHandler(okDeps({ apiKey: 'k', fetchImpl }));
  let r = mockRes(); await h(req({ text: 'I cook Sri Lankan food' }), r); assert.equal(r.code, 200); assert.deepEqual(r.body.titles, ['Chef']);
  r = mockRes(); await h(req({ text: 'x'.repeat(20000) }), r); assert.equal(r.code, 413);
  r = mockRes(); await h(req({ nope: 1 }), r); assert.equal(r.code, 400);
  r = mockRes(); await h(req({ text: 'chef' }, { authorization: '' }), r); assert.equal(r.code, 401);
});
