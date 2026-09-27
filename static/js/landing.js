/* Landing page: run the hero retina scan once, then reveal the result card. */
(function () {
  'use strict';

  const stage = document.getElementById('heroRetina');
  const card = document.getElementById('resultCard');
  if (!stage || !window.DRishtiRetina) return;

  const retina = window.DRishtiRetina.mount(stage, { seed: 11, labels: true });
  const reduce = window.DRishtiMotion && window.DRishtiMotion.reduceMotion;

  // Markers arrive 420 ms apart (see retina.css); the card follows the last.
  const markerTrail = reduce ? 0 : retina.markerCount * 420 + 300;

  retina.play().then(() => {
    setTimeout(() => card && card.classList.add('show'), markerTrail);
  });
})();
