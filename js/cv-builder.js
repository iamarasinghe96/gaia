import { firebaseConfig } from './firebase-config.js';

const FIREBASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const PH_JD = '[PASTE JOB DESCRIPTION HERE]';
const PH_CV = '[PASTE YOUR FULL MASTER CV CONTENT BANK HERE]';
const LOCAL_APPS = 'cvb_applications';
const FIELDS = {
  cv: { el: 'cv-bank', count: 'cv-count', local: 'cv_content_bank', cloud: 'cvBank', label: 'CV Bank' },
  cl: { el: 'cl-prompt', count: 'cl-count', local: 'cl_prompt', cloud: 'clPrompt', label: 'CL Prompt' },
  cvp: { el: 'cv-prompt', count: 'cv-count2', local: 'cv_prompt', cloud: 'cvPrompt', label: 'CV Prompt' },
};
const EMPTY_BANK = { cv: '', cl: '', cvp: '' };
const $ = id => document.getElementById(id);

/* ── Browser storage (used when signed out or Firebase is not configured) ── */
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const readLocalApps = () => { try { return JSON.parse(ls.get(LOCAL_APPS) || '[]'); } catch { return []; } };
const writeLocalApps = list => ls.set(LOCAL_APPS, JSON.stringify(list));

const localStore = {
  kind: 'local',
  async loadBank() {
    const bank = {};
    for (const [k, f] of Object.entries(FIELDS)) bank[k] = ls.get(f.local) || '';
    return bank;
  },
  async saveBank(part) {
    for (const [k, v] of Object.entries(part)) v ? ls.set(FIELDS[k].local, v) : ls.remove(FIELDS[k].local);
  },
  async listApps() { return readLocalApps(); },
  async saveApp(app) {
    const list = readLocalApps().filter(a => a.id !== app.id);
    list.unshift({ id: app.id, title: app.title, jd: app.jd, updatedAt: app.updatedAt });
    writeLocalApps(list.slice(0, 200));
  },
  async deleteApp(id) { writeLocalApps(readLocalApps().filter(a => a.id !== id)); },
  clearAll() {
    Object.values(FIELDS).forEach(f => ls.remove(f.local));
    ls.remove(LOCAL_APPS);
  },
};

/* ── Firestore storage (signed in): users/{uid} and users/{uid}/applications/{id} ── */
function cloudStore(fs, db, uid) {
  const userRef = fs.doc(db, 'users', uid);
  const appsCol = fs.collection(db, 'users', uid, 'applications');
  const millis = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : Date.now());
  return {
    kind: 'cloud',
    async loadBank() {
      const snap = await fs.getDoc(userRef);
      if (!snap.exists()) return null;
      const d = snap.data();
      return { cv: d.cvBank || '', cl: d.clPrompt || '', cvp: d.cvPrompt || '' };
    },
    async saveBank(part) {
      const data = { updatedAt: fs.serverTimestamp() };
      for (const [k, v] of Object.entries(part)) data[FIELDS[k].cloud] = v;
      await fs.setDoc(userRef, data, { merge: true });
    },
    async listApps() {
      const snap = await fs.getDocs(fs.query(appsCol, fs.orderBy('updatedAt', 'desc'), fs.limit(200)));
      return snap.docs.map(d => ({ id: d.id, title: d.data().title || '', jd: d.data().jd || '', updatedAt: millis(d.data().updatedAt) }));
    },
    async saveApp(app) {
      const data = { title: app.title, jd: app.jd, updatedAt: fs.serverTimestamp() };
      if (app.isNew) data.createdAt = fs.serverTimestamp();
      await fs.setDoc(fs.doc(appsCol, app.id), data, { merge: true });
    },
    async deleteApp(id) { await fs.deleteDoc(fs.doc(appsCol, id)); },
  };
}

/* ── State ── */
let store = localStore;
let storeToken = 0;
let savedBank = { ...EMPTY_BANK };
let apps = [];
let current = null;
const timers = {};
const pending = {};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const firstLine = t => (t.split('\n').map(l => l.trim()).find(Boolean) || '').slice(0, 120);

function schedule(key, fn, ms = 800) {
  clearTimeout(timers[key]);
  pending[key] = fn;
  timers[key] = setTimeout(() => { delete pending[key]; fn(); }, ms);
}
async function flushPending() {
  const fns = Object.entries(pending);
  fns.forEach(([k]) => { clearTimeout(timers[k]); delete pending[k]; });
  await Promise.all(fns.map(([, fn]) => fn()));
}

