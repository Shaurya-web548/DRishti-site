/* DRishti - procedural animated retina.

   Builds a fundus illustration as SVG: field of view, optic disc, macula,
   paired artery/vein arcades that curve around the fovea, and the three
   lesion types the pipeline looks for. Vessel geometry comes from a seeded
   random walk, so the same seed always draws the same eye.

   DRishtiRetina.mount(container, options) -> controller
     options.seed     number, which eye to draw (default 11)
     options.labels   true to draw callout labels with leader lines
     controller.play()          run the hero sequence once
     controller.setStage(name)  capture | quality | segment | grade | consensus | report
*/
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C = { x: 200, y: 200, r: 176 };          // field of view
  const DISC = { x: 290, y: 190, r: 24 };
  const MACULA = { x: 168, y: 206 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  }

  /* ------------------------------------------------------ vessel geometry */

  // Random walk that bends by `curl` each step and is pushed away from the
  // macula, which is what makes the arcades wrap around the fovea.
  function walk(rand, start, angleDeg, opts) {
    const pts = [[start[0], start[1]]];
    let x = start[0];
    let y = start[1];
    let a = (angleDeg * Math.PI) / 180;
    for (let i = 0; i < opts.steps; i++) {
      a += ((rand() - 0.5) * opts.jitter + opts.curl) * (Math.PI / 180);
      const dx = x - MACULA.x;
      const dy = y - MACULA.y;
      const dm = Math.hypot(dx, dy);
      if (dm < 58) {
        const away = Math.atan2(dy, dx);
        a += Math.sin(away - a) * 0.35;
      }
      x += Math.cos(a) * opts.step;
      y += Math.sin(a) * opts.step;
      if (Math.hypot(x - C.x, y - C.y) > C.r - 4) break;
      pts.push([x, y]);
    }
    return { pts, endAngle: (a * 180) / Math.PI };
  }

  // Catmull-Rom through the points, emitted as cubic Beziers.
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function buildVessels(rand) {
    const vessels = [];      // { d, width, gen }
    const trunks = [
      { angle: -128, curl: -3.1 },   // superior temporal arcade
      { angle: 132, curl: 3.1 },     // inferior temporal arcade
      { angle: -52, curl: -0.6 },    // superior nasal
      { angle: 48, curl: 0.6 },      // inferior nasal
    ];

    trunks.forEach((t, ti) => {
      const temporal = ti < 2;
      const main = walk(rand, [DISC.x, DISC.y], t.angle, {
        steps: temporal ? 30 : 14, step: temporal ? 8 : 7.5, jitter: 7, curl: t.curl,
      });
      vessels.push({ d: smoothPath(main.pts), width: 3.6, gen: 0 });

      // Branches spawn along the trunk and head away from the macula.
      const every = temporal ? 5 : 6;
      for (let i = every; i < main.pts.length - 2; i += every) {
        const p = main.pts[i];
        const q = main.pts[i + 1];
        const trunkAngle = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
        const side = Math.atan2(p[1] - MACULA.y, p[0] - MACULA.x) * 180 / Math.PI;
        const turn = ((side - trunkAngle + 540) % 360) - 180 > 0 ? 38 : -38;
        const br = walk(rand, p, trunkAngle + turn + (rand() - 0.5) * 16, {
          steps: 7 + Math.floor(rand() * 8), step: 6, jitter: 16, curl: 0,
        });
        vessels.push({ d: smoothPath(br.pts), width: 2.1, gen: 1 });

        if (br.pts.length > 5 && rand() > 0.35) {
          const m = br.pts[Math.floor(br.pts.length / 2)];
          const tw = walk(rand, m, br.endAngle + (rand() > 0.5 ? 42 : -42), {
            steps: 4 + Math.floor(rand() * 5), step: 5, jitter: 22, curl: 0,
          });
          vessels.push({ d: smoothPath(tw.pts), width: 1.2, gen: 2 });
        }
      }
    });
    return vessels;
  }

  /* -------------------------------------------------------------- lesions */

  function buildLesions(rand) {
    const inRing = (cx, cy, r0, r1) => {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const ma = Array.from({ length: 11 }, () => inRing(MACULA.x + 6, MACULA.y - 4, 26, 92));
    const ex = [
      ...Array.from({ length: 6 }, () => inRing(214, 258, 0, 16)),
      ...Array.from({ length: 4 }, () => inRing(128, 150, 0, 11)),
    ];
    const hem = [[112, 238], [236, 138], [96, 176]];
    return { ma, ex, hem };
  }

  /* --------------------------------------------------------------- mount */

  function mount(container, options) {
    const opts = Object.assign({ seed: 11, labels: false }, options || {});
    const rand = mulberry32(opts.seed);
    const uid = 'r' + Math.floor(rand() * 1e9).toString(36);
    const pad = opts.labels ? 112 : 12;

    const svg = el('svg', {
      viewBox: `${-pad} -8 ${400 + 2 * pad} 416`,
      class: 'retina',
      role: 'img',
      'aria-label': 'Animated fundus photograph being screened: the optic disc, fovea, blood vessels and lesions are detected in turn.',
    });

    const defs = el('defs', {}, svg);
    const fundus = el('radialGradient', { id: `${uid}-fundus`, cx: '46%', cy: '50%', r: '56%' }, defs);
    [['0%', '#df7442'], ['38%', '#c04b22'], ['74%', '#882a12'], ['100%', '#3b1006']]
      .forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, fundus));
    const disc = el('radialGradient', { id: `${uid}-disc`, cx: '45%', cy: '45%', r: '60%' }, defs);
    [['0%', '#fff6d6'], ['55%', '#f3d487'], ['100%', '#d8964c']]
      .forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, disc));
    const mac = el('radialGradient', { id: `${uid}-mac` }, defs);
    el('stop', { offset: '0%', 'stop-color': '#3e0b05', 'stop-opacity': '0.55' }, mac);
    el('stop', { offset: '100%', 'stop-color': '#3e0b05', 'stop-opacity': '0' }, mac);
    const sweepGrad = el('linearGradient', { id: `${uid}-sweep`, x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#cfe3d8', 'stop-opacity': '0' }, sweepGrad);
    el('stop', { offset: '100%', 'stop-color': '#cfe3d8', 'stop-opacity': '0.42' }, sweepGrad);
    const clip = el('clipPath', { id: `${uid}-fov` }, defs);
    el('circle', { cx: C.x, cy: C.y, r: C.r }, clip);

    // Base eye.
    const base = el('g', { class: 'r-base' }, svg);
    el('circle', { cx: C.x, cy: C.y, r: C.r + 14, class: 'r-bezel' }, base);
    el('circle', { cx: C.x, cy: C.y, r: C.r, fill: `url(#${uid}-fundus)` }, base);
    el('circle', { cx: MACULA.x, cy: MACULA.y, r: 50, fill: `url(#${uid}-mac)` }, base);
    el('circle', { cx: MACULA.x, cy: MACULA.y, r: 6, fill: '#4d1007', opacity: '0.7' }, base);

    // Vessels: veins darker and wider, arteries lighter and slightly offset.
    const vessels = buildVessels(rand);
    const vesselLayer = el('g', { class: 'r-vessels', 'clip-path': `url(#${uid}-fov)` }, svg);
    const segLayer = el('g', { class: 'r-seg', 'clip-path': `url(#${uid}-fov)` }, svg);
    vessels.forEach((v, i) => {
      el('path', {
        d: v.d, class: `vessel vein g${v.gen}`, 'stroke-width': v.width, style: `--i:${i}`,
      }, vesselLayer);
      el('path', {
        d: v.d, class: `vessel artery g${v.gen}`, 'stroke-width': Math.max(0.8, v.width * 0.62),
        transform: 'translate(2.4 -1.6)', style: `--i:${i}`,
      }, vesselLayer);
      el('path', { d: v.d, class: `vessel seg g${v.gen}`, 'stroke-width': v.width * 0.9, style: `--i:${i}` }, segLayer);
    });

    el('circle', { cx: DISC.x, cy: DISC.y, r: DISC.r, fill: `url(#${uid}-disc)`, class: 'r-disc' }, svg);

    // Lesions.
    const lesions = buildLesions(rand);
    const lesionLayer = el('g', { class: 'r-lesions', 'clip-path': `url(#${uid}-fov)` }, svg);
    lesions.ma.forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 2.3, class: 'lesion ma' }, lesionLayer));
    lesions.ex.forEach(([x, y]) => el('ellipse', {
      cx: x, cy: y, rx: 2.4 + rand() * 2.2, ry: 1.6 + rand() * 1.4,
      transform: `rotate(${Math.floor(rand() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})`, class: 'lesion ex',
    }, lesionLayer));
    lesions.hem.forEach(([x, y]) => el('ellipse', {
      cx: x, cy: y, rx: 6 + rand() * 3, ry: 4.5 + rand() * 2.5, class: 'lesion hem',
    }, lesionLayer));

    // Scan sweep and field-of-view ring.
    const sweep = el('g', { class: 'r-sweep', 'clip-path': `url(#${uid}-fov)` }, svg);
    const sweepArm = el('g', { class: 'r-sweep-arm' }, sweep);
    const wedge = 0.55;
    el('path', {
      d: `M${C.x},${C.y} L${C.x + C.r},${C.y} A${C.r},${C.r} 0 0 0 ${C.x + C.r * Math.cos(wedge)},${C.y - C.r * Math.sin(wedge)} Z`,
      fill: `url(#${uid}-sweep)`,
      transform: `rotate(${(wedge * 180) / Math.PI} ${C.x} ${C.y})`,
    }, sweepArm);
    el('line', { x1: C.x, y1: C.y, x2: C.x + C.r, y2: C.y, class: 'r-sweep-line' }, sweepArm);
    el('circle', { cx: C.x, cy: C.y, r: C.r + 5, class: 'r-fov-ring' }, svg);

    // Detection markers, in the order the hero reveals them.
    const markers = [
      { key: 'disc', x: DISC.x, y: DISC.y, r: DISC.r + 8, label: 'Optic disc', side: 'right' },
      { key: 'fovea', x: MACULA.x, y: MACULA.y, r: 20, label: 'Fovea', side: 'left' },
      { key: 'ma', x: 150, y: 170, r: 30, label: 'Microaneurysms', side: 'left', lesion: true },
      { key: 'ex', x: 214, y: 258, r: 24, label: 'Hard exudates', side: 'right', lesion: true },
      { key: 'hem', x: 112, y: 238, r: 15, label: 'Haemorrhage', side: 'left', lesion: true },
    ];
    const markerLayer = el('g', { class: 'r-markers' }, svg);
    const labelRows = { left: 0, right: 0 };
    markers.forEach((m, i) => {
      const g = el('g', { class: `marker m-${m.key}${m.lesion ? ' is-lesion' : ''}`, style: `--m:${i}` }, markerLayer);
      el('circle', { cx: m.x, cy: m.y, r: m.r, class: 'marker-ring' }, g);
      el('circle', { cx: m.x, cy: m.y, r: m.r, class: 'marker-pulse' }, g);
      if (opts.labels) {
        const row = labelRows[m.side]++;
        const ly = m.side === 'left' ? 96 + row * 104 : 120 + row * 150;
        const lx = m.side === 'left' ? -pad + 4 : 400 + pad - 4;
        const edgeX = m.side === 'left' ? m.x - m.r : m.x + m.r;
        // Leader: marker edge -> just outside the bezel -> under the label.
        el('path', { d: `M${edgeX},${m.y} L${m.side === 'left' ? 14 : 386},${ly} L${lx},${ly}`, class: 'leader' }, g);
        const t = el('text', { x: lx, y: ly - 7, class: 'marker-label', 'text-anchor': m.side === 'left' ? 'start' : 'end' }, g);
        t.textContent = m.label;
      }
    });

    container.appendChild(svg);

    // Vessel drawing uses the real path length for the dash trick.
    svg.querySelectorAll('.vessel').forEach((p) => {
      const len = Math.ceil(p.getTotalLength());
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    });

    const reduce = window.DRishtiMotion && window.DRishtiMotion.reduceMotion;

    function setStage(name) {
      svg.dataset.stage = name;
    }

    function play() {
      if (reduce) {
        svg.classList.add('drawn', 'scanning', 'found');
        return Promise.resolve();
      }
      requestAnimationFrame(() => svg.classList.add('drawn'));
      return new Promise((resolve) => {
        setTimeout(() => svg.classList.add('scanning'), 1500);
        setTimeout(() => { svg.classList.add('found'); resolve(); }, 2300);
      });
    }

    return { svg, setStage, play, markerCount: markers.length };
  }

  window.DRishtiRetina = { mount };
})();
