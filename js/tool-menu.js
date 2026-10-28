/* The ☰ menu at the right end of every tool header: home, all tools, this tool's
   How it works, privacy, and (when signed in) deleting your account. */
(() => {
  const actions = document.querySelector('body > header .header-actions');
  if (!actions || document.getElementById('tool-menu-btn')) return;
  const onBuilder = /\/cv-builder\.html$/.test(location.pathname);
  const signedIn = () => { const u = document.getElementById('gh-user'); return !!(u && !u.hidden); };

  const wrap = document.createElement('div');
  wrap.className = 'tool-menu';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tool-menu-btn'; btn.className = 'tool-menu-btn';
  btn.setAttribute('aria-label', 'Menu'); btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'tool-menu');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  const menu = document.createElement('div');
  menu.id = 'tool-menu'; menu.className = 'tool-menu-list'; menu.hidden = true;

  const item = (icon, label, href, cls) => {
    const a = document.createElement('a');
    a.className = 'tool-menu-item' + (cls ? ' ' + cls : ''); a.href = href;
    const i = document.createElement('span'); i.className = 'tool-menu-ico'; i.setAttribute('aria-hidden', 'true'); i.textContent = icon;
    a.append(i, document.createTextNode(label));
    return a;
  };
  // "How it works" goes where this tool's own help step goes
  const help = document.querySelector('.main-nav-tab.nav-help');
  const howHref = help && help.getAttribute('href') ? help.getAttribute('href') : '/tools/cv-builder.html#help';
  const how = item('?', 'How it works', howHref);
  if (help && !help.getAttribute('href')) how.addEventListener('click', e => { e.preventDefault(); close(); help.click(); });
  const del = item('🗑', 'Delete my account', '/tools/cv-builder.html#delete', 'is-danger');
  if (onBuilder) del.addEventListener('click', e => {
    e.preventDefault(); close();
    if (typeof window.switchView === 'function') window.switchView('help');
    setTimeout(() => { const z = document.getElementById('delete-zone'); if (z) z.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 250);
  });
  const sep = document.createElement('div'); sep.className = 'tool-menu-sep'; sep.setAttribute('role', 'separator');
  menu.append(
    item('⌂', 'Gaia Symbiosis home', '/'),
    item('▦', 'All tools', '/services.html#tools'),
    how,
    item('🔒', 'Privacy Policy', '/privacy.html'),
    sep, del,
  );
  wrap.append(btn, menu);
  actions.appendChild(wrap);

  function open(){
    const s = signedIn();
    del.hidden = !s; sep.hidden = !s;
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on');
  }
  function close(){ menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('on'); }
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
})();
