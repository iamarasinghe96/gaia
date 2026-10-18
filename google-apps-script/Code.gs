/**
 * Gaia Symbiosis: booking form handler (Google Apps Script, bound to the "Book a Call" sheet)
 * Saves each request to the first tab and emails a notification.
 * After changing this file: Save, then Deploy > Manage deployments > edit > Version: New version > Deploy.
 */

const NOTIFY_EMAIL = 'iamarasinghe96@gmail.com';
const SERVICES = [
  'AI & Intelligent Automation', 'Healthcare IT', 'Government & Compliance', 'Web Apps & Portals',
  'Data Tools & ESG Reporting', 'Process Automation', 'Something else',
];
const MAX_PER_HOUR = 20;

function doPost(e) {
  const p = (e && e.parameter) || {};

  // Bots fill the hidden "website" field; pretend success so they move on.
  if (p.website) return reply_('success');

  const name = text_(p.name, 100);
  const email = text_(p.email, 254);
  const company = text_(p.company, 150);
  const service = SERVICES.indexOf(p.service) >= 0 ? p.service : 'Something else';
  const message = text_(p.message, 3000, true);
  const when = text_(p.datetime, 25);

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply_('error', 'Invalid name or email');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_('error', 'Busy, please try again');
  try {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get('count') || 0);
    if (count >= MAX_PER_HOUR) return reply_('error', 'Too many requests, please email instead');
    cache.put('count', String(count + 1), 3600);

    const dupKey = 'dup_' + Utilities.base64EncodeWebSafe(email.toLowerCase()).slice(0, 200);
    if (cache.get(dupKey)) return reply_('success');
    cache.put(dupKey, '1', 120);

    SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([
      new Date(), cell_(name), cell_(email), cell_(company), cell_(service), cell_(message), cell_(when),
    ]);
  } finally {
    lock.releaseLock();
  }

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: oneLine_('New call request: ' + name + ' (' + service + ')'),
      body: 'Name: ' + name + '\nEmail: ' + email + '\nCompany: ' + (company || '-') +
        '\nService: ' + service + '\nPreferred time: ' + (when || '-') + '\n\nMessage:\n' + (message || '-'),
      name: 'Gaia Symbiosis website',
    });
  } catch (err) {
    console.error('Email failed: ' + err);
  }

  return reply_('success');
}

function testEmail() {
  MailApp.sendEmail(NOTIFY_EMAIL, 'Test from Gaia Symbiosis form', 'If you got this, email notifications work.');
}

// Trim, cap length, and remove control characters (keeps line breaks only where allowed).
function text_(v, max, multiline) {
  let s = String(v || '').slice(0, max);
  s = multiline ? s.replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
                : s.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  return s.trim();
}

// Stop the sheet from treating visitor text as a formula (e.g. =IMPORTXML(...)).
function cell_(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function oneLine_(s) {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

function reply_(result, message) {
  return ContentService.createTextOutput(JSON.stringify(message ? { result: result, message: message } : { result: result }))
    .setMimeType(ContentService.MimeType.JSON);
}
