// The sponsor list lives only on the server: it is stored encrypted in the repository and
// decrypted in memory with the SPONSOR_LIST_KEY environment variable. The browser never
// receives the list, only the matched sponsor for a job and a small fixed preview.
import { createDecipheriv, createHash } from 'node:crypto';
import ENC from './sponsors.enc.js';

let names = null, namesKey = null;
/** All sponsor names, or [] when the key is missing or wrong. */
export function sponsorNames(key = process.env.SPONSOR_LIST_KEY) {
  const raw = String(key || '').trim();
  if (names && namesKey === raw) return names;
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) return [];
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(ENC.iv, 'base64'));
    d.setAuthTag(Buffer.from(ENC.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(ENC.data, 'base64')), d.final()]).toString('utf8');
    names = JSON.parse(plain); namesKey = raw;
    return names;
  } catch {
    console.error('SPONSOR_LIST_KEY does not decrypt the sponsor list');
    return [];
  }
}

// A fixed preview pool for the landing page: 30 tidy names, always the same 30, so the
// ticker can never be used to page through the whole list.
const SUF = /[\s,]*(\(?\b(pty\.?|ltd\.?|limited|proprietary|inc\.?|incorporated|p\/l)\b\)?[\s.,]*)+$/i;
const SMALL = new Set(['and', 'for', 'of', 'the', 'in', 'on', 'at', 'to']);
const cap = (w, i) => (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.length <= 3 && /^[A-Z]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
let pool = null;
export function previewPool(all = sponsorNames()) {
  if (pool && all === names) return pool;
  const tidy = new Set();
  for (const n of all) {
    if (n === n.toUpperCase() || n === n.toLowerCase() || /[()]/.test(n)) continue;   // only names already in normal case
    let d = n.replace(SUF, '').replace(/\s*\((australia|aust\.?|aus)\)\s*$/i, '').replace(/[\s,.-]+$/, '').trim();
    d = d.split(' ').map((w, i) => (w === w.toUpperCase() || (i && SMALL.has(w.toLowerCase())) ? cap(w, i) : w)).join(' ');
    if (d.length >= 5 && d.length <= 30 && !/trust|trustee|t\/a|atf|\bas\b|nominees|&$|pty$|ltd$|\.[a-z]/i.test(d)) tidy.add(d);
  }
  const ranked = [...tidy].sort((a, b) => createHash('sha256').update(a).digest('hex').localeCompare(createHash('sha256').update(b).digest('hex')));
  pool = ranked.slice(0, 30);
  return pool;
}
