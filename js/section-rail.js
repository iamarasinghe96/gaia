/* Section rail (see css/section-rail.css). Finds the page's sections, marks where each one
   starts along the right edge, shows where you are, and jumps or scrubs to a section. */
(() => {
  const SEL = '.view.active .builder-section, .view.active .panel, #view-help.active h2, main [data-ctx]';
  const labelOf = el => (el.dataset.ctx && el.dataset.ctx.trim()) || (el.querySelector('.panel-title, h2, h3') || el).textContent.replace(/^[^\p{L}]+/u, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const rail = document.createElement('div');
  rail.className = 'srail'; rail.setAttribute('role', 'navigation'); rail.setAttribute('aria-label', 'Jump to a section');
  rail.innerHTML = '<div class="srail-track"></div><div class="srail-thumb"></div><div class="srail-label" aria-hidden="true"></div>';
  document.body.appendChild(rail);
  const thumb = rail.querySelector('.srail-thumb'), label = rail.querySelector('.srail-label');
  let sections = [], marks = [], idle, frame = 0;

  const docH = () => Math.max(document.documentElement.scrollHeight, innerHeight);
  const topOf = el => el.getBoundingClientRect().top + scrollY;
  const header = () => (document.querySelector('body > header') || { offsetHeight: 0 }).offsetHeight;
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
    const line = scrollY + header() + 40;
    let cur = -1;
    sections.forEach((s, i) => { if (s.top <= line) cur = i; });
    marks.forEach((m, i) => m.classList.toggle('is-current', i === cur));
  }
  function show(i) { const s = sections[i]; if (!s) return; label.textContent = s.name; label.style.top = marks[i].style.top; label.classList.add('is-shown'); }
  function hide() { label.classList.remove('is-shown'); }
  function go(i, smooth = true) { const s = sections[i]; if (!s) return; scrollTo({ top: Math.max(0, topOf(s.el) - offset() - 12), behavior: smooth ? 'smooth' : 'auto' }); }
  function wake() { rail.classList.add('is-on'); clearTimeout(idle); idle = setTimeout(() => { rail.classList.remove('is-on'); hide(); }, 1400); }

  // Touch or drag along the rail: scrub to the nearest section, with its name showing
  let dragging = false;
  const nearest = y => { const r = rail.getBoundingClientRect(), D = docH(); const docY = ((y - r.top) / r.height) * D; let best = 0;
    sections.forEach((s, i) => { if (Math.abs(s.top - docY) < Math.abs(sections[best].top - docY)) best = i; }); return best; };
  rail.addEventListener('pointerdown', e => { if (!sections.length) return; dragging = true; rail.setPointerCapture(e.pointerId); const i = nearest(e.clientY); show(i); go(i, false); wake(); });
  rail.addEventListener('pointermove', e => { if (!dragging) return; const i = nearest(e.clientY); show(i); go(i, false); wake(); });
  const end = () => { if (!dragging) return; dragging = false; setTimeout(hide, 600); };
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
