/**
 * Gaia Symbiosis: booking form handler
 *
 * Saves each "Book a call" request to a Google Sheet and emails you a
 * notification.
 *
 * Setup:
 * 1. Open your Google Sheet, then Extensions > Apps Script.
 * 2. Replace everything in Code.gs with this file and click Save.
 * 3. Pick testSetup in the function dropdown, click Run, and allow the
 *    permissions. You should get a test email and a "Bookings" tab.
 * 4. Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 *    The web app URL stays the same. If you instead create a NEW deployment,
 *    put its URL in js/appointments.js (Execute as: Me, Who has access: Anyone).
 */

const NOTIFY_EMAIL = 'iamarasinghe96@gmail.com';
const SHEET_NAME = 'Bookings';
const HEADERS = ['Timestamp', 'Name', 'Email', 'Company', 'Service', 'Preferred date & time', 'Message'];

function doPost(e) {
  const p = (e && e.parameter) || {};

  // Hidden "website" field is left empty by people and filled in by spam bots.
  if (p.website) return json_({ result: 'success' });

  if (!p.name || !p.email) return json_({ result: 'error', message: 'Missing name or email' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_().appendRow([
      new Date(),
      clean_(p.name), clean_(p.email), clean_(p.company), clean_(p.service),
      formatWhen_(p.datetime), clean_(p.message),
    ]);
  } finally {
    lock.releaseLock();
  }

  try {
    notify_(p);
  } catch (err) {
    // The request is already saved in the sheet, so still report success.
    console.error('Email failed: ' + err);
  }

  return json_({ result: 'success' });
}

/** Run this once from the editor to grant permissions and send yourself a test email. */
function testSetup() {
  getSheet_();
  notify_({
    name: 'Test Person', email: NOTIFY_EMAIL, company: 'Test Co',
    service: 'AI & Intelligent Automation', datetime: '2026-10-20T10:30',
    message: 'This is a test from testSetup().',
  });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from the Google Sheet: Extensions > Apps Script.');
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function notify_(p) {
  const when = formatWhen_(p.datetime);
  const rows = [
    ['Name', p.name], ['Email', p.email], ['Company', p.company],
    ['Service', p.service], ['Preferred time', when], ['Message', p.message],
  ];
  const html = '<h2 style="font-family:Arial,sans-serif;margin:0 0 12px">New call request</h2>'
    + '<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">'
    + rows.map(([k, v]) => '<tr><td style="padding:6px 16px 6px 0;color:#5b6475;vertical-align:top">' + k
      + '</td><td style="padding:6px 0">' + esc_(v || '-').replace(/\n/g, '<br>') + '</td></tr>').join('')
    + '</table><p style="font-family:Arial,sans-serif;font-size:13px;color:#5b6475">Reply to this email to respond directly.</p>';
  const text = rows.map(([k, v]) => k + ': ' + (v || '-')).join('\n');

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    replyTo: clean_(p.email),
    subject: 'New call request: ' + clean_(p.name) + (p.service ? ' (' + clean_(p.service) + ')' : ''),
    body: text,
    htmlBody: html,
    name: 'Gaia Symbiosis website',
  });
}

function formatWhen_(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return clean_(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "EEE d MMM yyyy, h:mm a");
}

function clean_(v) {
  // Strip characters that would make the sheet treat input as a formula.
  return String(v || '').slice(0, 5000).replace(/^[=+\-@]/, "'$&");
}

function esc_(v) {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
