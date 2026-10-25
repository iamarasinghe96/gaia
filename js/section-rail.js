/* Section rail (see css/section-rail.css). Finds the page's sections, marks where each one
   starts along the right edge, shows where you are, and jumps or scrubs to a section. */
(() => {
  // Tools: their sections; site pages: each section of the page that has a heading
  const SEL = '.view.active .builder-section, .view.active .panel, #view-help.active h2, main [data-ctx], body:not(.app-shell) main > section:not(.js-results[hidden])';
  const labelOf = el => (el.dataset.ctx && el.dataset.ctx.trim()) || (el.matches('section') && !el.querySelector('h1, h2') ? '' : (el.querySelector('.panel-title, h1, h2, h3') || el).textContent).replace(/^[^\p{L}]+/u, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const rail = document.createElement('div');
  rail.className = 'srail'; rail.setAttribute('role', 'navigation'); rail.setAttribute('aria-label', 'Jump to a section');
  rail.innerHTML = '<div class="srail-track"></div><div class="srail-thumb"></div><div class="srail-label" aria-hidden="true"></div>';
  document.body.appendChild(rail);
  document.documentElement.classList.add('has-srail');
  const thumb = rail.querySelector('.srail-thumb'), label = rail.querySelector('.srail-label');
  let sections = [], marks = [], idle, frame = 0;

  const docH = () => Math.max(document.documentElement.scrollHeight, innerHeight);
  const topOf = el => el.getBoundingClientRect().top + scrollY;
  const header = () => (document.querySelector('body > header, .nav') || { offsetHeight: 0 }).offsetHeight;
  // On phones the step bar can slide back in under the header, so leave room for it when jumping
  const offset = () => { const nav = document.querySelector('.main-nav'); return header() + (nav && matchMedia('(max-width: 900px)').matches ? nav.offsetHeight : 0); };

  function collect() {
    const seen = new Set();
    sections = [...document.querySelectorAll(SEL)].filter(el => {
      if (!el.offsetParent || seen.has(el) || [...seen].some(s => s.contains(el))) return false;
      seen.add(el); return !!labelOf(el);
    }).map(el => ({ el, name: labelOf(el) }));
    marks.forEach(m => m.remove());
    marks = sections.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'srail-mark'; b.setAttribute('aria-label', `Go to ${s.name}`);
      b.addEventListener('click', e => { e.stopPropagation(); go(i); });
      b.addEventListener('mouseenter', () => show(i)); b.addEventListener('mouseleave', hide);
      b.addEventListener('focus', () => show(i)); b.addEventListener('blur', hide);
      rail.appendChild(b); return b;
    });
    layout();
  }
  function layout() {
    const H = rail.clientHeight, D = docH();
    rail.hidden = D <= innerHeight + 40;
    sections.forEach((s, i) => { s.top = topOf(s.el); marks[i].style.top = `${Math.min(H - 2, Math.max(2, (s.top / D) * H))}px`; });
    paint();
  }
  function paint() {
    const H = rail.clientHeight, D = docH();
    thumb.style.height = `${Math.max(28, (innerHeight / D) * H)}px`;
    thumb.style.top = `${Math.min(H - parseFloat(thumb.style.height), (scrollY / D) * H)}px`;
    const nav = document.querySelector('.main-nav'), navOn = nav && matchMedia('(max-width: 900px)').matches && !nav.classList.contains('nav-away');
    const line = scrollY + (navOn ? offset() : header()) + 40;
    let cur = -1;
    sections.forEach((s, i) => { if (s.top <= line) cur = i; });
    marks.forEach((m, i) => m.classList.toggle('is-current', i === cur));
  }
  function show(i) { const s = sections[i]; if (!s) return; label.textContent = s.name; label.style.top = marks[i].style.top; label.classList.add('is-shown'); }
  function hide() { label.classList.remove('is-shown'); }
  // Jumping down hides the phone step bar; jumping up brings it back, so leave room for it then
  function go(i, smooth = true) {
    const s = sections[i]; if (!s) return;
    const target = topOf(s.el), off = target - header() - 12 > scrollY ? header() : offset();
    scrollTo({ top: Math.max(0, target - off - 12), behavior: smooth ? 'smooth' : 'instant' });
  }
  function wake() { rail.classList.add('is-on'); clearTimeout(idle); idle = setTimeout(() => { rail.classList.remove('is-on'); hide(); }, 1400); }

  // Drag the thumb (or anywhere on the rail) like a scrollbar; the current section's name shows
  let dragging = false, grab = 0;
  const current = () => { const line = scrollY + header() + 40; let cur = 0; sections.forEach((s, i) => { if (s.top <= line) cur = i; }); return cur; };
  const toScroll = y => { const r = rail.getBoundingClientRect(), D = docH(); scrollTo({ top: Math.max(0, Math.min(D - innerHeight, ((y - r.top - grab) / r.height) * D)), behavior: 'instant' }); };
  const label2thumb = () => { if (!sections.length) return; const i = current(); label.textContent = sections[i].name; label.style.top = `${parseFloat(thumb.style.top) + parseFloat(thumb.style.height) / 2}px`; label.classList.add('is-shown'); };
  rail.addEventListener('pointerdown', e => {
    const tr = thumb.getBoundingClientRect();
    const onThumb = e.clientY >= tr.top - 4 && e.clientY <= tr.bottom + 4;   // grabbing the thumb always drags, even over a mark
    if (e.target.closest('.srail-mark') && !onThumb) return;                // a mark away from the thumb is a jump (click)
    e.preventDefault();
    dragging = true; rail.classList.add('is-dragging'); rail.setPointerCapture(e.pointerId);
    grab = onThumb ? e.clientY - tr.top : tr.height / 2;
    toScroll(e.clientY); wake();
  });
  rail.addEventListener('pointermove', e => { if (!dragging) return; toScroll(e.clientY); paint(); label2thumb(); wake(); });
  const end = () => { if (!dragging) return; dragging = false; rail.classList.remove('is-dragging'); setTimeout(hide, 700); };
  rail.addEventListener('pointerup', end); rail.addEventListener('pointercancel', end);

  addEventListener('scroll', () => { wake(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); }, { passive: true });
  addEventListener('resize', () => requestAnimationFrame(layout));
  // Sections open, close and change view: re-measure (debounced)
  let t; const again = () => { clearTimeout(t); t = setTimeout(collect, 250); };
  new MutationObserver(list => { if (list.some(m => !rail.contains(m.target) && m.target !== rail && !(m.target.closest && m.target.closest('header')))) again(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  addEventListener('load', collect);
  collect();
})();
