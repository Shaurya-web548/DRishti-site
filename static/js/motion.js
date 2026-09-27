/* DRishti - shared page behaviour: mobile menu, scroll reveals, counters.
   No dependencies. Everything degrades to the finished state when the
   visitor prefers reduced motion or IntersectionObserver is missing. */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------ mobile menu */
  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }

  /* ---------------------------------------------------------- counters */
  function formatNumber(value, decimals) {
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    if (Number.isNaN(target)) return;

    if (reduceMotion) {
      el.textContent = formatNumber(target, decimals) + suffix;
      return;
    }
    const duration = parseInt(el.dataset.duration || '1600', 10);
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatNumber(target * eased, decimals) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------- reveals */
  const revealables = document.querySelectorAll('.reveal, .reveal-scale, .draw-on-scroll, [data-count]');

  function show(el) {
    el.classList.add('in');
    if (el.dataset.count && !el.dataset.counted) {
      el.dataset.counted = '1';
      runCounter(el);
    }
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(show);
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          show(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    revealables.forEach((el) => io.observe(el));
  }

  window.DRishtiMotion = { reduceMotion, runCounter, formatNumber };
})();
