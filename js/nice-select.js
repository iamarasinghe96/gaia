/* Rounded option lists (see css/nice-select.css).
   - <select>: the browser's popup is replaced by a rounded list. The select stays in place and
     keeps its value, so picking an option fires the same input/change events as before.
   - <input list="...">: the browser's suggestion popup is replaced by a rounded, filtered list.
   On phones and tablets selects keep the system picker (the iOS wheel), which suits touch best. */
(() => {
  const touch = matchMedia('(hover: none)').matches;
  const pop = document.createElement('ul');
  pop.className = 'nsel-pop'; pop.setAttribute('role', 'listbox'); pop.hidden = true;
  document.body.appendChild(pop);
  let owner = null, items = [], active = -1;

  function place(el) {
    const r = el.getBoundingClientRect(), below = innerHeight - r.bottom, h = Math.min(280, pop.scrollHeight || 280);
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8))}px`;
    pop.style.minWidth = `${Math.max(r.width, 160)}px`;
    pop.style.maxWidth = `${Math.max(r.width, 260)}px`;
    if (below < h + 12 && r.top > below) { pop.style.top = ''; pop.style.bottom = `${innerHeight - r.top + 6}px`; }
    else { pop.style.bottom = ''; pop.style.top = `${r.bottom + 6}px`; }
  }
  function open(el, list, selected) {
    owner = el; items = list;
    pop.innerHTML = list.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${it.value === selected}"${it.muted ? ' class="is-muted"' : ''}></li>`).join('');
    [...pop.children].forEach((li, i) => { li.textContent = list[i].label; });
    active = Math.max(0, list.findIndex(it => it.value === selected));
    pop.hidden = !list.length; if (!list.length) return;
    mark(); place(el);
    requestAnimationFrame(() => pop.classList.add('is-open'));
    el.setAttribute('aria-expanded', 'true');
    const cur = pop.children[active]; if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    if (!owner) return;
    owner.setAttribute('aria-expanded', 'false');
    pop.classList.remove('is-open'); pop.hidden = true; owner = null; items = [];
  }
  function mark() { [...pop.children].forEach((li, i) => li.classList.toggle('is-active', i === active)); const a = pop.children[active]; if (a) a.scrollIntoView({ block: 'nearest' }); }
  function choose(i) {
    const it = items[i], el = owner; if (!it || !el) return;
    close();
    if (el.tagName === 'SELECT') el.value = it.value; else el.value = it.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }

  // ─── <select> ───
  const selectItems = sel => [...sel.options].map(o => ({ value: o.value, label: o.textContent, muted: !o.value }));
  if (!touch) {
    document.addEventListener('mousedown', e => {
      const sel = e.target.closest('select');
      if (!sel || sel.disabled || sel.multiple) return;
      e.preventDefault();
      if (owner === sel) { close(); return; }
      sel.focus(); open(sel, selectItems(sel), sel.value);
    }, true);
    document.addEventListener('keydown', e => {
      const sel = e.target.closest && e.target.closest('select');
      if (sel && owner !== sel && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); open(sel, selectItems(sel), sel.value); }
    }, true);
  }

  // ─── <input list> (State, Country, link names, employers) ───
  const listOf = input => { const id = input.dataset.list || input.getAttribute('list'); const dl = id && document.getElementById(id); return dl ? [...dl.options].map(o => o.value).filter(Boolean) : []; };
  function suggest(input) {
    const q = input.value.trim().toLowerCase();
    const all = [...new Set(listOf(input))];
    const hits = (q ? all.filter(v => v.toLowerCase().includes(q) && v.toLowerCase() !== q) : all)
      .sort((a, b) => (q ? a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) : 0)).slice(0, 12);
    if (!hits.length) { if (owner === input) close(); return; }
    open(input, hits.map(v => ({ value: v, label: v })), null);
    active = -1; mark();
  }
  document.addEventListener('focusin', e => {
    const input = e.target;
    if (input.tagName !== 'INPUT') return;
    if (input.hasAttribute('list')) { input.dataset.list = input.getAttribute('list'); input.removeAttribute('list'); }
    if (input.dataset.list) suggest(input);
  });
  document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.list && e.isTrusted) suggest(e.target); });

  // ─── shared keyboard, pointer and closing ───
  document.addEventListener('keydown', e => {
    if (!owner || e.target !== owner) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length; mark(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') close();
  }, true);
  pop.addEventListener('mousedown', e => e.preventDefault());
  pop.addEventListener('click', e => { const li = e.target.closest('li'); if (li) choose(+li.dataset.i); });
  pop.addEventListener('mousemove', e => { const li = e.target.closest('li'); if (li && +li.dataset.i !== active) { active = +li.dataset.i; mark(); } });
  document.addEventListener('mousedown', e => { if (owner && !pop.contains(e.target) && e.target !== owner) close(); });
  document.addEventListener('focusout', e => { if (owner && e.target === owner) setTimeout(() => { if (document.activeElement !== owner) close(); }, 120); });
  addEventListener('resize', close);
  addEventListener('scroll', e => { if (owner && !pop.contains(e.target)) place(owner); }, true);
})();
