/* How it works: the sticky retina follows whichever step is in view. */
(function () {
  'use strict';

  const frame = document.getElementById('storyRetina');
  const steps = Array.from(document.querySelectorAll('.story-step'));
  const numEl = document.getElementById('stageNum');
  const nameEl = document.getElementById('stageName');
  const dots = Array.from(document.querySelectorAll('#storyProgress li'));
  if (!frame || !window.DRishtiRetina || !steps.length) return;

  const retina = window.DRishtiRetina.mount(frame, { seed: 11, labels: false });

  function activate(index) {
    const step = steps[index];
    retina.setStage(step.dataset.stage);
    steps.forEach((s, i) => s.classList.toggle('active', i === index));
    dots.forEach((d, i) => {
      d.classList.toggle('done', i < index);
      d.classList.toggle('on', i === index);
    });
    numEl.textContent = String(index + 1).padStart(2, '0');
    nameEl.textContent = step.dataset.name;
  }

  activate(0);

  if (!('IntersectionObserver' in window)) return;

  // A step becomes current when it crosses the middle band of the viewport.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) activate(steps.indexOf(entry.target));
    });
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

  steps.forEach((s) => io.observe(s));
})();