/* ── Sync indicator ── */
function setSync(state) {
  const el = $('sync');
  el.dataset.state = state;
  const where = store.kind === 'cloud' ? 'to your Google account' : 'in this browser';
  el.textContent = {
    loading: 'Loading saved data…',
    saving: 'Saving…',
    saved: `All changes saved ${where}`,
    error: "Couldn't save. Check your connection, your changes will retry when you keep typing.",
  }[state];
}

/* ── Saving the content bank and templates ── */
async function persistBank(part) {
  const s = store, t = storeToken;
  setSync('saving');
  try {
    await s.saveBank(part);
    if (t !== storeToken) return;
    Object.assign(savedBank, part);
    setSync('saved');
    updateStatus();
  } catch (err) {
    console.error('Save failed', err);
    if (t === storeToken) setSync('error');
    throw err;
  }
}
const bankValue = k => $(FIELDS[k].el).value;

function autosave(k) {
  setSync('saving');
  schedule(k, () => persistBank({ [k]: bankValue(k) }).catch(() => {}));
}
async function saveField(k) {
  clearTimeout(timers[k]); delete pending[k];
  try { await persistBank({ [k]: bankValue(k) }); toast('Saved', 'success'); } catch { toast("Couldn't save. Please try again.", 'error'); }
}
async function saveAll() {
  Object.keys(FIELDS).forEach(k => { clearTimeout(timers[k]); delete pending[k]; });
  try {
    await persistBank({ cv: bankValue('cv'), cl: bankValue('cl'), cvp: bankValue('cvp') });
    await saveCurrentApp();
    toast('All fields saved', 'success');
  } catch { toast("Couldn't save. Please try again.", 'error'); }
}

/* ── Applications ── */
async function saveCurrentApp() {
  const jd = $('jd-input').value;
  const title = $('app-title').value.trim();
  if (!current) {
    if (!jd.trim() && !title) { setSync('saved'); return; }
    current = { id: uuid(), isNew: true };
  }
  const app = { id: current.id, isNew: current.isNew, title: title || firstLine(jd) || 'Untitled application', jd, updatedAt: Date.now() };
  const s = store, t = storeToken;
  setSync('saving');
  try {
    await s.saveApp(app);
    if (t !== storeToken) return;
    if (current && current.id === app.id) current.isNew = false;
    apps = [{ id: app.id, title: app.title, jd: app.jd, updatedAt: app.updatedAt }, ...apps.filter(a => a.id !== app.id)];
    renderApps();
    setSync('saved');
  } catch (err) {
    console.error('Save failed', err);
    if (t === storeToken) setSync('error');
  }
}

