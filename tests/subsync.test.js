import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseGuesses, identifyFilm, readTranslate, translateLines, readSearch, searchSubtitles, downloadSubtitle, isDownloadLink, makeTokenStore, SubSyncError } from '../lib/subsync.js';
import { makeSubSyncHandler } from '../lib/subsync-handler.js';

const json = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const groq = content => json(200, { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });

test('film guesses: only well-formed values are kept', () => {
  const g = normaliseGuesses({ guesses: [{ title: ' Heat ', year: 1995, confidence: 'high', why: 'Names Neil McCauley' }, { title: '', year: 1 }, { title: 'X', year: 'soon', confidence: 'sure' }] });
  assert.deepEqual(g, [{ title: 'Heat', year: 1995, confidence: 'high', why: 'Names Neil McCauley' }, { title: 'X', year: null, confidence: 'low', why: '' }]);
  assert.deepEqual(normaliseGuesses(null), []);
});

test('identifyFilm sends the transcript to Groq and falls back to the next model when busy', async () => {
  const models = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    models.push(body.model);
    assert.match(body.messages[1].content, /I'm going to make him an offer/);
    return models.length === 1 ? json(429, {}) : groq({ guesses: [{ title: 'The Godfather', year: 1972, confidence: 'high', why: 'Famous line' }] });
  };
  const out = await identifyFilm("I'm going to make him an offer he can't refuse", { apiKey: 'k', fetchImpl });
  assert.equal(out[0].title, 'The Godfather');
  assert.equal(models.length, 2);
  await assert.rejects(identifyFilm('hi', { apiKey: 'k', fetchImpl }), e => e.code === 'unreadable');
});

test('translate requests are checked and a count mismatch fails the batch', async () => {
  assert.throws(() => readTranslate({ lines: [], src: 'en', tgt: 'si' }), SubSyncError);
  assert.throws(() => readTranslate({ lines: ['a'], src: 'en', tgt: 'en' }), SubSyncError);
  assert.throws(() => readTranslate({ lines: ['a'], src: 'en', tgt: 'fr' }), SubSyncError);
  assert.throws(() => readTranslate({ lines: Array(41).fill('a'), src: 'en', tgt: 'si' }), e => e.code === 'too_long');
  const job = readTranslate({ lines: ['Hello.', 'Run!\nNow!'], src: 'en', tgt: 'si' });
  assert.deepEqual(await translateLines(job, { apiKey: 'k', fetchImpl: async () => groq({ t: ['ආයුබෝවන්.', 'දුවන්න!\nදැන්!'] }) }), ['ආයුබෝවන්.', 'දුවන්න!\nදැන්!']);
  await assert.rejects(translateLines(job, { apiKey: 'k', fetchImpl: async () => groq({ t: ['one'] }) }), e => e.code === 'mismatch');
});

test('subtitle search: OpenSubtitles key and user agent, most downloaded first', async () => {
  assert.throws(() => readSearch({ title: '', language: 'en' }), SubSyncError);
  assert.deepEqual(readSearch({ title: '  Heat ', year: '1995', language: 'en' }), { title: 'Heat', year: 1995, language: 'en' });
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return json(200, { data: [
      { attributes: { release: 'Heat.1995.720p', download_count: 50, language: 'en', files: [{ file_id: 11, file_name: 'a.srt' }] } },
      { attributes: { release: 'Heat.1995.1080p', download_count: 900, language: 'en', files: [{ file_id: 12, file_name: 'b.srt' }] } },
      { attributes: { release: 'no file', files: [] } },
    ] });
  };
  const hits = await searchSubtitles({ title: 'Heat', year: 1995, language: 'en' }, { apiKey: 'os-key', fetchImpl });
  assert.deepEqual(hits.map(h => h.fileId), [12, 11]);
  assert.equal(seen.init.headers['Api-Key'], 'os-key');
  assert.match(seen.init.headers['User-Agent'], /SubSync/);
  assert.match(seen.url, /query=Heat/);
  await assert.rejects(searchSubtitles({ title: 'Heat', language: 'en' }, { apiKey: 'bad', fetchImpl: async () => json(401, { message: 'bad key' }) }), e => e.code === 'os_auth');
});

