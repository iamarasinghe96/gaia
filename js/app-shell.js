/* The GetHired app frame on tool pages (same behaviour as the CV Prompt Builder):
   - phones: the header shows the section you are in, fading to the next as you scroll
   - phones and tablets: the step bar hides while moving down the page and returns when moving up */
(() => {
  const header = document.querySelector('body > header'), nav = document.querySelector('.main-nav'), box = document.getElementById('gh-ctx');
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  if (!header) return;
  document.documentElement.style.setProperty('--hdr-h', header.offsetHeight + 'px');
  new ResizeObserver(() => document.documentElement.style.setProperty('--hdr-h', header.offsetHeight + 'px')).observe(header);

  let shown = '';
  const set = text => {
    if (!box || text === shown) return;
    shown = text;
    box.querySelectorAll('.gh-ctx-t').forEach(old => { old.classList.add('out'); setTimeout(() => old.remove(), 500); });
    const next = document.createElement('span');
    next.className = 'gh-ctx-t in'; next.textContent = text; box.appendChild(next);
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('in')));
  };
  const clean = t => String(t || '').replace(/^[^\p{L}]+/u, '').replace(/\s+/g, ' ').trim();
  const small = matchMedia('(max-width: 900px)');
  let lastY = scrollY, ticking = false;
  const update = () => {
    ticking = false;
    if (box && box.offsetParent) {
      const line = header.getBoundingClientRect().bottom + 24;
      let cur = '';
      for (const h of document.querySelectorAll('main [data-ctx]')) {
        if (!h.offsetParent) continue;
        if (h.getBoundingClientRect().top < line) cur = h.dataset.ctx || h.textContent; else break;
      }
      const active = document.querySelector('.main-nav-tab.active .step-t');
      set(clean(cur) || clean(active ? active.firstChild.textContent : document.title));
    }
    if (nav) {
      const y = scrollY, dy = y - lastY;
      if (!small.matches || y < 40) { nav.classList.remove('nav-away'); lastY = y; }
      else if (Math.abs(dy) >= 8) { nav.classList.toggle('nav-away', dy > 0); lastY = y; }
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  if (nav) nav.addEventListener('focusin', () => nav.classList.remove('nav-away'));
  window.appShellRefresh = update;
  update();
})();
