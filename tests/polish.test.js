import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, polishChunk, polishText, PolishError, MODELS } from '../lib/polish.js';
import { makeHandler } from '../lib/polish-handler.js';

const groq = (fn) => async (url, init) => {
  const body = JSON.parse(init.body);
  return fn(body);
};
const ok = content => ({ status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) });
const status = (code, headers = {}) => ({ status: code, headers: new Headers(headers), json: async () => ({}) });

test('chunk splits on whole lines and rejoins exactly', () => {
  const text = ('PROFESSIONAL SUMMARY\nI am a experienced officer.\n\n').repeat(500);
  const parts = chunk(text);
  assert.ok(parts.length > 1);
  assert.equal(parts.join('\n'), text);
  assert.ok(Math.max(...parts.map(p => p.length)) <= 5000);
});

test('polishChunk returns the correction and keeps surrounding blank lines', async () => {
  const r = await polishChunk('\nI am a experienced officer.\n', { apiKey: 'k', fetchImpl: groq(b => ok(b.messages[1].content.replace('a experienced', 'an experienced'))) });
  assert.equal(r.text, '\nI am an experienced officer.\n');
  assert.equal(r.skipped, false);
});

test('polishChunk keeps the original when the line count changes', async () => {
  const r = await polishChunk('Line one\nLine two', { apiKey: 'k', fetchImpl: groq(() => ok('Line one and two')) });
  assert.equal(r.text, 'Line one\nLine two');
  assert.equal(r.skipped, true);
});

test('polishChunk strips a code fence', async () => {
  const r = await polishChunk('Helo there', { apiKey: 'k', fetchImpl: groq(() => ok('```\nHello there\n```')) });
  assert.equal(r.text, 'Hello there');
});

test('polishChunk falls back to the next model when one is unavailable', async () => {
  const seen = [];
  const r = await polishChunk('Helo', { apiKey: 'k', fetchImpl: groq(b => { seen.push(b.model); return b.model === MODELS[0] ? status(404) : ok('Hello'); }) });
  assert.deepEqual(seen, MODELS.slice(0, 2));
  assert.equal(r.text, 'Hello');
});

test('polishChunk waits briefly on a short 429, then reports busy on a long one', async () => {
  let calls = 0, slept = 0;
  const r = await polishChunk('Helo', { apiKey: 'k', sleep: async ms => { slept += ms; }, fetchImpl: groq(() => (++calls === 1 ? status(429, { 'retry-after': '2' }) : ok('Hello'))) });
  assert.equal(r.text, 'Hello');
  assert.equal(slept, 2000);
  await assert.rejects(polishChunk('Helo', { apiKey: 'k', fetchImpl: groq(() => status(429, { 'retry-after': '60' })) }), e => e instanceof PolishError && e.code === 'busy');
});

test('polishChunk reports busy on server errors and network failures', async () => {
  await assert.rejects(polishChunk('Helo', { apiKey: 'k', fetchImpl: groq(() => status(500)) }), e => e.code === 'busy');
  await assert.rejects(polishChunk('Helo', { apiKey: 'k', fetchImpl: async () => { throw new Error('down'); } }), e => e.code === 'busy');
});

test('polishText rejects empty and oversized input', async () => {
  await assert.rejects(polishText('   ', { apiKey: 'k' }), e => e.code === 'empty');
  await assert.rejects(polishText('x'.repeat(60001), { apiKey: 'k' }), e => e.code === 'too_long');
});

// ---- HTTP handler ----
function mockRes() {
  const r = { code: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
function deps(over = {}) {
  const counts = {};
  return {
    apiKey: 'k',
    isAllowedOrigin: o => o === 'https://gaiasymbiosis.com',
    verifyIdToken: async t => (t === 'good' ? 'u1' : null),
    allow: async (id, max) => { counts[id] = (counts[id] || 0) + 1; return counts[id] <= max; },
    fetchImpl: groq(b => ok(b.messages[1].content.replace('a experienced', 'an experienced'))),
    ...over,
  };
}
const req = (over = {}) => ({ method: 'POST', headers: { origin: 'https://gaiasymbiosis.com', authorization: 'Bearer good' }, body: { text: 'I am a experienced officer.' }, ...over });

test('handler polishes for a signed-in user', async () => {
  const res = mockRes();
  await makeHandler(deps())(req(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, text: 'I am an experienced officer.', skipped: 0 });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('handler rejects missing or invalid sign-in', async () => {
  for (const authorization of [undefined, 'Bearer bad', 'Basic good']) {
    const res = mockRes();
    await makeHandler(deps())(req({ headers: { origin: 'https://gaiasymbiosis.com', authorization } }), res);
    assert.equal(res.code, 401);
    assert.equal(res.body.error, 'auth');
  }
});

test('handler rejects other websites and non-POST requests', async () => {
  let res = mockRes();
  await makeHandler(deps())(req({ headers: { origin: 'https://evil.example', authorization: 'Bearer good' } }), res);
  assert.equal(res.code, 403);
  res = mockRes();
  await makeHandler(deps())(req({ method: 'GET' }), res);
  assert.equal(res.code, 405);
});

test('handler enforces the per-user hourly limit', async () => {
  const h = makeHandler(deps());
  let res;
  for (let i = 0; i < 9; i++) { res = mockRes(); await h(req(), res); }
  assert.equal(res.code, 429);
  assert.equal(res.body.error, 'limit');
});

test('handler maps Groq overload to 503 busy with Retry-After', async () => {
  const res = mockRes();
  await makeHandler(deps({ fetchImpl: groq(() => status(429, { 'retry-after': '60' })) }))(req(), res);
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'busy');
  assert.equal(res.headers['Retry-After'], '60');
});

test('handler reports a missing key and bad bodies', async () => {
  let res = mockRes();
  await makeHandler(deps({ apiKey: '' }))(req(), res);
  assert.equal(res.body.error, 'not_configured');
  res = mockRes();
  await makeHandler(deps())(req({ body: 'not json' }), res);
  assert.equal(res.code, 400);
  res = mockRes();
  await makeHandler(deps())(req({ body: { text: 'x'.repeat(60001) } }), res);
  assert.equal(res.code, 413);
});
