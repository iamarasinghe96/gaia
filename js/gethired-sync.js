// Google sign-in and cloud autosave for the GetHired CV Prompt Builder.
// The app keeps working exactly as before on localStorage; this module mirrors
// its keys to Firestore (users/{uid}/data/{key}) while the visitor is signed in.
import { firebaseConfig, polishUrl } from './firebase-config.js?v=20261023b';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const KEYS = [
  'gethired_profile_v1', 'cv_content_bank', 'cl_prompt', 'cv_prompt', 'gethired_jd',
  'gethired_export_draft', 'gethired_export_style', 'gethired_signature',
  'gethired_polish_snapshot',
];
const RETIRED = ['gethired_sample_sections'];
const OWNER = 'gethired_owner';
const MAX_LEN = 900000;
const $ = id => document.getElementById(id);

const proto = Storage.prototype;
const rawSet = proto.setItem, rawRemove = proto.removeItem, rawGet = proto.getItem;
const ls = {
  get: k => { try { return rawGet.call(localStorage, k); } catch { return null; } },
  set: (k, v) => { try { rawSet.call(localStorage, k, v); } catch { /* full or blocked */ } },
  remove: k => { try { rawRemove.call(localStorage, k); } catch { /* blocked */ } },
};

let push = null;            // set while signed in: (key) => schedule a cloud write
const timers = {};
const pending = new Set();
let failed = false;

/* Watch the app's own saves */
proto.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (this === localStorage && push && KEYS.includes(k)) push(k);
};
proto.removeItem = function (k) {
  rawRemove.call(this, k);
  if (this === localStorage && push && KEYS.includes(k)) push(k);
};

/* Status line in the header */
function status(state) {
  const el = $('gh-sync');
  if (!el) return;
  el.dataset.state = state;
  el.textContent = {
    local: 'Saved in this browser',
    loading: 'Loading your data…',
    saving: 'Saving…',
    saved: 'Saved to your account',
    error: "Couldn't save, retrying when you edit",
    offline: 'Sign-in unavailable, saved in this browser',
  }[state] || '';
}

const hasLocalData = () => KEYS.some(k => ls.get(k) !== null);
const reloadApp = () => { if (typeof window.gethiredReloadFromStorage === 'function') window.gethiredReloadFromStorage(); };

function clearLocal() {
  KEYS.forEach(k => ls.remove(k));
  ls.remove(OWNER);
}

function showAccount(user) {
  $('gh-sign-in').hidden = !!user;
  $('gh-user').hidden = !user;
  if (!user) return;
  const av = $('gh-avatar');
  av.replaceChildren();
  if (user.photoURL && /^https:\/\/lh3\.googleusercontent\.com\//.test(user.photoURL)) {
    const img = document.createElement('img');
    img.src = user.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer';
    av.appendChild(img);
  } else {
    av.textContent = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
  }
  $('gh-name').textContent = user.displayName || user.email || 'Signed in';
  $('gh-user').title = user.email || '';
}

