/* Gaia Symbiosis, Job Search Assistant
   Sign-in, cloud saving and the API calls come from js/gethired-sync.js
   (window.gethiredCall, window.gethiredImportCV, window.gethiredFlush). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const STATE_KEY = 'gaia_jobsearch';
  const RESULTS_KEY = 'gaia_jobsearch_results';
  const store = {
    get: (k, area = localStorage) => { try { return JSON.parse(area.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v, area = localStorage) => { try { area.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  };

  // ─── Toast ───
  let toastTimer;
  function toast(msg, type = 'info') {
    const el = $('js-toast');
    el.textContent = msg;
    el.className = `js-toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'js-toast'; }, 4200);
  }
  window.toast = window.toast || toast;

  const ERRORS = {
    signin: 'Please sign in with Google first (top right).',
    loading: 'Sign-in is still loading. Please try again in a moment.',
    auth: 'Your sign-in has expired. Sign out, sign back in, then try again.',
    busy: 'The service is busy right now. Please try again in a minute.',
    limit: "You've searched a lot this hour. Please try again later.",
    network: 'Could not reach the server. Check your connection and try again.',
    not_configured: "Job search isn't switched on yet. Please try again later.",
    too_long: 'That is too long. Please shorten it and try again.',
    unreadable: "Couldn't read enough from that. Add a little more detail and try again.",
    bad_request: 'Add at least one job title, keyword or category first.',
    adzuna_auth: "The job ads service didn't accept our access key, so no ads could be searched.",
    adzuna_limit: 'The job ads service has reached its limit for now. Please try again later.',
    adzuna_down: "The job ads service didn't respond. Please try again in a minute.",
    server: 'The server had a problem with that request. Please try again.',
  };

  // The introduction page only has the sponsor ticker
  if (!$('js-kw')) { ticker(); return; }

  // ─── Categories (same tags as the server) ───
  const CATEGORIES = {
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
  // Common Australian job titles, offered while typing (AI suggestions are added on top)
  const COMMON_TITLES = ['Accountant', 'Aged Care Worker', 'Agricultural Technician', 'Air Conditioning Technician', 'Automotive Electrician', 'Baker', 'Barista', 'Boilermaker', 'Bricklayer', 'Business Analyst', 'Butcher', 'Cabinetmaker', 'Carpenter', 'CCTV Technician', 'Chef', 'Child Care Worker', 'Civil Engineer', 'Cleaner', 'Community Support Worker', 'Construction Project Manager', 'Cook', 'Customer Service Officer', 'Cyber Security Analyst', 'Data Analyst', 'Data Engineer', 'Dental Assistant', 'Developer Programmer', 'Diesel Mechanic', 'Disability Support Worker', 'Early Childhood Teacher', 'Electrical Engineer', 'Electrician', 'Electronics Technician', 'Enrolled Nurse', 'Environmental Scientist', 'Farm Hand', 'Financial Analyst', 'Fitter', 'Graphic Designer', 'Hairdresser', 'Heavy Diesel Fitter', 'Horticulturist', 'Hospitality Manager', 'HR Officer', 'ICT Support Technician', 'Industrial Engineer', 'Joiner', 'Kitchen Hand', 'Laboratory Technician', 'Landscaper', 'Machine Operator', 'Marketing Coordinator', 'Mechanical Engineer', 'Medical Laboratory Scientist', 'Mining Engineer', 'Motor Mechanic', 'Network Engineer', 'Occupational Therapist', 'Office Administrator', 'Painter', 'Panel Beater', 'Pastry Cook', 'Personal Care Assistant', 'Pharmacist', 'Physiotherapist', 'Plumber', 'Project Coordinator', 'Project Manager', 'Quality Assurance Officer', 'Quantity Surveyor', 'Radiographer', 'Real Estate Agent', 'Receptionist', 'Registered Nurse', 'Restaurant Manager', 'Retail Assistant', 'Sales Representative', 'Secondary School Teacher', 'Security Officer', 'Security Systems Technician', 'Social Worker', 'Software Engineer', 'Solar Installer', 'Sous Chef', 'Structural Engineer', 'Supply Chain Analyst', 'Systems Administrator', 'Truck Driver', 'Veterinary Nurse', 'Warehouse Worker', 'Web Developer', 'Welder'];

  // Best matches first: exact, then starts with, then a word starting with it, then anywhere
  const rank = (label, q) => { const l = label.toLowerCase(); return l === q ? 0 : l.startsWith(q) ? 1 : new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l) ? 2 : l.includes(q) ? 3 : 9; };
  const bestFirst = (list, q, label) => q ? list.filter(x => rank(label(x), q) < 9).sort((a, b) => rank(label(a), q) - rank(label(b), q)) : list;

  // ─── Chips: type to search, Enter or click to add as a card ───
  function chipsField(root, o) {
    let items = [], active = 0;
    root.innerHTML = `<input type="text" id="${o.inputId}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${o.inputId}-list" placeholder="${esc(o.placeholder)}"><ul class="chips-list" id="${o.inputId}-list" role="listbox" hidden></ul>`;
    const input = root.querySelector('input'), list = root.querySelector('ul');
    const keyOf = it => o.key(it).toLowerCase();
    const has = k => items.some(it => keyOf(it) === k.toLowerCase());
    function draw() {
      root.querySelectorAll('.chip-card').forEach(c => c.remove());
      items.forEach((it, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip-card' + (o.isTitle && o.isTitle(it) ? ' is-title' : '');
        chip.innerHTML = `<span>${esc(o.label(it))}</span><button type="button" aria-label="Remove ${esc(o.label(it))}">&times;</button>`;
        chip.querySelector('button').addEventListener('click', e => { e.stopPropagation(); items.splice(i, 1); changed(); input.focus(); });
        root.insertBefore(chip, input);
      });
      input.placeholder = items.length >= (o.max || 99) ? '' : (items.length ? o.morePlaceholder || '' : o.placeholder);
      input.disabled = items.length >= (o.max || 99);
    }
    function changed() { draw(); o.onChange && o.onChange(items); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function suggest() {
      const q = input.value.trim();
      const hits = o.suggest(q).filter(s => !has(s.key)).slice(0, 8);
      if (q && o.create && !hits.some(h => h.key.toLowerCase() === q.toLowerCase()) && !has(q)) hits.push({ key: q, label: `Add “${q}”`, custom: true });
      active = 0;
      list.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}" aria-selected="${i === 0}">${esc(h.label)}</li>`).join('');
      list._hits = hits;
      list.hidden = !hits.length;
      input.setAttribute('aria-expanded', String(!list.hidden));
    }
    function pick(h) {
      const it = h.custom ? o.create(h.key) : o.fromSuggestion(h);
      if (it && !has(o.key(it)) && items.length < (o.max || 99)) items.push(it);
      input.value = ''; close(); changed();
    }
    input.addEventListener('input', suggest);
    input.addEventListener('focus', () => { if (o.suggestOnFocus) suggest(); });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', e => {
      const lis = [...list.querySelectorAll('li')];
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && lis.length) {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : lis.length - 1)) % lis.length;
        lis.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      } else if (e.key === 'Enter' || (e.key === ',' && o.create)) {
        e.preventDefault();
        if (!list.hidden && list._hits && list._hits[active]) pick(list._hits[active]);
        else if (input.value.trim() && o.create) pick({ key: input.value.trim(), custom: true });
      } else if (e.key === 'Escape') close();
      else if (e.key === 'Backspace' && !input.value && items.length) { items.pop(); changed(); }
    });
    list.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(list._hits[+li.dataset.i]); } });
    root.addEventListener('click', e => { if (e.target === root) input.focus(); });
    draw();
    return {
      get: () => items.slice(),
      set: next => { items = (next || []).slice(0, o.max || 99); changed(); },
      add: list2 => { list2.forEach(it => { if (!has(o.key(it)) && items.length < (o.max || 99)) items.push(it); }); changed(); },
    };
  }

  let aiSuggestions = [];
  const kw = chipsField($('js-kw'), {
    inputId: 'js-kw-input', placeholder: 'e.g. Electrician, solar, conduit…', morePlaceholder: 'Add more…', max: 14, create: t => ({ term: t.slice(0, 60), weight: 3 }),
    key: it => it.term, label: it => it.term, isTitle: it => it.title,
    suggest: q => {
      const ql = q.toLowerCase();
      const pool = [...aiSuggestions, ...COMMON_TITLES.map(t => ({ term: t, weight: 5, title: true }))];
      const seen = new Set();
      return bestFirst(pool.filter(p => !seen.has(p.term.toLowerCase()) && seen.add(p.term.toLowerCase())), ql, p => p.term)
        .map(p => ({ key: p.term, label: p.term, item: p })).slice(0, q ? 8 : 6);
    },
    fromSuggestion: h => h.item, suggestOnFocus: true, onChange: saveState,
  });
  const cats = chipsField($('js-cat'), {
    inputId: 'js-cat-input', placeholder: 'e.g. Engineering, Healthcare & Nursing…', morePlaceholder: 'Add another…', max: 3,
    key: it => it, label: it => CATEGORIES[it] || it,
    suggest: q => bestFirst(Object.entries(CATEGORIES), q.toLowerCase(), ([, l]) => l).map(([k, l]) => ({ key: k, label: l })),
    fromSuggestion: h => h.key, suggestOnFocus: true, onChange: saveState,
  });

  // ─── Saved search (this browser only) ───
  function saveState() {
    store.set(STATE_KEY, { what: $('js-what').value, keywords: kw.get(), categories: cats.get(), where: $('js-where').value, days: $('js-days').value, summary: $('js-summary').hidden ? '' : $('js-summary').textContent, ai: aiSuggestions });
  }
  function restoreState() {
    const s = store.get(STATE_KEY);
    if (!s) return;
    $('js-what').value = typeof s.what === 'string' ? s.what : '';
    aiSuggestions = Array.isArray(s.ai) ? s.ai.filter(x => x && typeof x.term === 'string') : [];
    kw.set(Array.isArray(s.keywords) ? s.keywords.filter(x => x && typeof x.term === 'string') : []);
    cats.set(Array.isArray(s.categories) ? s.categories.filter(c => c in CATEGORIES) : []);
    if (s.where in { '': 1, NSW: 1, VIC: 1, QLD: 1, WA: 1, SA: 1, TAS: 1, ACT: 1, NT: 1 }) $('js-where').value = s.where;
    if (['7', '14', '30'].includes(s.days)) $('js-days').value = s.days;
    showSummary(s.summary);
  }
  ['js-what', 'js-where', 'js-days'].forEach(id => $(id).addEventListener('input', saveState));
  function showSummary(text) { const el = $('js-summary'); el.textContent = text || ''; el.hidden = !text; }

  // ─── Helpers ───
  const busy = (btn, on) => { btn.classList.toggle('is-working', on); btn.setAttribute('aria-busy', String(on)); };
  async function call(fn) {
    if (typeof window.gethiredCall !== 'function') return { ok: false, error: 'loading' };
    if (!window.gethiredSignedIn()) return { ok: false, error: 'signin' };
    return fn();
  }
  function needSignIn(error) {
    if (error === 'signin') { scrollTo({ top: 0, behavior: 'smooth' }); $('gh-sign-in').focus({ preventScroll: true }); }
    toast(ERRORS[error] || ERRORS.busy, 'error');
  }
  function applyKeywords(res) {
    const titles = res.titles.map(t => ({ term: t, weight: 5, title: true }));
    const words = res.keywords.map(k => ({ term: k.term, weight: k.weight }));
    aiSuggestions = [...titles, ...words];
    kw.set([...titles.slice(0, 4), ...words.filter(w => w.weight >= 3).slice(0, 8)]);
    if (res.categories.length) cats.set(res.categories);
    showSummary(res.summary);
    saveState();
  }

  // ─── Step 1a: what I do -> keywords ───
  async function matchKeywords() {
    const text = $('js-what').value.trim();
    if (text.length < 3) { toast('Tell us a little about what you do first.', 'error'); $('js-what').focus(); return false; }
    const btn = $('js-match'); busy(btn, true);
    try {
      const res = await call(() => window.gethiredCall('/api/keywords', { text }));
      if (!res.ok) { needSignIn(res.error); if (!['signin', 'loading'].includes(res.error)) showSummary(`AI keyword match didn't finish (reason: ${res.error}${res.detail ? `, ${res.detail}` : ''}). You can still type keywords below and search.`); return false; }
      applyKeywords(res);
      toast('Keywords matched ✔ Change anything you like, then search.', 'success');
      return true;
    } finally { busy(btn, false); }
  }
  $('js-match').addEventListener('click', matchKeywords);

  // ─── Step 1b: import a CV -> profile (also saved to the CV Builder) -> keywords -> search ───
  const readAs = (file, how) => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error);
    how === 'text' ? r.readAsText(file) : r.readAsArrayBuffer(file);
  });
  async function docxText(buf) {
    const zip = await window.JSZip.loadAsync(buf);
    const f = zip.file('word/document.xml');
    if (!f) throw new Error('not a Word document');
    return (await f.async('string')).replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
  }
  const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  function composeAddress(p) {
    const sp = [p.state, p.postcode].map(x => (x || '').trim()).filter(Boolean).join(' ');
    return [p.street, p.street2, p.suburb, sp, p.country].map(x => (x || '').trim()).filter(Boolean).join(', ');
  }
  // Same shape the CV Builder saves (its "gethired_profile_v1")
  function toBuilderProfile(profile, existing) {
    const p = JSON.parse(JSON.stringify(profile));
    p.personal = p.personal || {};
    p.personal.address = composeAddress(p.personal) || p.personal.address || '';
    p.personal.otherLinks = (Array.isArray(p.otherLinks) ? p.otherLinks : []).filter(l => l && /^https?:\/\//i.test(String(l.url || '').trim())).map(l => ({ label: String(l.label || '').trim(), url: String(l.url).trim() }));
    delete p.otherLinks;
    if (!p.usageNotes && existing && existing.usageNotes) p.usageNotes = existing.usageNotes;
    return p;
  }
  const hasProfile = p => !!(p && ((p.personal && (p.personal.fullName || p.personal.email)) || (Array.isArray(p.workHistory) && p.workHistory.some(j => j && (j.title || j.employer)))));
  function profileText(p) {
    const lines = [];
    const add = (...xs) => xs.forEach(x => { if (x && String(x).trim()) lines.push(String(x).trim()); });
    add(p.summary && p.summary.headline, p.summary && String(p.summary.paragraphs || '').slice(0, 900));
    (p.workHistory || []).slice(0, 6).forEach(j => add([j.title, j.employer].filter(Boolean).join(' at '), String(j.bullets || '').split('\n').slice(0, 3).join('; ')));
    (p.skills || []).forEach(s => add([s.category, String(s.items || '').split('\n').join(', ')].filter(Boolean).join(': ')));
    (p.education || []).forEach(e => add([e.degree, e.majors && String(e.majors).split('\n').join(', ')].filter(Boolean).join(', ')));
    (p.certifications || []).forEach(c => add(String(c.items || '').split('\n').map(x => x.split(' | ')[0]).join(', ')));
    return lines.join('\n').slice(0, 11000);
  }
  async function importCV(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('That file is over 3 MB. Try a smaller PDF.', 'error'); return; }
    const name = file.name.toLowerCase();
    const kind = /\.pdf$/.test(name) || file.type === 'application/pdf' ? 'pdf' : /\.docx$/.test(name) ? 'docx' : /\.(txt|md|text)$/.test(name) || /^text\//.test(file.type) ? 'text' : null;
    if (!kind) { toast('Choose a PDF, Word (.docx) or text file.', 'error'); return; }
    if (typeof window.gethiredImportCV !== 'function') { needSignIn('loading'); return; }
    if (!window.gethiredSignedIn()) { needSignIn('signin'); return; }
    const btn = $('js-import-btn'); busy(btn, true);
    try {
      const payload = kind === 'pdf' ? { pdf: b64(await readAs(file, 'buffer')) } : { text: kind === 'docx' ? await docxText(await readAs(file, 'buffer')) : String(await readAs(file, 'text')) };
      toast('AI is reading your CV…');
      const res = await window.gethiredImportCV(payload);
      if (!res || !res.ok || !res.profile) { needSignIn(res && res.error); return; }
      // Fill the CV Builder profile in the background (asks first if one already exists)
      const existing = store.get('gethired_profile_v1');
      const next = toBuilderProfile(res.profile, existing);
      if (!hasProfile(existing) || confirm('Also put this CV into your CV Builder profile?\n\nOK: replace your current CV Builder profile with this CV.\nCancel: keep your current profile (the CV is still used for this search).')) {
        try { localStorage.setItem('gethired_profile_v1', JSON.stringify(next)); } catch { /* storage full */ }
      }
      const kwRes = await window.gethiredCall('/api/keywords', { text: profileText(next) });
      if (!kwRes.ok) { needSignIn(kwRes.error); return; }
      applyKeywords(kwRes);
      if (!$('js-what').value.trim() && kwRes.summary) { $('js-what').value = kwRes.summary.replace(/^You are /, 'I am '); saveState(); }
      toast('CV read ✔ Finding sponsor jobs for you…', 'success');
      await search();
    } catch (err) {
      console.error(err);
      toast(kind === 'docx' ? "Couldn't open that Word file. Try saving it as PDF." : ERRORS.unreadable, 'error');
    } finally { busy(btn, false); }
  }
  $('js-import').addEventListener('change', e => importCV(e.target));
  $('js-import-btn').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('js-import').click(); } });
  if (location.hash === '#import') {
    const box = document.querySelector('.js-import');
    box.classList.add('is-highlight');
    setTimeout(() => { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('js-import-btn').focus({ preventScroll: true }); }, 200);
  }
  new MutationObserver(() => {
    $('js-account-note').textContent = $('gh-user').hidden
      ? 'Sign in with Google (top right) to search. Your CV and searches stay private to your account.'
      : 'Signed in. Your CV and searches stay private to your account.';
  }).observe($('gh-user'), { attributes: true, attributeFilter: ['hidden'] });

  // ─── Step 2: search ───
  const GROUPS = [
    ['sponsorStrong', 'Sponsor companies: strong match', 'On the sponsor list and a strong fit for you. Apply to these first.'],
    ['sponsorHint', 'Ads that mention visa sponsorship', 'Not on the list, but the ad itself mentions sponsorship or a sponsored visa.'],
    ['sponsorOther', 'Sponsor companies: worth a look', 'On the sponsor list, with a looser match to your keywords.'],
    ['strongOther', 'Strong match: not on the sponsor list', "A great fit, but the employer isn't on the list. Some still sponsor, so it's worth asking."],
    ['closed', 'Probably not open to visa holders', 'These ads ask for citizens, permanent residents, full work rights or a security clearance.'],
  ];
  let lastJobs = new Map();
  const fmtDate = d => { const t = Date.parse(d); return t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; };
  function jobCard(j) {
    lastJobs.set(j.id, j);
    const badges = [
      j.sponsor ? `<span class="badge badge-sponsor" title="${esc(j.sponsor)}">&#x2713; On sponsor list</span>` : '',
      j.sponsorHint ? '<span class="badge badge-hint">Mentions visa sponsorship</span>' : '',
      j.blocked ? '<span class="badge badge-closed">Citizens / PR only</span>' : '',
    ].join('');
    const meta = [j.location, fmtDate(j.created) && `Posted ${fmtDate(j.created)}`, j.salary, j.category].filter(Boolean).map(esc).join('<span aria-hidden="true">·</span>');
    return `<article class="job">
      <div class="job-top"><span class="job-score" title="How well this ad matches your keywords">${Math.min(99, j.score)}<small>fit</small></span>
        <div><h4>${esc(j.title)}</h4><p class="job-employer">${esc(j.employer || 'Employer not named')}</p></div></div>
      ${badges ? `<div class="job-badges">${badges}</div>` : ''}
      <p class="job-meta">${meta}</p>
      ${j.description ? `<p class="job-desc">${esc(j.description)}</p>` : ''}
      ${j.hits && j.hits.length ? `<div class="tags">${j.hits.map(h => `<span>${esc(h)}</span>`).join('')}</div>` : ''}
      <div class="job-actions">
        ${j.url ? `<a class="btn btn-outline" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">View ad &#x2197;</a>` : ''}
        <button type="button" class="btn btn-primary" data-build="${esc(j.id)}">Build my CV for this job &#x2192;</button>
      </div>
    </article>`;
  }
  function render(data) {
    lastJobs = new Map();
    const all = GROUPS.reduce((n, [k]) => n + (data.groups[k] || []).length, 0);
    const when = new Date(data.at || Date.now()).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    $('js-results-meta').textContent = `${all} matching roles from ${data.total} ads · checked against ${Number(data.sponsors || 0).toLocaleString('en-AU')} sponsors · ${when}`;
    const html = GROUPS.map(([key, title, sub]) => {
      const list = data.groups[key] || [];
      if (!list.length) return '';
      const cards = `<div class="js-jobs">${list.map(jobCard).join('')}</div>`;
      return `<section class="js-group"><div class="js-group-head"><h3>${esc(title)}</h3><span class="js-count">${list.length}</span></div><p class="js-group-sub">${esc(sub)}</p>
        ${key === 'closed' ? `<details><summary>Show ${list.length} ${list.length === 1 ? 'ad' : 'ads'}</summary><div style="margin-top:1rem">${cards}</div></details>` : cards}</section>`;
    }).join('');
    $('js-groups').innerHTML = html || '<div class="js-empty"><strong>No matches this time.</strong><br>Try fewer or broader keywords, another category, all of Australia, or 30 days.</div>';
    const top = GROUPS.map(([k]) => (data.groups[k] || [])[0]).find(Boolean);
    if (top) document.querySelectorAll('[data-role]').forEach(el => { el.textContent = top.title; });
    $('results').hidden = false;
  }
  function skeleton() {
    $('results').hidden = false;
    $('js-results-meta').textContent = 'Searching live ads and checking employers…';
    $('js-groups').innerHTML = `<div class="js-jobs">${'<div class="js-skeleton"></div>'.repeat(4)}</div>`;
  }
  async function search() {
    if (!kw.get().length && !cats.get().length) {
      if ($('js-what').value.trim().length >= 3) { if (!(await matchKeywords())) return; }
      else { toast(ERRORS.bad_request, 'error'); $('js-kw-input').focus(); return; }
    }
    const btn = $('js-search'); busy(btn, true);
    const prev = $('js-groups').innerHTML, prevMeta = $('js-results-meta').textContent, wasHidden = $('results').hidden;
    skeleton();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const res = await call(() => window.gethiredCall('/api/jobs', { keywords: kw.get().map(k => ({ term: k.term, weight: k.weight })), categories: cats.get(), where: $('js-where').value, maxDays: Number($('js-days').value) }));
      if (!res.ok) {
        if (['signin', 'loading', 'bad_request'].includes(res.error)) {
          $('js-groups').innerHTML = prev; $('js-results-meta').textContent = prevMeta; $('results').hidden = wasHidden;
          needSignIn(res.error);
          return;
        }
        $('js-results-meta').textContent = 'The search did not finish.';
        $('js-groups').innerHTML = `<div class="js-empty js-error" role="alert"><strong>${esc(ERRORS[res.error] || ERRORS.busy)}</strong>
          <br><button type="button" class="btn btn-outline btn-sm" data-retry style="margin-top:1rem">Try again</button>
          <small>Reason: ${esc(res.error || 'unknown')}${res.detail ? ` · ${esc(res.detail)}` : ''}</small></div>`;
        return;
      }
      const data = { groups: res.groups, total: res.total, sponsors: res.sponsors, at: Date.now() };
      store.set(RESULTS_KEY, data, sessionStorage);
      render(data);
    } finally { busy(btn, false); }
  }
  $('js-search').addEventListener('click', search);
  $('js-groups').addEventListener('click', e => { if (e.target.closest('[data-retry]')) search(); });

  // ─── Step 3: send a job to the CV Prompt Builder ───
  function jobAd(j) {
    return [
      `Job title: ${j.title}`,
      j.employer && `Employer: ${j.employer}${j.sponsor ? ` (on the Standard Business Sponsor list as ${j.sponsor})` : ''}`,
      j.location && `Location: ${j.location}`,
      j.salary && `Salary: ${j.salary}`,
      j.created && `Advertised: ${j.created}`,
      j.url && `Full ad: ${j.url}`,
      '',
      j.description,
    ].filter(x => x !== false && x !== undefined && x !== null).join('\n').trim();
  }
  $('js-groups').addEventListener('click', async e => {
    const btn = e.target.closest('[data-build]');
    if (!btn) return;
    const j = lastJobs.get(btn.dataset.build);
    if (!j) return;
    const text = jobAd(j);
    let current = '';
    try { current = localStorage.getItem('gethired_jd') || ''; } catch { /* blocked */ }
    if (current.trim() && current.trim() !== text && !confirm(`Replace the job ad in the CV Prompt Builder with “${j.title}”?`)) return;
    try { localStorage.setItem('gethired_jd', text); } catch { toast("Couldn't save the job. Please try again.", 'error'); return; }
    busy(btn, true);
    toast('Opening the CV Prompt Builder… Paste the full ad from the link for the best result.', 'success');
    if (typeof window.gethiredFlush === 'function') await window.gethiredFlush();
    location.href = 'cv-builder.html#prompt';
  });

  // ─── Sponsor ticker: a slow wheel of company names, fading and blurring at the edges ───
  async function ticker() {
    const win = $('ticker-window'), track = $('ticker-track');
    if (!win) return;
    let data;
    try { data = await (await fetch('../data/sponsor-preview.json', { cache: 'force-cache' })).json(); } catch { return; }
    // 10 companies picked at random from the list on every visit
    const pool = (data.names || []).filter(n => typeof n === 'string');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const names = pool.slice(0, 10);
    if (data.count) document.querySelectorAll('[data-sponsor-count]').forEach(el => { el.textContent = Number(data.count).toLocaleString('en-AU'); });
    if (!names.length) return;
    const row = n => `<div class="ticker-row"><span class="ticker-name">${esc(n)}</span><span class="ticker-open">Opportunity</span></div>`;
    track.innerHTML = names.concat(names).map(row).join('');
    const rows = [...track.children];
    const ROW = 56, total = names.length * ROW;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let offset = 0, last = 0, speed = 22, target = 22, visible = true;
    function paint() {
      const H = win.clientHeight, mid = H / 2;
      track.style.transform = `translate3d(0, ${-offset}px, 0)`;
      rows.forEach((el, i) => {
        const c = i * ROW - offset + ROW / 2;
        if (c < -ROW || c > H + ROW) return;
        const d = Math.max(-1, Math.min(1, (c - mid) / mid)), a = Math.abs(d);
        el.style.opacity = (1 - a * 0.85).toFixed(3);
        el.style.filter = a > 0.12 ? `blur(${(a * a * 5).toFixed(2)}px)` : 'none';
        el.style.transform = `rotateX(${(-d * 32).toFixed(2)}deg) scale(${(1 - a * 0.1).toFixed(3)})`;
      });
    }
    function frame(t) {
      const dt = last ? Math.min(64, t - last) / 1000 : 0;
      last = t;
      speed += (target - speed) * 0.06;
      offset = (offset + speed * dt) % total;
      paint();
      if (visible && !document.hidden) requestAnimationFrame(frame); else last = 0;
    }
    paint();
    if (reduce) return;
    win.addEventListener('mouseenter', () => { target = 6; });
    win.addEventListener('mouseleave', () => { target = 22; });
    new IntersectionObserver(([en]) => { const was = visible; visible = en.isIntersecting; if (visible && !was) requestAnimationFrame(frame); }).observe(win);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) requestAnimationFrame(frame); });
    requestAnimationFrame(frame);
  }

  restoreState();
  const saved = store.get(RESULTS_KEY, sessionStorage);
  if (saved && saved.groups) render(saved);
  ticker();
})();