test('subtitle download: logs in once, retries an expired token, and only fetches OpenSubtitles links', async () => {
  assert.equal(isDownloadLink('https://www.opensubtitles.com/download/abc/file.srt'), true);
  assert.equal(isDownloadLink('http://www.opensubtitles.com/x'), false);
  assert.equal(isDownloadLink('https://evil.example/opensubtitles.com'), false);
  assert.equal(isDownloadLink('https://169.254.169.254/'), false);
  const calls = [];
  let downloads = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push(url.replace(/\?.*/, ''));
    if (url.endsWith('/login')) return json(200, { token: `t${calls.length}` });
    if (url.endsWith('/download')) {
      downloads++;
      if (downloads === 1) return json(401, {});
      assert.match(init.headers.Authorization, /^Bearer t/);
      return json(200, { link: 'https://www.opensubtitles.com/download/x/heat.srt', file_name: 'heat.srt', remaining: 9 });
    }
    return json(200, '1\n00:00:01,000 --> 00:00:02,000\nHello\n');
  };
  const tokens = makeTokenStore();
  const out = await downloadSubtitle(12, { apiKey: 'k', username: 'u', password: 'p', fetchImpl, tokens });
  assert.equal(out.name, 'heat.srt');
  assert.equal(out.remaining, 9);
  assert.match(out.text, /Hello/);
  assert.equal(calls.filter(c => c.endsWith('/login')).length, 2);
  await assert.rejects(downloadSubtitle(12, { apiKey: 'k', username: 'u', password: 'p', tokens, fetchImpl: async u => (u.endsWith('/download') ? json(200, { link: 'https://evil.example/x.srt' }) : json(200, { token: 't' })) }), e => e.code === 'busy');
  await assert.rejects(downloadSubtitle(12, { apiKey: 'k', username: 'u', password: 'p', tokens, fetchImpl: async u => (u.endsWith('/download') ? json(406, {}) : json(200, { token: 't' })) }), e => e.code === 'os_quota');
});

function mockRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const deps = extra => ({ isAllowedOrigin: () => false, verifyIdToken: async t => (t === 'good' ? 'u1' : null), allow: async () => true, groqKey: 'g', osKey: 'o', osUser: 'u', osPass: 'p', ...extra });
const req = (body, headers = {}) => ({ method: 'POST', headers: { origin: 'https://gaiasymbiosis.com', host: 'gaiasymbiosis.com', authorization: 'Bearer good', ...headers }, body });

test('subsync handler: origin, sign-in, actions, configuration, limits and no keys in replies', async () => {
  const fetchImpl = async () => groq({ guesses: [{ title: 'Heat', year: 1995, confidence: 'medium', why: 'Cop and thief' }] });
  const h = makeSubSyncHandler(deps({ fetchImpl }));
  let r = mockRes(); await h(req({ action: 'identify', transcript: 'x'.repeat(20) }, { origin: 'https://evil.example' }), r); assert.equal(r.code, 403);
  r = mockRes(); await h(req({ action: 'identify', transcript: 'x'.repeat(20) }, { authorization: 'Bearer bad' }), r); assert.equal(r.code, 401);
  r = mockRes(); await h(req({ action: 'nope' }), r); assert.equal(r.code, 400);
  r = mockRes(); await h(req({ action: 'identify', transcript: 'You and I are doing the same thing' }), r);
  assert.equal(r.code, 200); assert.equal(r.body.guesses[0].title, 'Heat');
  assert.doesNotMatch(JSON.stringify(r.body), /"g"|"o"|"p"/);
  r = mockRes(); await h(req({ action: 'translate', lines: ['a'], src: 'en', tgt: 'xx' }), r); assert.equal(r.code, 400);
  r = mockRes(); await makeSubSyncHandler(deps({ osKey: '' }))(req({ action: 'search', title: 'Heat', language: 'en' }), r);
  assert.equal(r.code, 500); assert.equal(r.body.error, 'not_configured'); assert.match(r.body.detail, /OPENSUBTITLES_API_KEY/);
  r = mockRes(); await makeSubSyncHandler(deps({ osPass: '' }))(req({ action: 'download', fileId: 5 }), r); assert.match(r.body.detail, /OPENSUBTITLES_PASSWORD/);
  r = mockRes(); await makeSubSyncHandler(deps({ allow: async () => false }))(req({ action: 'search', title: 'Heat', language: 'en' }), r); assert.equal(r.code, 429);
  r = mockRes(); await h(req({ action: 'download', fileId: -1 }), r); assert.equal(r.code, 400);
});

test('subsync handler: a file downloaded once is served again without another download', async () => {
  let downloads = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/login')) return json(200, { token: 't' });
    if (url.endsWith('/download')) { downloads++; return json(200, { link: 'https://www.opensubtitles.com/d/1', file_name: 'f.srt', remaining: 3 }); }
    return json(200, 'srt text');
  };
  const h = makeSubSyncHandler(deps({ fetchImpl }));
  let r = mockRes(); await h(req({ action: 'download', fileId: 7 }), r); assert.equal(r.body.text, 'srt text');
  r = mockRes(); await h(req({ action: 'download', fileId: 7 }), r); assert.equal(r.body.text, 'srt text');
  assert.equal(downloads, 1);
});