async function start() {
  if (!firebaseConfig.apiKey) { status('local'); return; }
  let app, auth, fs;
  try {
    [app, auth, fs] = await Promise.all([
      import(`${SDK}firebase-app.js`), import(`${SDK}firebase-auth.js`), import(`${SDK}firebase-firestore.js`),
    ]);
  } catch (err) {
    console.error('Firebase failed to load', err);
    status('offline');
    return;
  }
  const fbApp = app.initializeApp(firebaseConfig);
  const a = auth.getAuth(fbApp);
  const db = fs.getFirestore(fbApp);
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let uid = null;
  const docFor = (id, k) => fs.doc(db, 'users', id, 'data', k);

  async function write(id, k) {
    const v = ls.get(k);
    if (v !== null && v.length > MAX_LEN) {
      window.toast && window.toast('That item is too large to save to your account', 'error');
      return;
    }
    if (v === null) await fs.deleteDoc(docFor(id, k));
    else await fs.setDoc(docFor(id, k), { value: v, updatedAt: fs.serverTimestamp() });
  }

  function schedule(k) {
    if (!uid) return;
    const id = uid;
    pending.add(k);
    status('saving');
    clearTimeout(timers[k]);
    timers[k] = setTimeout(async () => {
      try {
        await write(id, k);
        pending.delete(k);
        if (id === uid && !pending.size) { failed = false; status('saved'); }
      } catch (err) {
        console.error('Cloud save failed', k, err);
        pending.delete(k);
        failed = true;
        if (id === uid) status('error');
      }
    }, 900);
  }

  async function flush() {
    const keys = [...pending];
    keys.forEach(k => clearTimeout(timers[k]));
    if (!uid || !keys.length) return;
    const id = uid;
    await Promise.allSettled(keys.map(k => write(id, k)));
    pending.clear();
  }

  async function signedIn(user) {
    showAccount(user);
    status('loading');
    push = null;
    let cloud = {};
    try {
      const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, 'data'));
      snap.forEach(d => {
        if (KEYS.includes(d.id) && typeof d.data().value === 'string') cloud[d.id] = d.data().value;
        else if (RETIRED.includes(d.id)) fs.deleteDoc(d.ref || docFor(user.uid, d.id)).catch(() => {});
      });
    } catch (err) {
      console.error('Could not load account data', err);
      window.toast && window.toast("Couldn't load your saved data. Please refresh the page.", 'error');
      status('error');
      return;
    }
    const owner = ls.get(OWNER);
    const cloudEmpty = !Object.keys(cloud).length;
    const local = {};
    KEYS.forEach(k => { const v = ls.get(k); if (v !== null) local[k] = v; });
    let upload = false;

    if (owner && owner !== user.uid) {
      // Left over from someone else's account on this browser: never mix it in.
      clearLocal();
    } else if (cloudEmpty) {
      upload = hasLocalData();
    } else if (!owner && hasLocalData()) {
      upload = !confirm('Your account already has saved work.\n\nOK: load your account (replaces what is in this browser).\nCancel: keep this browser\'s work and save it to your account.');
    }

    if (upload) {
      try {
        await Promise.all(Object.keys(local).map(k => fs.setDoc(docFor(user.uid, k), { value: local[k], updatedAt: fs.serverTimestamp() })));
        window.toast && window.toast('Your work is now saved to your account ✔', 'success');
      } catch (err) {
        console.error('Upload failed', err);
        window.toast && window.toast("Couldn't copy your work to your account. Please try again.", 'error');
      }
    } else {
      KEYS.forEach(k => (k in cloud ? ls.set(k, cloud[k]) : ls.remove(k)));
    }
    ls.set(OWNER, user.uid);
    uid = user.uid;
    push = schedule;
    reloadApp();
    status('saved');
  }

  // Polish with AI: send the CV bank to the proxy with this user's sign-in token
  window.gethiredPolish = async text => {
    if (!polishUrl) return { ok: false, error: 'not_configured' };
    if (!a.currentUser) return { ok: false, error: 'signin' };
    let idToken;
    try { idToken = await a.currentUser.getIdToken(); } catch { return { ok: false, error: 'auth' }; }
    try {
      const res = await fetch(polishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (data) return data;
      return { ok: false, error: res.status === 404 ? 'not_configured' : 'busy' };
    } catch (err) {
      console.error('Polish request failed', err);
      return { ok: false, error: 'network' };
    }
  };

  // Import from CV: send extracted CV text (or a PDF) to the import function
  window.gethiredImportCV = async payload => {
    if (!a.currentUser) return { ok: false, error: 'signin' };
    let idToken;
    try { idToken = await a.currentUser.getIdToken(); } catch { return { ok: false, error: 'auth' }; }
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      return data || { ok: false, error: res.status === 404 ? 'not_configured' : res.status === 413 ? 'too_long' : 'busy' };
    } catch (err) {
      console.error('Import request failed', err);
      return { ok: false, error: 'network' };
    }
  };

  // Delete everything this account has saved, then the sign-in record itself
  window.gethiredDeleteAll = async () => {
    const user = a.currentUser;
    if (!user) return { ok: false, error: 'signin' };
    try {
      pending.clear();
      Object.keys(timers).forEach(k => clearTimeout(timers[k]));
      push = null;
      const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, 'data'));
      await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
      try {
        await auth.deleteUser(user);
      } catch (err) {
        if (err.code !== 'auth/requires-recent-login') throw err;
        await auth.reauthenticateWithPopup(user, provider);
        await auth.deleteUser(user);
      }
      uid = null;
      clearLocal();
      reloadApp();
      showAccount(null);
      status('local');
      return { ok: true };
    } catch (err) {
      console.error('Delete failed', err);
      push = uid ? schedule : null;
      return { ok: false, error: err.code === 'auth/popup-closed-by-user' ? 'cancelled' : 'failed' };
    }
  };

  $('gh-sign-in').addEventListener('click', async () => {
    try {
      await auth.signInWithPopup(a, provider);
    } catch (err) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
        return auth.signInWithRedirect(a, provider);
      }
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) {
        console.error(err);
        window.toast && window.toast('Sign-in failed. Please try again.', 'error');
      }
    }
  });
  $('gh-sign-out').addEventListener('click', async () => {
    await flush();
    await auth.signOut(a);
  });
  window.addEventListener('beforeunload', e => { if (pending.size) { flush(); e.preventDefault(); } });

  let first = true;
  auth.onAuthStateChanged(a, async user => {
    if (user) {
      await signedIn(user);
    } else {
      const wasSignedIn = !!uid || !!ls.get(OWNER);
      uid = null; push = null;
      showAccount(null);
      if (wasSignedIn) {
        clearLocal();
        reloadApp();
        if (!first) window.toast && window.toast('Signed out. Your work is safe in your account.', 'info');
      }
      status('local');
    }
    first = false;
  });
}

start();
