import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, extractProfile, filledSections, SYSTEM_PROMPT } from '../lib/import.js';
import { makeImportHandler } from '../lib/import-handler.js';

const reply = obj => ({ status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }] }) });
const status = (code, h = {}) => ({ status: code, headers: new Headers(h), json: async () => ({}) });
const CV = 'Nimal Wijesinghe\nProject Officer, Kurunegala Holdings, 2020 - Present\n- Led a team of 12 analysts';
const AI = { personal: { fullName: 'Nimal Wijesinghe', email: 'nimal@example.com', hacker: 'x' }, workHistory: [{ title: 'Project Officer', employer: 'Kurunegala Holdings', startDate: '2020', endDate: 'Present', bullets: ['Led a team of 12 analysts'] }], evil: { a: 1 } };

test('normalizeProfile keeps only known fields as strings', () => {
  const p = normalizeProfile(AI);
  assert.equal(p.personal.fullName, 'Nimal Wijesinghe');
  assert.equal(p.personal.hacker, undefined);
  assert.equal(p.evil, undefined);
  assert.equal(p.workHistory[0].bullets, 'Led a team of 12 analysts');
  assert.deepEqual(Object.keys(p.education[0]), ['degree', 'institution', 'startYear', 'endYear', 'majors', 'gpa', 'thesis', 'notes', 'credentialsUrl']);
  assert.equal(p.usageNotes, undefined);
  assert.equal(filledSections(p), 2);
});

test('normalizeProfile survives garbage', () => {
  const p = normalizeProfile('not an object');
  assert.equal(filledSections(p), 0);
  assert.equal(typeof p.personal.fullName, 'string');
});

test('prompt forbids rewriting and inventing, and protects names', () => {
  assert.match(SYSTEM_PROMPT, /Copy text exactly/);
  assert.match(SYSTEM_PROMPT, /Never invent/);
  assert.match(SYSTEM_PROMPT, /Sinhala/);
});

test('extractProfile returns the profile from JSON mode', async () => {
  let sent;
  const p = await extractProfile(CV, { apiKey: 'k', fetchImpl: async (u, init) => { sent = JSON.parse(init.body); return reply(AI); } });
  assert.equal(p.personal.fullName, 'Nimal Wijesinghe');
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.equal(sent.temperature, 0);
});

test('extractProfile falls back when a reply is cut off or not JSON', async () => {
  let n = 0;
  const p = await extractProfile(CV, { apiKey: 'k', fetchImpl: async () => (++n === 1
    ? { status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }) }
    : reply(AI)) });
  assert.equal(n, 2);
  assert.equal(p.workHistory[0].employer, 'Kurunegala Holdings');
});

test('extractProfile reports unreadable, busy and too long', async () => {
  await assert.rejects(extractProfile('short', { apiKey: 'k' }), e => e.code === 'unreadable');
  await assert.rejects(extractProfile(CV, { apiKey: 'k', fetchImpl: async () => reply({}) }), e => e.code === 'unreadable');
  await assert.rejects(extractProfile(CV, { apiKey: 'k', fetchImpl: async () => status(429, { 'retry-after': '60' }) }), e => e.code === 'busy');
  await assert.rejects(extractProfile('x'.repeat(60001), { apiKey: 'k' }), e => e.code === 'too_long');
});

function mockRes() { const r = { code: 0, headers: {}, body: null }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; }
const deps = (over = {}) => {
  const counts = {};
  return { apiKey: 'k', isAllowedOrigin: o => o === 'https://gaiasymbiosis.com', verifyIdToken: async t => (t === 'good' ? 'u1' : null),
    allow: async (id, max) => { counts[id] = (counts[id] || 0) + 1; return counts[id] <= max; },
    fetchImpl: async () => reply(AI), pdfToText: async () => CV, ...over };
};
const req = (body, headers = {}) => ({ method: 'POST', headers: { origin: 'https://gaiasymbiosis.com', authorization: 'Bearer good', ...headers }, body });

test('import handler fills a profile from text', async () => {
  const res = mockRes();
  await makeImportHandler(deps())(req({ text: CV }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.profile.personal.fullName, 'Nimal Wijesinghe');
});

test('import handler reads PDFs and rejects files that are not PDFs', async () => {
  let res = mockRes();
  await makeImportHandler(deps())(req({ pdf: Buffer.from('%PDF-1.7 test').toString('base64') }), res);
  assert.equal(res.code, 200);
  res = mockRes();
  await makeImportHandler(deps())(req({ pdf: Buffer.from('MZ not a pdf').toString('base64') }), res);
  assert.equal(res.code, 422);
});

test('import handler requires sign-in, same site and limits use', async () => {
  let res = mockRes();
  await makeImportHandler(deps())(req({ text: CV }, { authorization: 'Bearer bad' }), res);
  assert.equal(res.code, 401);
  res = mockRes();
  await makeImportHandler(deps())(req({ text: CV }, { origin: 'https://evil.example' }), res);
  assert.equal(res.code, 403);
  const h = makeImportHandler(deps());
  for (let i = 0; i < 7; i++) { res = mockRes(); await h(req({ text: CV }), res); }
  assert.equal(res.code, 429);
});

test('extractProfile moves on to the next model when one is busy, retired or erroring', async () => {
  const seen = [];
  const codes = [429, 404, 500];
  const p = await extractProfile(CV, { apiKey: 'k', sleep: async () => {}, fetchImpl: async (url, init) => {
    seen.push(JSON.parse(init.body).model);
    return seen.length <= codes.length ? status(codes[seen.length - 1], {}) : reply(AI);
  } });
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4);
  assert.equal(p.workHistory[0].employer, 'Kurunegala Holdings');
  await assert.rejects(extractProfile(CV, { apiKey: 'k', fetchImpl: async () => status(413, {}) }),
    e => e.code === 'busy' && /HTTP 413/.test(e.detail) && !/\bk\b/.test(e.detail.replace(/[a-z-]+\//g, '')));
  let asked;
  await extractProfile(CV, { apiKey: 'k', fetchImpl: async (u, init) => { asked = JSON.parse(init.body).max_completion_tokens; return reply(AI); } });
  assert.ok(asked >= 2048 && asked <= 8192);
});

test('gpt-oss models go first, with short thinking and room for it', async () => {
  const { CHAT_MODELS, groqBody } = await import('../lib/groq.js');
  assert.match(CHAT_MODELS[0], /^openai\/gpt-oss-/);
  const b = groqBody('openai/gpt-oss-120b', { model: 'openai/gpt-oss-120b', max_completion_tokens: 1200 });
  assert.equal(b.reasoning_effort, 'low');
  assert.equal(b.max_completion_tokens, 1200 + 2048);
  assert.deepEqual(groqBody('llama-3.1-8b-instant', { max_completion_tokens: 1200 }), { max_completion_tokens: 1200 });
  let sent;
  await extractProfile(CV, { apiKey: 'k', fetchImpl: async (u, init) => { sent = JSON.parse(init.body); return reply(AI); } });
  assert.equal(sent.model, CHAT_MODELS[0]);
  assert.equal(sent.reasoning_effort, 'low');
});
