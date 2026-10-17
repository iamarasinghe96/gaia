document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav');
  const darkTop = document.querySelector('.hero, .page-hero');

  /* Nav: transparent over dark hero, solid elsewhere */
  const setNav = () => {
    const limit = darkTop ? darkTop.offsetHeight - 80 : 0;
    nav.classList.toggle('is-solid', window.scrollY > limit);
  };
  setNav();
  window.addEventListener('scroll', setNav, { passive: true });
  window.addEventListener('resize', setNav);

  /* Mobile menu */
  const burger = document.querySelector('.hamburger');
  const menu = document.getElementById('mobile-menu');
  if (burger && menu) {
    const close = () => { burger.setAttribute('aria-expanded', 'false'); menu.classList.remove('open'); };
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('open', open);
      if (open) nav.classList.add('is-solid'); else setNav();
    });
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); setNav(); } });
  }

  /* Scroll reveal */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  /* Animated counters */
  const counters = document.querySelectorAll('[data-count]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const runCounter = el => {
    const target = Number(el.dataset.count);
    if (reduce) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 1600;
    const tick = now => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (counters.length && 'IntersectionObserver' in window) {
    const co = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { runCounter(e.target); co.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach(c => co.observe(c));
  }

  /* Cursor-follow glow on cards */
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  /* Project filter */
  const chips = document.querySelectorAll('.chip[data-filter]');
  const projects = document.querySelectorAll('.project[data-category]');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');
      const f = chip.dataset.filter;
      projects.forEach(p => {
        const show = f === 'all' || p.dataset.category === f;
        p.classList.toggle('is-hidden', !show);
        p.classList.remove('is-entering');
        if (show) { void p.offsetWidth; p.classList.add('is-entering'); }
      });
    });
  });

  /* Waitlist forms (tool placeholder pages) open a pre-filled email */
  document.querySelectorAll('form.waitlist').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const msg = form.parentElement.querySelector('.waitlist-msg');
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
      if (!ok) {
        msg.textContent = 'Please enter a valid email address.';
        msg.classList.add('err');
        input.focus();
        return;
      }
      const tool = form.dataset.tool || 'a Gaia Symbiosis tool';
      const subject = encodeURIComponent(`Waitlist: ${tool}`);
      const body = encodeURIComponent(`Please add ${input.value.trim()} to the ${tool} waitlist.`);
      window.location.href = `mailto:iamarasinghe96@gmail.com?subject=${subject}&body=${body}`;
      msg.classList.remove('err');
      msg.textContent = "Thanks! Your email app should open. Send it and you're on the list.";
      form.reset();
    });
  });

  /* Footer year */
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
});
