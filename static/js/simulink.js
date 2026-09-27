/* DRishti - Simulink capacity model page.

   Every scenario runs for real in MATLAB (POST /api/simulate): the
   discrete-event simulation for utilisation and waits, and the Simulink flow
   model for the daily burst-and-drain shape. Nothing here is precomputed. */
(function () {
  'use strict';

  const DEFAULTS = {
    annualPatients: 100000, sites: 8, workers: 2, procMeanSec: 11,
    graderFTE: 2, ophthFTE: 1, uplinkMbps: 4, pReferable: 0.07, pDisagree: 0.22,
  };
  const PRESETS = {
    baseline: {},
    growth: { annualPatients: 150000 },
    minimum: { sites: 10, workers: 1, graderFTE: 1 },
    slow: { workers: 1, procMeanSec: 40 },
  };
  const STAGES = [
    { key: 'Acquire', util: 'technician', name: 'Capture', color: '#4f8c6d', unit: 'patients' },
    { key: 'Uplink', util: 'uplink', name: 'Uplink', color: '#5b9fd0', unit: 'images' },
    { key: 'Compute', util: 'compute', name: 'Compute', color: '#6f7f8a', unit: 'images' },
    { key: 'Review', util: 'grader', name: 'Review', color: '#e6a53a', unit: 'cases' },
    { key: 'Referral', util: 'ophthalmologist', name: 'Referral', color: '#d9644a', unit: 'patients' },
  ];
  const DEBOUNCE_MS = 600;
  const COLD_START_HINT_MS = 2500;

  const $ = (id) => document.getElementById(id);
  const form = $('simForm');
  const sliders = Array.from(document.querySelectorAll('.slider'));
  const nf = (v, d = 0) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  let debounceTimer = null;
  let inFlight = null;
  let lastResult = null;
  let daySeries = 'flow';

  /* ============================================================ sliders */

  function stepsOf(el) {
    return el.dataset.steps ? el.dataset.steps.split(',').map(Number) : null;
  }

  function format(fmt, v) {
    switch (fmt) {
      case 'int': return nf(v);
      case 'sec': return `${v} s`;
      case 'fte': return String(Number(v));
      case 'mbps': return `${v} Mbps`;
      case 'pct': return `${Math.round(v * 100)}%`;
      default: return String(v);
    }
  }

  function readSlider(el) {
    const input = el.querySelector('input');
    const steps = stepsOf(el);
    return steps ? steps[Number(input.value)] : Number(input.value);
  }

  function writeSlider(el, value) {
    const input = el.querySelector('input');
    const steps = stepsOf(el);
    if (steps) {
      let best = 0;
      steps.forEach((s, i) => { if (Math.abs(s - value) < Math.abs(steps[best] - value)) best = i; });
      input.value = best;
    } else {
      input.value = value;
    }
    paint(el);
  }

  function paint(el) {
    const input = el.querySelector('input');
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
    el.querySelector('output').textContent = format(el.dataset.fmt, readSlider(el));
  }

  function params() {
    const out = {};
    sliders.forEach((el) => { out[el.dataset.key] = readSlider(el); });
    return out;
  }

  function applyPreset(name) {
    const values = Object.assign({}, DEFAULTS, PRESETS[name] || {});
    sliders.forEach((el) => writeSlider(el, values[el.dataset.key]));
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
  }

  sliders.forEach((el) => {
    el.querySelector('input').addEventListener('input', () => {
      paint(el);
      document.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
      schedule();
    });
  });

  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => { applyPreset(btn.dataset.preset); run(); });
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, DEBOUNCE_MS);
  }

  /* ================================================================ run */

  // GitHub Pages build: no server, so run the JavaScript ports of the models.
  function runInBrowser() {
    setBusy(true);
    // Let the busy state paint before the ~0.2 s simulation blocks the thread.
    setTimeout(() => {
      try {
        const data = window.DRishtiCapacity.runScenario(params());
        lastResult = data;
        render(data);
        $('simError').classList.add('hidden');
      } catch (err) {
        $('simError').textContent = err.message;
        $('simError').classList.remove('hidden');
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  async function run() {
    clearTimeout(debounceTimer);
    if (window.DRISHTI_STATIC && window.DRishtiCapacity) {
      runInBrowser();
      return;
    }
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;

    setBusy(true);
    const coldHint = setTimeout(() => {
      $('busyText').textContent = 'Starting MATLAB. The first run takes about 20 seconds.';
    }, COLD_START_HINT_MS);

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params()),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'The simulation did not complete.');
      lastResult = data;
      render(data);
      $('simError').classList.add('hidden');
    } catch (err) {
      if (err.name === 'AbortError') return;
      $('simError').textContent = err.message;
      $('simError').classList.remove('hidden');
      setEngine('error', 'MATLAB is not responding. Is the server running?');
    } finally {
      clearTimeout(coldHint);
      if (inFlight === controller) {
        inFlight = null;
        setBusy(false);
      }
    }
  }

  function setBusy(on) {
    $('busy').hidden = !on;
    $('results').classList.toggle('is-busy', on);
    $('runBtn').disabled = on;
    if (on) $('busyText').textContent = 'Simulating 250 working days…';
  }

  function setEngine(kind, text) {
    const badge = $('engineBadge');
    badge.dataset.engine = kind;
    $('engineText').textContent = text;
  }

  /* ============================================================= render */

  function level(pct) {
    if (pct >= 100) return 'over';
    if (pct >= 85) return 'tight';
    if (pct >= 70) return 'watch';
    return 'ok';
  }

  function render(r) {
    const engineLabel = {
      simulink: 'Flow model simulated in Simulink',
      browser: 'Running in your browser: JavaScript ports of the MATLAB models',
    }[r.engine] || 'Simulink block diagram solved in base MATLAB (Simulink not installed on this machine)';
    const secs = (r.timing.desSec + r.timing.flowSec).toFixed(2);
    setEngine(r.engine, `${engineLabel} · both models ran in ${secs} s`);

    renderVerdict(r);
    renderDiagram(r);
    renderBars(r);
    renderKpis(r);
    renderDayChart(r);
    renderYearChart(r);
    renderValidation(r);
  }

  function renderVerdict(r) {
    const b = r.bottleneck;
    const pct = b.pct;
    const lv = level(pct);
    const box = $('verdict');
    box.dataset.level = lv;
    $('verdictTitle').textContent = `${b.label} · ${nf(pct, 1)}% ${b.basis}`;
    const text = {
      over: `${b.label} is over capacity. Its queue grows all year and never drains, so add capacity here before anything else.`,
      tight: `${b.label} is above the 85% planning limit. Busy days will produce long waits; this is the next resource to grow.`,
      watch: `${b.label} is the busiest resource but still inside planning limits. Everything else has headroom.`,
      ok: 'Every resource is below 70%. This programme has room to grow.',
    }[lv];
    $('verdictText').textContent = text;
  }

  /* ---------------------------------------------------------- diagram */

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  function renderDiagram(r) {
    const svg = $('diagram');
    svg.textContent = '';
    const util = Object.fromEntries(r.utilisation.map((u) => [u.key, u.pct]));
    const w = 142;
    const h = 120;
    const gap = (900 - 20 - 5 * w) / 4;
    const y = 34;

    STAGES.forEach((s, i) => {
      const x = 10 + i * (w + gap);
      if (i < STAGES.length - 1) {
        const x1 = x + w;
        const x2 = x + w + gap;
        svgEl('line', { x1, y1: y + h / 2, x2: x2 - 6, y2: y + h / 2, class: 'd-link' }, svg);
        svgEl('line', { x1, y1: y + h / 2, x2: x2 - 6, y2: y + h / 2, class: 'd-flow' }, svg);
        svgEl('path', { d: `M${x2 - 10},${y + h / 2 - 6} L${x2 - 1},${y + h / 2} L${x2 - 10},${y + h / 2 + 6}`, class: 'd-arrow' }, svg);
      }

      const pct = util[s.util] || 0;
      const g = svgEl('g', { class: `d-node lv-${level(pct)}`, style: `--i:${i}` }, svg);
      svgEl('rect', { x, y, width: w, height: h, rx: 14, class: 'd-box' }, g);

      const clipId = `clip-${i}`;
      const cp = svgEl('clipPath', { id: clipId }, g);
      svgEl('rect', { x, y, width: w, height: h, rx: 14 }, cp);
      const fillH = Math.min(1, pct / 100) * h;
      const fill = svgEl('rect', { x, y: y + h, width: w, height: 0, class: 'd-fill', 'clip-path': `url(#${clipId})` }, g);
      requestAnimationFrame(() => {
        fill.setAttribute('y', y + h - fillH);
        fill.setAttribute('height', fillH);
      });

      svgEl('text', { x: x + w / 2, y: y + 30, class: 'd-name' }, g).textContent = s.name;
      svgEl('text', { x: x + w / 2, y: y + 70, class: 'd-pct' }, g).textContent = `${nf(pct, 1)}%`;
      const total = r.flow.total[i];
      svgEl('text', { x: x + w / 2, y: y + 98, class: 'd-sub' }, g).textContent = `${compact(total)} ${s.unit}/yr`;

      svgEl('text', { x: x + w / 2, y: y - 14, class: 'd-block' }, g).textContent = '∫ backlog';
    });
  }

  function compact(v) {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`;
    if (v > 0 && v < 10) return String(Number(v.toFixed(2)));
    return nf(v);
  }

  /* ------------------------------------------------------------- bars */

  function renderBars(r) {
    const host = $('bars');
    host.textContent = '';
    const scaleMax = Math.max(120, ...r.utilisation.map((u) => u.pct));
    r.utilisation.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = `bar-row lv-${level(u.pct)}`;
      const width = (Math.min(u.pct, scaleMax) / scaleMax) * 100;
      row.innerHTML = `
        <span class="bar-label">${u.label}<small>${u.basis}</small></span>
        <span class="bar-track">
          <span class="bar-fill" style="--w:${width}%;--d:${i * 70}ms"></span>
          <span class="bar-mark" style="left:${(85 / scaleMax) * 100}%"></span>
          <span class="bar-mark red" style="left:${(100 / scaleMax) * 100}%"></span>
        </span>
        <span class="bar-val num">${nf(u.pct, 1)}%</span>`;
      host.appendChild(row);
    });
    requestAnimationFrame(() => host.querySelectorAll('.bar-fill').forEach((b) => b.classList.add('in')));
  }

  /* ------------------------------------------------------------- KPIs */

  function hoursText(h) {
    if (h < 1) return `${nf(h * 60, 1)} min`;
    if (h < 48) return `${nf(h, 1)} h`;
    return `${nf(h / 24, 1)} days`;
  }

  function renderKpis(r) {
    const d = r.des;
    const items = [
      ['Patients screened', nf(d.patientsScreened), `of ${nf(r.params.annualPatients)} target`],
      ['Could not be seated', `${nf(d.unmetDemandPct, 1)}%`, 'of demand in a session'],
      ['Result before leaving camp', `${nf(d.sameSessionPct, 1)}%`, 'automated result within 30 min'],
      ['Full report, 95th pct', hoursText(d.turnaroundP95H), 'including human review'],
      ['Specialist wait, 95th pct', `${nf(d.referralP95WaitDays, 0)} days`, `${nf(d.referableCases)} referrals a year`],
      ['Image data per year', `${nf(d.gbPerYear, 0)} GB`, `${nf(d.imagesUploaded)} images`],
    ];
    $('kpis').innerHTML = items.map(([k, v, s], i) => `
      <div class="kpi" style="--d:${i * 60}ms">
        <span class="kpi-k">${k}</span>
        <span class="kpi-v num">${v}</span>
        <span class="kpi-s">${s}</span>
      </div>`).join('');
  }

  /* ----------------------------------------------------------- charts */

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * p;
  }

  function lineChart(svg, opts) {
    svg.textContent = '';
    const vb = svg.viewBox.baseVal;
    const W = vb.width;
    const H = vb.height;
    const pad = { l: 58, r: 14, t: 14, b: 34 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const xs = opts.xs;
    const xMax = xs[xs.length - 1] || 1;
    const allY = opts.series.flatMap((s) => s.values);
    const yMax = niceMax(Math.max(0, ...allY));
    const X = (x) => pad.l + (x / xMax) * iw;
    const Y = (y) => pad.t + ih - (y / yMax) * ih;

    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      svgEl('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'c-grid' }, svg);
      svgEl('text', { x: pad.l - 8, y: Y(v) + 4, class: 'c-ytick' }, svg).textContent = compact(v);
    }
    opts.xTicks.forEach((t, i) => {
      svgEl('line', { x1: X(t.x), x2: X(t.x), y1: pad.t, y2: pad.t + ih, class: 'c-vgrid' }, svg);
      // Pin the outer labels inside the plot so they are never clipped.
      const anchor = i === 0 ? 'start' : i === opts.xTicks.length - 1 ? 'end' : 'middle';
      svgEl('text', { x: X(t.x), y: H - 10, class: 'c-xtick', 'text-anchor': anchor }, svg).textContent = t.label;
    });
    if (opts.bands) {
      opts.bands.forEach((b) => svgEl('rect', { x: X(b[0]), y: pad.t, width: X(b[1]) - X(b[0]), height: ih, class: 'c-band' }, svg));
    }

    opts.series.forEach((s, si) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      if (s.area) {
        svgEl('path', { d: `${d}L${X(xs[xs.length - 1])},${Y(0)}L${X(xs[0])},${Y(0)}Z`, fill: s.color, class: 'c-area' }, svg);
      }
      const path = svgEl('path', { d, stroke: s.color, class: 'c-line', style: `--d:${si * 90}ms` }, svg);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      requestAnimationFrame(() => path.classList.add('in'));
    });

    if (opts.emptyText && Math.max(0, ...allY) === 0) {
      svgEl('text', { x: pad.l + iw / 2, y: pad.t + ih / 2 - 6, class: 'c-empty' }, svg).textContent = opts.emptyText;
    }
  }

  function column(matrix, c) {
    return matrix.map((row) => (Array.isArray(row) ? row[c] : row));
  }

  function renderDayChart(r) {
    const w = r.flow.window;
    const matrix = daySeries === 'flow' ? w.flow : w.backlog;
    const session = r.params.sessionHours;
    lineChart($('dayChart'), {
      xs: w.hours,
      series: STAGES.map((s, i) => ({ values: column(matrix, i), color: s.color })),
      xTicks: [0, 12, 24, 36, 48, 60, 72].map((h) => ({ x: h, label: h % 24 === 0 ? `day ${h / 24 + 1}` : `+${h % 24} h` })),
      bands: [[0, session], [24, 24 + session], [48, 48 + session]],
      emptyText: daySeries === 'backlog' ? 'No backlog: every stage keeps up with its arrivals' : '',
    });
    $('dayLegend').innerHTML = STAGES.map((s) =>
      `<li><span style="background:${s.color}"></span>${s.name} <small>${s.unit}/h</small></li>`).join('')
      + '<li class="band-key"><span></span>Session hours</li>';
  }

  function renderYearChart(r) {
    const d = r.flow.daily;
    const days = d.day;
    lineChart($('yearChart'), {
      xs: days,
      series: [
        { values: column(d.backlog, 4), color: '#d9644a', area: true },
        { values: column(d.backlog, 3), color: '#e6a53a' },
      ],
      xTicks: [1, 50, 100, 150, 200, 250].filter((t) => t <= days[days.length - 1])
        .map((t) => ({ x: t, label: `day ${t}` })),
      emptyText: 'The clinic clears its list every day',
    });
  }

  function renderValidation(r) {
    $('valBody').innerHTML = r.validation.map((v) => {
      const diff = Number(v.diffPct);
      const cls = Math.abs(diff) <= 5 ? 'good' : 'warn';
      return `<tr><th scope="row">${v.quantity}</th><td class="num">${nf(v.flow)}</td>
              <td class="num">${nf(v.des)}</td><td class="num ${cls}">${diff > 0 ? '+' : ''}${nf(diff, 1)}%</td></tr>`;
    }).join('');
  }

  document.querySelectorAll('.toggle button').forEach((b) => {
    b.addEventListener('click', () => {
      daySeries = b.dataset.series;
      document.querySelectorAll('.toggle button').forEach((x) => x.classList.toggle('on', x === b));
      if (lastResult) renderDayChart(lastResult);
    });
  });

  /* ============================================================== start */
  // /simulink?preset=growth opens straight into a named scenario (demo links).
  const requested = new URLSearchParams(window.location.search).get('preset');
  applyPreset(Object.prototype.hasOwnProperty.call(PRESETS, requested) ? requested : 'baseline');
  run();
})();
