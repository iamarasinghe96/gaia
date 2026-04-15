/* =====================================================
   Gaia Symbiosis — appointments.js
   Appointment form → Google Sheets via Apps Script POST
   =====================================================

   SETUP INSTRUCTIONS
   ------------------
   1. Go to https://script.google.com → New project
   2. Replace the default code with the doPost() function below (in comments)
   3. Deploy → New deployment → Web App
        Execute as: Me
        Who has access: Anyone
   4. Copy the deployment URL and paste it into GOOGLE_SCRIPT_URL below
   5. Done — form submissions will appear in your linked Google Sheet

   GOOGLE APPS SCRIPT (paste into script.google.com):
   ---------------------------------------------------
   function doPost(e) {
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
     const data = e.parameter;
     sheet.appendRow([
       new Date(),
       data.name || '',
       data.email || '',
       data.company || '',
       data.service || '',
       data.message || '',
       data.datetime || ''
     ]);
     return ContentService
       .createTextOutput(JSON.stringify({ result: 'success' }))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ===================================================== */

// ── USER MUST SET THIS URL ──────────────────────────────
const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
// ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const form    = document.getElementById('appointment-form');
  const btn     = document.getElementById('submit-btn');
  const message = document.getElementById('form-message');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validate()) return;

    setLoading(true);
    hideMessage();

    const formData = new FormData(form);

    // If placeholder URL, show helpful error instead of a network failure
    if (GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
      setLoading(false);
      showMessage('error',
        'Google Apps Script URL not configured. Follow the setup instructions in js/appointments.js.');
      return;
    }

    try {
      const res = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: formData,
      });

      // Apps Script returns 302 redirect on success when deployed as Web App
      // fetch follows it and lands on JSON response
      if (res.ok || res.redirected) {
        showMessage('success',
          '✓ Your request has been received! I\'ll be in touch within 24 hours.');
        form.reset();
      } else {
        throw new Error(`Server responded with ${res.status}`);
      }
    } catch (err) {
      showMessage('error',
        'Something went wrong sending your request. Please email me directly at hello@gaiasymbiosis.com');
    } finally {
      setLoading(false);
    }
  });

  /* ── Validation ── */
  function validate() {
    let valid = true;
    clearErrors();

    const name     = form.querySelector('[name="name"]');
    const email    = form.querySelector('[name="email"]');
    const service  = form.querySelector('[name="service"]');
    const datetime = form.querySelector('[name="datetime"]');

    if (!name.value.trim()) {
      setError(name, 'Please enter your name.'); valid = false;
    }
    if (!email.value.trim()) {
      setError(email, 'Please enter your email.'); valid = false;
    } else if (!isValidEmail(email.value.trim())) {
      setError(email, 'Please enter a valid email address.'); valid = false;
    }
    if (!service.value) {
      setError(service, 'Please select a service.'); valid = false;
    }
    if (!datetime.value) {
      setError(datetime, 'Please select a preferred date and time.'); valid = false;
    }

    return valid;
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function setError(field, msg) {
    field.classList.add('error');
    const errEl = field.parentElement.querySelector('.field-error');
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
  }

  function clearErrors() {
    form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    form.querySelectorAll('.field-error').forEach(el => {
      el.textContent = ''; el.classList.remove('visible');
    });
  }

  /* ── UI helpers ── */
  function setLoading(on) {
    btn.classList.toggle('loading', on);
    btn.disabled = on;
  }

  function showMessage(type, text) {
    message.className = 'form-message ' + type;
    message.textContent = text;
  }

  function hideMessage() {
    message.className = 'form-message';
    message.textContent = '';
  }
});