function renderApps() {
  const list = $('app-list');
  list.replaceChildren();
  $('apps-desc').textContent = apps.length
    ? `${apps.length} saved · ${store.kind === 'cloud' ? 'in your account' : 'in this browser'}`
    : 'Each job description is saved as an application';
  if (!apps.length) {
    const p = document.createElement('p');
    p.className = 'cvb-apps-empty';
    p.textContent = 'No saved applications yet. Paste a job description below and it saves automatically.';
    list.append(p);
    return;
  }
  for (const a of apps) {
    const item = document.createElement('div');
    item.className = 'cvb-app';
    item.setAttribute('aria-current', String(!!current && current.id === a.id));
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'cvb-app-open';
    const strong = document.createElement('strong');
    strong.textContent = a.title || 'Untitled application';
    const when = document.createElement('span');
    when.textContent = new Date(a.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    open.append(strong, when);
    open.addEventListener('click', () => openApp(a.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cvb-app-del';
    del.setAttribute('aria-label', `Delete application: ${a.title || 'Untitled application'}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    del.addEventListener('click', () => deleteApp(a.id));
    item.append(open, del);
    list.append(item);
  }
}

async function openApp(id) {
  await flushPending();
  const a = apps.find(x => x.id === id);
  if (!a) return;
  current = { id: a.id, isNew: false };
  $('jd-input').value = a.jd;
  $('app-title').value = a.title === firstLine(a.jd) ? '' : a.title;
  updateCount('jd-input', 'jd-count');
  clearOutputs();
  renderApps();
  updateStatus();
  $('jd-input').focus();
}

async function newApp() {
  await flushPending();
  current = null;
  $('jd-input').value = '';
  $('app-title').value = '';
  updateCount('jd-input', 'jd-count');
  clearOutputs();
  renderApps();
  updateStatus();
  $('jd-input').focus();
}

async function deleteApp(id) {
  const a = apps.find(x => x.id === id);
  if (!a || !confirm(`Delete "${a.title || 'Untitled application'}"? This cannot be undone.`)) return;
  try {
    await store.deleteApp(id);
    apps = apps.filter(x => x.id !== id);
    if (current && current.id === id) {
      clearTimeout(timers.jd); delete pending.jd;
      current = null;
      $('jd-input').value = '';
      $('app-title').value = '';
      updateCount('jd-input', 'jd-count');
      clearOutputs();
    }
    renderApps();
    updateStatus();
    toast('Application deleted', 'info');
  } catch (err) {
    console.error(err);
    toast("Couldn't delete. Please try again.", 'error');
  }
}

/* ── Clear ── */
async function clearField(k) {
  if (!confirm('Clear this field and remove it from saved storage?')) return;
  clearTimeout(timers[k]); delete pending[k];
  $(FIELDS[k].el).value = '';
  updateCount(FIELDS[k].el, FIELDS[k].count);
  try { await persistBank({ [k]: '' }); toast('Cleared', 'info'); } catch { toast("Couldn't clear. Please try again.", 'error'); }
}

function clearJD() {
  $('jd-input').value = '';
  updateCount('jd-input', 'jd-count');
  updateStatus();
  if (current) schedule('jd', saveCurrentApp);
}

async function clearAll() {
  if (!confirm('Clear your content bank, both prompt templates and the job description? Saved applications are kept. This cannot be undone.')) return;
  Object.keys(FIELDS).forEach(k => { clearTimeout(timers[k]); delete pending[k]; $(FIELDS[k].el).value = ''; });
  updateCounts();
  clearOutputs();
  try { await persistBank({ ...EMPTY_BANK }); } catch { toast("Couldn't clear saved data. Please try again.", 'error'); return; }
  await newApp();
  toast('All cleared', 'info');
}

/* ── Copy ── */
function copyText(text, okMsg) {
  if (!navigator.clipboard) { toast('Copying is not supported in this browser', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => toast(okMsg, 'success'), () => toast('Copy failed', 'error'));
}
function copyField(id) {
  const val = $(id).value;
  if (!val.trim()) { toast('Nothing to copy', 'error'); return; }
  copyText(val, 'Copied');
}
function copyOutput(id) {
  const el = $(id);
  if (el.dataset.built !== '1') { toast('Build prompts first', 'error'); return; }
  copyText(el.textContent, 'Prompt copied');
}

/* ── Counts & status ── */
function updateCount(fieldId, countId) {
  const v = $(fieldId).value;
  const words = v.trim().split(/\s+/).filter(Boolean).length;
  $(countId).textContent = v.length > 0 ? `${v.length.toLocaleString()} chars · ${words.toLocaleString()} words` : '0 chars';
}
function updateCounts() {
  Object.values(FIELDS).forEach(f => updateCount(f.el, f.count));
  updateCount('jd-input', 'jd-count');
}

function updateStatus() {
  const dot = $('status-dot'), text = $('status-text'), detail = $('status-detail');
  const has = k => !!(savedBank[k] || '').trim();
  const hasJD = !!$('jd-input').value.trim();
  const saved = Object.entries(FIELDS).filter(([k]) => has(k)).map(([, f]) => f.label);
  const missing = Object.entries(FIELDS).filter(([k]) => !has(k)).map(([, f]) => f.label);

  if (saved.length === 3 && hasJD) {
    dot.className = 'cvb-dot ready';
    text.textContent = 'Ready to build: all fields populated';
    detail.textContent = `${saved.join(', ')} saved · JD pasted`;
  } else if (saved.length === 3) {
    dot.className = 'cvb-dot warn';
    text.textContent = 'Almost ready: paste a job description to build';
    detail.textContent = `${saved.join(', ')} saved · JD missing`;
  } else if (saved.length > 0) {
    dot.className = 'cvb-dot warn';
    text.textContent = `Incomplete: missing ${missing.join(', ')}`;
    detail.textContent = `${saved.join(', ')} saved`;
  } else {
    dot.className = 'cvb-dot';
    text.textContent = 'No saved data: fill in your content bank and prompt templates';
    detail.textContent = 'All fields empty';
  }
}

/* ── Build ── */
function inject(tmpl, jd, cvBank, label, warnings) {
  if (!tmpl) return '';
  const missing = [];
  if (!tmpl.includes(PH_JD)) missing.push(`"${PH_JD}"`);
  if (!tmpl.includes(PH_CV)) missing.push(`"${PH_CV}"`);
  if (missing.length) warnings.push(`${label} prompt missing placeholder: ${missing.join(' and ')}`);
  return tmpl.replaceAll(PH_JD, () => jd).replaceAll(PH_CV, () => cvBank);
}

function buildPrompts() {
  const cvBank = $('cv-bank').value.trim();
  const jd = $('jd-input').value.trim();
  const clTmpl = $('cl-prompt').value;
  const cvTmpl = $('cv-prompt').value;

  const errors = [];
  if (!cvBank) errors.push('CV Content Bank (field 1)');
  if (!jd) errors.push('Job Description (field 4)');
  if (!clTmpl && !cvTmpl) errors.push('at least one prompt template (fields 2 or 3)');
  if (errors.length) { toast(`Missing: ${errors.join(', ')}`, 'error'); return; }

  const warnings = [];
  const clBuilt = inject(clTmpl, jd, cvBank, 'CL', warnings);
  const cvBuilt = inject(cvTmpl, jd, cvBank, 'CV', warnings);
  renderOutput('out-cl-content', clBuilt, cvBank, jd);
  renderOutput('out-cv-content', cvBuilt, cvBank, jd);
  if (warnings.length) toast(`Prompts built. ${warnings.join('. ')}`, 'error');
  else toast('Prompts built, ready to copy', 'success');
  updateStatus();
  $('output').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const escapeHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderOutput(id, text, cvBank, jd) {
  const el = $(id);
  if (!text.trim()) { setEmpty(el, 'No template provided for this prompt.'); return; }
  let safe = escapeHtml(text);
  const jdPreview = escapeHtml(jd.substring(0, 80));
  const cvPreview = escapeHtml(cvBank.substring(0, 80));
  if (jdPreview) safe = safe.replace(jdPreview, () => `<span class="highlight-jd">${jdPreview}</span>`);
  if (cvPreview) safe = safe.replace(cvPreview, () => `<span class="highlight-cv">${cvPreview}</span>`);
  el.innerHTML = safe;
  el.dataset.built = '1';
}

const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>';
function setEmpty(el, html) {
  el.innerHTML = `<div class="cvb-empty">${DOC_ICON}${html}</div>`;
  el.dataset.built = '0';
}
function clearOutputs() {
  setEmpty($('out-cl-content'), 'Hit <strong>Build Prompts</strong> to generate your cover letter prompt with all placeholders replaced.');
  setEmpty($('out-cv-content'), 'Hit <strong>Build Prompts</strong> to generate your CV / LaTeX prompt with all placeholders replaced.');
}

function switchTab(tab) {
  document.querySelectorAll('.cvb-tab').forEach(t => {
    const on = t.dataset.tab === tab;
    t.setAttribute('aria-selected', String(on));
    $(t.getAttribute('aria-controls')).classList.toggle('visible', on);
  });
}

/* ── Toast ── */
let toastTimer;
function toast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `cvb-toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'cvb-toast'; }, 3200);
}

/* ── Switching between browser and account storage ── */
function setEditable(on) {
  $('cvb').classList.toggle('is-loading', !on);
  [...Object.values(FIELDS).map(f => f.el), 'jd-input', 'app-title'].forEach(id => { $(id).readOnly = !on; });
}

async function switchStore(next, { migrate = false } = {}) {
  await flushPending().catch(() => {});
  storeToken++;
  store = next;
  current = null;
  setEditable(false);
  setSync('loading');
  try {
    let bank = await next.loadBank();
    let list = await next.listApps();
    if (migrate) {
      const localBank = await localStore.loadBank();
      const localApps = readLocalApps();
      const hasLocal = Object.values(localBank).some(Boolean) || localApps.length;
      if (hasLocal && !bank && !list.length && confirm('Add the content saved in this browser to your account?')) {
        await next.saveBank(localBank);
        for (const a of localApps) await next.saveApp({ ...a, isNew: true });
        localStore.clearAll();
        bank = localBank;
        list = await next.listApps();
        toast('Your saved content was added to your account', 'success');
      }
    }
    savedBank = { ...EMPTY_BANK, ...(bank || {}) };
    apps = list;
  } catch (err) {
    console.error('Load failed', err);
    savedBank = { ...EMPTY_BANK };
    apps = [];
    toast("Couldn't load your saved data. Please refresh the page.", 'error');
  }
  for (const [k, f] of Object.entries(FIELDS)) $(f.el).value = savedBank[k];
  $('jd-input').value = '';
  $('app-title').value = '';
  updateCounts();
  clearOutputs();
  renderApps();
  updateStatus();
  setSync('saved');
  setEditable(true);
}

/* ── Account ── */
function showAccount(state, user) {
  $('account-out').hidden = state !== 'out';
  $('account-in').hidden = state !== 'in';
  const note = $('account-note');
  note.hidden = state === 'in';
  note.textContent = {
    out: 'Sign in to save your applications to your account and use them on any device.',
    disabled: 'Your work is saved in this browser.',
    error: 'Sign-in is unavailable right now. Your work is saved in this browser.',
  }[state] || '';
  if (state === 'in' && user) {
    const avatar = $('account-avatar');
    avatar.replaceChildren();
    if (user.photoURL && /^https:\/\/lh3\.googleusercontent\.com\//.test(user.photoURL)) {
      const img = document.createElement('img');
      img.src = user.photoURL;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      avatar.append(img);
    } else {
      const i = document.createElement('span');
      i.className = 'cvb-initial';
      i.textContent = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
      avatar.append(i);
    }
    $('account-name').textContent = user.displayName || 'Signed in';
    $('account-email').textContent = user.email || '';
  }
}

async function initAuth() {
  if (!firebaseConfig.apiKey) {
    showAccount('disabled');
    await switchStore(localStore);
    return;
  }
  try {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${FIREBASE}firebase-app.js`),
      import(`${FIREBASE}firebase-auth.js`),
      import(`${FIREBASE}firebase-firestore.js`),
    ]);
    const app = initializeApp(firebaseConfig);
    const a = auth.getAuth(app);
    const db = fs.getFirestore(app);
    const provider = new auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    $('sign-in').addEventListener('click', async () => {
      try {
        await auth.signInWithPopup(a, provider);
      } catch (err) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
          await flushPending().catch(() => {});
          return auth.signInWithRedirect(a, provider);
        }
        if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) {
          console.error(err);
          toast('Sign-in failed. Please try again.', 'error');
        }
      }
    });
    $('sign-out').addEventListener('click', async () => {
      await flushPending().catch(() => {});
      await auth.signOut(a);
      toast('Signed out', 'info');
    });

    let first = true;
    auth.onAuthStateChanged(a, async user => {
      if (user) {
        showAccount('in', user);
        await switchStore(cloudStore(fs, db, user.uid), { migrate: true });
      } else {
        showAccount('out');
        if (first || store.kind === 'cloud') await switchStore(localStore);
      }
      first = false;
    });
  } catch (err) {
    console.error('Firebase failed to load', err);
    showAccount('error');
    await switchStore(localStore);
  }
}

/* ── Wire up ── */
document.addEventListener('DOMContentLoaded', () => {
  for (const [k, f] of Object.entries(FIELDS)) {
    $(f.el).addEventListener('input', () => { autosave(k); updateCount(f.el, f.count); });
  }
  const onJd = () => { setSync('saving'); schedule('jd', saveCurrentApp); updateStatus(); };
  $('jd-input').addEventListener('input', () => { updateCount('jd-input', 'jd-count'); onJd(); });
  $('app-title').addEventListener('input', onJd);

  document.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => saveField(b.dataset.save)));
  document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => clearField(b.dataset.clear)));
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyField(b.dataset.copy)));
  document.querySelectorAll('[data-copy-out]').forEach(b => b.addEventListener('click', () => copyOutput(b.dataset.copyOut)));
  document.querySelectorAll('.cvb-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('clear-jd').addEventListener('click', clearJD);
  $('clear-all').addEventListener('click', clearAll);
  $('save-all').addEventListener('click', saveAll);
  $('build').addEventListener('click', buildPrompts);
  $('reset-output').addEventListener('click', clearOutputs);
  $('new-app').addEventListener('click', newApp);

  window.addEventListener('beforeunload', e => {
    if (Object.keys(pending).length) { flushPending(); e.preventDefault(); }
  });

  clearOutputs();
  initAuth();
});
