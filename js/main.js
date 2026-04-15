/* =====================================================
   Gaia Symbiosis — main.js
   Nav, scroll animations, project filter, profile image
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Sticky nav ── */
  const nav = document.getElementById('nav');
  const SCROLL_THRESHOLD = 60;
  const updateNav = () => {
    nav.classList.toggle('scrolled', window.scrollY > SCROLL_THRESHOLD);
  };
  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  /* ── Mobile hamburger ── */
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('nav-mobile');
  hamburger.addEventListener('click', () => {
    const open = hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open);
  });

  // Close mobile menu when a link is clicked
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', false);
    });
  });

  /* ── IntersectionObserver for scroll reveal ── */
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));

  /* ── Project filter ── */
  const chips = document.querySelectorAll('.chip[data-filter]');
  const projectCards = document.querySelectorAll('.project-card[data-category]');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const filter = chip.dataset.filter;
      projectCards.forEach(card => {
        if (filter === 'all' || card.dataset.category === filter) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });

  /* ── Smooth active nav link highlight on scroll ── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  const highlightNav = () => {
    let current = '';
    sections.forEach(sec => {
      if (window.scrollY >= sec.offsetTop - 120) current = sec.id;
    });
    navLinks.forEach(link => {
      if (link.classList.contains('btn')) return; // never recolour button links
      link.style.color = link.getAttribute('href') === '#' + current
        ? 'var(--primary)'
        : '';
    });
  };
  window.addEventListener('scroll', highlightNav, { passive: true });
  highlightNav();

});
