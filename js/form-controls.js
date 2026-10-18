/* Rounded custom dropdown and date/time picker for mouse/trackpad devices.
   The native <select>/<input> stay in the form (hidden) and hold the value, so
   submission and validation are unchanged. Touch devices keep native pickers. */

(() => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const ARROW = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const openers = [];

  const hideNative = (el, wrap) => {
    el.classList.add('is-enhanced');
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.after(wrap);
    const label = document.querySelector(`label[for="${el.id}"]`);
    return label;
  };
  const clearError = el => {
    el.classList.remove('error');
    const msg = el.parentElement.querySelector('.field-error');
    if (msg) { msg.textContent = ''; msg.classList.remove('visible'); }
  };
  const closeAll = except => openers.forEach(o => { if (o !== except) o.close(); });
  document.addEventListener('click', e => { const path = e.composedPath(); openers.forEach(o => { if (!path.includes(o.wrap)) o.close(); }); });

  /* Dropdown */
  function enhanceSelect(select) {
    const wrap = document.createElement('div');
    wrap.className = 'cfield';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cfield-btn';
    btn.id = select.id + '-btn';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', select.id + '-list');
    btn.innerHTML = `<span class="cfield-value"></span>${CHEVRON}`;
    const list = document.createElement('ul');
    list.className = 'cpop clist';
    list.id = select.id + '-list';
    list.setAttribute('role', 'listbox');
    const real = [...select.options].map((o, i) => ({ o, i })).filter(({ o, i }) => !(i === 0 && o.value === ''));
    real.forEach(({ o, i }, n) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `${select.id}-opt-${n}`;
      li.dataset.index = i;
      li.textContent = o.textContent;
      li.addEventListener('click', () => { choose(i); close(); btn.focus(); });
      li.addEventListener('mousemove', () => setActive(n));
      list.appendChild(li);
    });
    wrap.append(btn, list);
    const label = hideNative(select, wrap);
    if (label) { label.htmlFor = btn.id; label.id = label.id || select.id + '-label'; list.setAttribute('aria-labelledby', label.id); }

    const items = [...list.children];
    let active = -1;
    const setActive = n => {
      active = Math.max(0, Math.min(items.length - 1, n));
      items.forEach((li, j) => li.classList.toggle('is-active', j === active));
      btn.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      const o = select.options[select.selectedIndex];
      btn.querySelector('.cfield-value').textContent = o ? o.textContent : '';
      btn.classList.toggle('is-placeholder', !select.value);
      items.forEach(li => li.setAttribute('aria-selected', String(Number(li.dataset.index) === select.selectedIndex)));
    };
    const choose = i => {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      clearError(select);
      render();
    };
    const open = () => {
      closeAll(api);
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      const cur = items.findIndex(li => Number(li.dataset.index) === select.selectedIndex);
      setActive(cur >= 0 ? cur : 0);
    };
    const close = () => {
      wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    };
    btn.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
    btn.addEventListener('keydown', e => {
      const isOpen = wrap.classList.contains('open');
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        if (!isOpen) return open();
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if ((e.key === 'Enter' || e.key === ' ') && isOpen) {
        e.preventDefault();
        choose(Number(items[active].dataset.index));
        close();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        close();
      }
    });
    select.form && select.form.addEventListener('reset', () => setTimeout(render));
    const api = { wrap, close };
    openers.push(api);
    render();
  }

  /* Date & time */
  function enhanceDateTime(input) {
    const pad = n => String(n).padStart(2, '0');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const SLOTS = [];
    for (let m = 8 * 60; m <= 17 * 60 + 30; m += 30) SLOTS.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`; };
    const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const slotPast = (d, t) => { if (!sameDay(d, today)) return false; const [h, m] = t.split(':').map(Number); const now = new Date(); return h * 60 + m <= now.getHours() * 60 + now.getMinutes(); };

    let selDate = null, selTime = null;
    let view = new Date(today.getFullYear(), today.getMonth(), 1);
    const parse = () => {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(input.value);
      if (m) { selDate = new Date(+m[1], m[2] - 1, +m[3]); selTime = m[4]; view = new Date(selDate.getFullYear(), selDate.getMonth(), 1); }
      else { selDate = null; selTime = null; }
    };

    const wrap = document.createElement('div');
    wrap.className = 'cfield';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cfield-btn';
    btn.id = input.id + '-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span class="cfield-value"></span>${CAL}`;
    const pop = document.createElement('div');
    pop.className = 'cpop cdt';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Choose a date and time');
    pop.innerHTML = `
      <div class="cdt-cal">
        <div class="cdt-head">
          <button type="button" class="cdt-nav" data-step="-1" aria-label="Previous month">${ARROW('m15 6-6 6 6 6')}</button>
          <strong class="cdt-month" aria-live="polite"></strong>
          <button type="button" class="cdt-nav" data-step="1" aria-label="Next month">${ARROW('m9 6 6 6-6 6')}</button>
        </div>
        <div class="cdt-week" aria-hidden="true"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
        <div class="cdt-days"></div>
      </div>
      <div class="cdt-times">
        <p class="cdt-label">Time</p>
        <div class="cdt-slots"></div>
      </div>`;
    wrap.append(btn, pop);
    const label = hideNative(input, wrap);
    if (label) label.htmlFor = btn.id;

    const daysEl = pop.querySelector('.cdt-days');
    const slotsEl = pop.querySelector('.cdt-slots');

    const renderBtn = () => {
      const v = btn.querySelector('.cfield-value');
      if (selDate && selTime) {
        v.textContent = `${selDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(selTime)}`;
      } else if (selDate) {
        v.textContent = `${selDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, pick a time`;
      } else {
        v.textContent = 'Select a date and time';
      }
      btn.classList.toggle('is-placeholder', !(selDate && selTime));
    };
    const commit = () => {
      input.value = selDate && selTime ? `${selDate.getFullYear()}-${pad(selDate.getMonth() + 1)}-${pad(selDate.getDate())}T${selTime}` : '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (input.value) clearError(input);
      renderBtn();
    };
    const renderCal = () => {
      pop.querySelector('.cdt-month').textContent = view.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      pop.querySelector('[data-step="-1"]').disabled = view <= new Date(today.getFullYear(), today.getMonth(), 1);
      daysEl.innerHTML = '';
      const lead = (view.getDay() + 6) % 7;
      for (let i = 0; i < lead; i++) daysEl.appendChild(document.createElement('span'));
      const n = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const date = new Date(view.getFullYear(), view.getMonth(), d);
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d;
        b.dataset.day = d;
        b.setAttribute('aria-label', date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
        b.disabled = date < today;
        if (sameDay(date, today)) b.classList.add('is-today');
        if (sameDay(date, selDate)) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
        b.addEventListener('click', () => {
          selDate = date;
          if (selTime && slotPast(selDate, selTime)) selTime = null;
          commit(); renderCal(); renderSlots();
          const first = slotsEl.querySelector('button:not(:disabled)');
          if (first && !selTime) first.focus({ preventScroll: true });
        });
        daysEl.appendChild(b);
      }
    };
    const renderSlots = () => {
      slotsEl.innerHTML = '';
      SLOTS.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = fmtTime(t);
        b.disabled = !selDate || slotPast(selDate, t);
        if (t === selTime) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
        b.addEventListener('click', () => { selTime = t; commit(); renderSlots(); close(); btn.focus(); });
        slotsEl.appendChild(b);
      });
      slotsEl.classList.toggle('is-waiting', !selDate);
      const sel = slotsEl.querySelector('.is-selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    };
    pop.querySelectorAll('.cdt-nav').forEach(b => b.addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.step), 1);
      renderCal();
    }));
    daysEl.addEventListener('keydown', e => {
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(e.key in steps) || !e.target.dataset.day) return;
      e.preventDefault();
      const target = new Date(view.getFullYear(), view.getMonth(), Number(e.target.dataset.day) + steps[e.key]);
      if (target < today) return;
      if (target.getMonth() !== view.getMonth()) { view = new Date(target.getFullYear(), target.getMonth(), 1); renderCal(); }
      const b = daysEl.querySelector(`[data-day="${target.getDate()}"]`);
      if (b) b.focus();
    });

    const open = () => {
      closeAll(api);
      parse(); renderCal(); renderSlots();
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      const focusEl = daysEl.querySelector('.is-selected') || daysEl.querySelector('.is-today:not(:disabled)') || daysEl.querySelector('button:not(:disabled)');
      if (focusEl) focusEl.focus({ preventScroll: true });
    };
    const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('open')) { e.stopPropagation(); close(); btn.focus(); } });
    input.form && input.form.addEventListener('reset', () => setTimeout(() => { parse(); renderBtn(); }));
    const api = { wrap, close };
    openers.push(api);
    parse(); renderBtn();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('select[data-enhance]').forEach(enhanceSelect);
    document.querySelectorAll('input[type="datetime-local"][data-enhance]').forEach(enhanceDateTime);
  });
})();
