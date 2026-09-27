/* DRishti - capacity models in the browser.

   Used by the GitHub Pages build of the Simulink page, where there is no
   MATLAB. Produces the same result object as POST /api/simulate
   (capacity-model/drishtiRunScenario.m), from two ports:

   - the discrete-event simulation from docs/simulator.html, itself a port of
     capacity-model/drishtiCapacityDES.m that matches it to about 1%
     (different random-number generator, same model);
   - the Simulink flow model: drishtiFlowRates.m, drishtiFlowModel.m and
     drishtiSummariseFlow.m, ported line for line. It is deterministic, so it
     reproduces MATLAB's annual totals.
*/
(function () {
  "use strict";

  const BASE = {
    annualPatients:100000, workingDays:250, sites:8, sessionHours:6, sessionStartH:9,
    captureMin:4.0, retryMin:1.5, maxRetries:2,
    pDifficultPatient:0.08, pRejectNormal:0.06, pRejectDifficult:0.70, pEnhanced:0.25,
    imageMB:3.5, uplinkIdx:4,
    workers:2, procMeanSec:11, procCV:0.35, enhanceExtraSec:0.4,
    pDisagree:0.22, qaSampleRate:0.10, reviewMin:2.5, qaMin:1.5,
    graderFTE:2, graderHoursPerDay:8, graderStartH:9,
    pReferable:0.07, ophthFTE:1, ophthHoursPerDay:6, ophthMinPerCase:10,
    sameSessionMin:30, slaHours:24, seed:42
  };

  /* ---------------- deterministic RNG ---------------- */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const expRnd = (mu, r) => -mu * Math.log(1 - r());
  function lognRnd(mean, cv, r){
    const s = Math.sqrt(Math.log(1 + cv*cv));
    const mu = Math.log(mean) - 0.5*s*s;
    let u = 1 - r(), v = 1 - r();
    const z = Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
    return Math.exp(mu + s*z);
  }
  function poisson(lambda, r){
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    const cap = 20*lambda + 100;
    for(;;){ p *= r(); if (p <= L) break; k++; if (k > cap) break; }
    return k;
  }
  function pctl(sorted, q){
    const n = sorted.length;
    if (!n) return NaN;
    if (n === 1) return sorted[0];
    const pos = (q/100)*(n-1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (pos-lo)*(sorted[hi]-sorted[lo]);
  }
  function nextWorkTime(t, startH, endH){
    const d = Math.floor(t/24), h = t - 24*d;
    if (h < startH) return 24*d + startH;
    if (h >= endH)  return 24*(d+1) + startH;
    return t;
  }
  function serveInShift(tStart, durH, startH, endH){
    let t = nextWorkTime(tStart, startH, endH), rem = durH, guard = 0;
    while (rem > 1e-12){
      if (++guard > 100000) break;
      const d = Math.floor(t/24), h = t - 24*d, avail = endH - h;
      if (rem <= avail){ t += rem; rem = 0; }
      else { rem -= avail; t = 24*(d+1) + startH; }
    }
    return t;
  }

  /* ---------------- the simulation ---------------- */
  function simulate(p){
    const rnd = mulberry32(p.seed);
    const DAY = 24;
    const perSiteDay = p.annualPatients / (p.workingDays * p.sites);
    const maxPat = Math.ceil(p.workingDays * p.sites * perSiteDay) + p.sites*p.workingDays + 64;
    const maxImg = 2*maxPat;

    const patCapEnd = new Float64Array(maxPat);
    const patUngrad = new Uint8Array(maxPat);
    const imgPat    = new Int32Array(maxImg);
    const imgSite   = new Int32Array(maxImg);
    const imgReady  = new Float64Array(maxImg);
    const imgEnh    = new Uint8Array(maxImg);
    let nPat = 0, nImg = 0, turnedAway = 0;
    const techBusy = new Float64Array(p.sites);
    const uploadSec = (p.imageMB*8)/p.uplinkMbps;

    /* --- acquisition + edge quality gate --- */
    for (let d = 0; d < p.workingDays; d++){
      const dayStart = d*DAY + p.sessionStartH;
      const dayEnd   = dayStart + p.sessionHours;
      for (let s = 0; s < p.sites; s++){
        const nToday = poisson(perSiteDay, rnd);
        if (!nToday) continue;
        const arr = new Float64Array(nToday);
        for (let i = 0; i < nToday; i++) arr[i] = dayStart + p.sessionHours*rnd();
        arr.sort();
        let techFree = dayStart;
        for (let k = 0; k < nToday; k++){
          const tStart = Math.max(arr[k], techFree);
          if (tStart >= dayEnd){ turnedAway += nToday - k; break; }
          const pRej = rnd() < p.pDifficultPatient ? p.pRejectDifficult : p.pRejectNormal;
          let capMin = expRnd(p.captureMin, rnd);
          let gradable = 0;
          const enh = [false,false];
          for (let eye = 0; eye < 2; eye++){
            let accepted = false;
            for (let a = 0; a <= p.maxRetries; a++){
              if (rnd() >= pRej){ accepted = true; break; }
              capMin += expRnd(p.retryMin, rnd);
            }
            if (accepted){ enh[gradable] = rnd() < p.pEnhanced; gradable++; }
          }
          const tEnd = tStart + capMin/60;
          techFree = tEnd;
          techBusy[s] += capMin;
          patCapEnd[nPat] = tEnd;
          patUngrad[nPat] = gradable === 0 ? 1 : 0;
          for (let j = 0; j < gradable; j++){
            imgPat[nImg]=nPat; imgSite[nImg]=s; imgReady[nImg]=tEnd;
            imgEnh[nImg]= enh[j]?1:0; nImg++;
          }
          nPat++;
        }
      }
    }

    /* --- uplink: one store-and-forward server per site --- */
    const imgUpEnd = new Float64Array(nImg);
    const upWait   = new Float64Array(nImg);
    const bySite = [];
    for (let s = 0; s < p.sites; s++) bySite.push([]);
    for (let i = 0; i < nImg; i++) bySite[imgSite[i]].push(i);
    for (let s = 0; s < p.sites; s++){
      const idx = bySite[s];
      idx.sort((a,b) => imgReady[a]-imgReady[b]);
      let free = 0;
      for (const i of idx){
        const st = Math.max(imgReady[i], free);
        const en = st + uploadSec/3600;
        imgUpEnd[i] = en; free = en;
        upWait[i] = (st - imgReady[i])*60;
      }
    }

    /* --- central compute: W serialised workers --- */
    const procSec = new Float64Array(nImg);
    for (let i = 0; i < nImg; i++){
      procSec[i] = lognRnd(p.procMeanSec, p.procCV, rnd) + (imgEnh[i] ? p.enhanceExtraSec : 0);
    }
    const order = new Int32Array(nImg);
    for (let i = 0; i < nImg; i++) order[i] = i;
    const ord = Array.from(order).sort((a,b) => imgUpEnd[a]-imgUpEnd[b]);
    const workerFree = new Float64Array(p.workers);
    const imgProcEnd = new Float64Array(nImg);
    const procWait   = new Float64Array(nImg);
    let procBusyH = 0;
    for (const i of ord){
      let w = 0;
      for (let j = 1; j < p.workers; j++) if (workerFree[j] < workerFree[w]) w = j;
      const st = Math.max(imgUpEnd[i], workerFree[w]);
      const en = st + procSec[i]/3600;
      workerFree[w] = en; imgProcEnd[i] = en;
      procWait[i] = (st - imgUpEnd[i])*60;
      procBusyH += procSec[i]/3600;
    }

    /* --- automated decision --- */
    const patAuto = new Float64Array(nPat);
    for (let i = 0; i < nPat; i++) if (patUngrad[i]) patAuto[i] = patCapEnd[i];
    for (let i = 0; i < nImg; i++){
      const q = imgPat[i];
      if (imgProcEnd[i] > patAuto[q]) patAuto[q] = imgProcEnd[i];
    }

    const needsHuman = new Uint8Array(nPat);
    const revMin = new Float64Array(nPat);
    let screened = 0, nDisagree = 0, nQA = 0;
    for (let i = 0; i < nPat; i++){
      if (patUngrad[i]) continue;
      screened++;
      if (rnd() < p.pDisagree){ needsHuman[i]=1; nDisagree++; revMin[i]=expRnd(p.reviewMin,rnd); }
      else if (rnd() < p.qaSampleRate){ needsHuman[i]=1; nQA++; revMin[i]=expRnd(p.qaMin,rnd); }
    }

    /* --- human adjudication, shift-limited --- */
    const hIdx = [];
    for (let i = 0; i < nPat; i++) if (needsHuman[i]) hIdx.push(i);
    hIdx.sort((a,b) => patAuto[a]-patAuto[b]);
    const nG = Math.max(1, Math.round(p.graderFTE));
    const gFree = new Float64Array(nG);
    const patReport = Float64Array.from(patAuto);
    const gWait = [];
    let gBusyMin = 0;
    const wS = p.graderStartH, wE = p.graderStartH + p.graderHoursPerDay;
    for (const i of hIdx){
      let g = 0;
      for (let j = 1; j < nG; j++) if (gFree[j] < gFree[g]) g = j;
      let st = Math.max(patAuto[i], gFree[g]);
      st = nextWorkTime(st, wS, wE);
      const en = serveInShift(st, revMin[i]/60, wS, wE);
      gFree[g] = en; patReport[i] = en;
      gWait.push(st - patAuto[i]);
      gBusyMin += revMin[i];
    }

    /* --- specialist referral, fixed slots per day --- */
    const refIdx = [];
    for (let i = 0; i < nPat; i++) if (!patUngrad[i] && rnd() < p.pReferable) refIdx.push(i);
    refIdx.sort((a,b) => patReport[a]-patReport[b]);
    const slots = Math.floor(p.ophthFTE*p.ophthHoursPerDay*60/p.ophthMinPerCase);
    const apptWait = [];
    let cursor = 0, used = 0;
    for (const i of refIdx){
      const readyDay = Math.floor(patReport[i]/DAY) + 1;
      if (readyDay > cursor){ cursor = readyDay; used = 0; }
      while (used >= slots){ cursor++; used = 0; }
      used++;
      apptWait.push(cursor - readyDay);
    }

    /* --- metrics --- */
    const turn = [], auto = [];
    for (let i = 0; i < nPat; i++){
      if (patUngrad[i]) continue;
      turn.push(patReport[i] - patCapEnd[i]);
      auto.push((patAuto[i] - patCapEnd[i])*60);
    }
    const sortNum = a => Float64Array.from(a).sort();
    const sTurn = sortNum(turn), sAuto = sortNum(auto);
    const sUp = sortNum(upWait.subarray(0,nImg)), sProc = sortNum(procWait.subarray(0,nImg));
    const sG = sortNum(gWait), sA = sortNum(apptWait);

    const simH = p.workingDays*DAY;
    const sessH = p.workingDays*p.sessionHours;
    const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;

    return {
      target:p.annualPatients, presented:nPat, turnedAway,
      unmetPct: 100*turnedAway/Math.max(1,nPat+turnedAway),
      screened, ungradable:nPat-screened,
      images:nImg, gbYear:nImg*p.imageMB/1024,
      uploadSec,
      techUtil: 100*(techBusy.reduce((a,b)=>a+b,0)/p.sites)/(sessH*60),
      linkUtil: 100*(nImg/p.sites*uploadSec/3600)/sessH,
      cpuUtil24: 100*procBusyH/(p.workers*simH),
      cpuUtilSess: 100*procBusyH/(p.workers*sessH),
      graderUtil: 100*(gBusyMin/60)/(nG*p.graderHoursPerDay*p.workingDays),
      ophthUtil: 100*(refIdx.length/p.workingDays)/Math.max(1,slots),
      slots, refCases:refIdx.length,
      humanCases:hIdx.length, nDisagree, nQA,
      upMean:mean(upWait.subarray(0,nImg)), upP95:pctl(sUp,95),
      procMean:mean(procWait.subarray(0,nImg)), procP95:pctl(sProc,95),
      gMean:mean(gWait), gP95:pctl(sG,95),
      aMean:mean(apptWait), aP95:pctl(sA,95),
      autoMedian:pctl(sAuto,50), autoP95:pctl(sAuto,95),
      sameSession: 100*auto.filter(v => v <= p.sameSessionMin).length/Math.max(1,auto.length),
      turnMedian:pctl(sTurn,50), turnP95:pctl(sTurn,95),
      slaPct: 100*turn.filter(v => v <= p.slaHours).length/Math.max(1,turn.length)
    };
  }

  /* ======================================================= flow model */

  function meanAttempts(pRej, maxRetries) {
    let m = 0;
    for (let k = 1; k <= maxRetries; k++) m += Math.pow(pRej, k);
    return m;
  }

  function expectedRetries(p) {
    const f = p.pDifficultPatient;
    return 2 * ((1 - f) * meanAttempts(p.pRejectNormal, p.maxRetries) +
                f * meanAttempts(p.pRejectDifficult, p.maxRetries));
  }

  function residualRejectRate(p) {
    const n = p.maxRetries + 1;
    return (1 - p.pDifficultPatient) * Math.pow(p.pRejectNormal, n) +
           p.pDifficultPatient * Math.pow(p.pRejectDifficult, n);
  }

  // drishtiFlowRates.m
  function flowRates(p) {
    return {
      patPerSessionHour: p.annualPatients / (p.workingDays * p.sessionHours),
      captureCapPerH: p.sites * 60 / (p.captureMin + p.retryMin * expectedRetries(p)),
      imgPerPatient: 2 * (1 - residualRejectRate(p)),
      uplinkCapPerH: p.sites * (p.uplinkMbps * 3600) / (p.imageMB * 8),
      computeCapPerH: p.workers * 3600 / p.procMeanSec,
      reviewCapPerH: p.graderFTE * 60 / p.reviewMin,
      humanTouchRate: p.pDisagree + (1 - p.pDisagree) * p.qaSampleRate,
      referralCapPerH: p.ophthFTE * 60 / p.ophthMinPerCase,
    };
  }

  // drishtiFlowModel.m: sample-based pulse gates with zero phase, forward
  // Euler backlog integrators, stages chained within each step.
  function flowModel(p) {
    const r = flowRates(p);
    const dt = p.simStepH;
    const perDay = Math.round(24 / dt);
    const n = p.workingDays * perDay;
    const gate = (hours) => {
      const width = Math.max(1, Math.round(hours / dt));
      return (k) => ((k % perDay) < width ? 1 : 0);
    };
    const session = gate(p.sessionHours);
    const grader = gate(p.graderHoursPerDay);
    const ophth = gate(p.ophthHoursPerDay);

    const flow = new Array(n);
    const backlog = new Array(n);
    const cap = new Array(n);
    const state = [0, 0, 0, 0, 0];

    for (let k = 0; k < n; k++) {
      backlog[k] = state.slice();
      const c = [r.captureCapPerH * session(k), r.uplinkCapPerH, r.computeCapPerH,
                 r.reviewCapPerH * grader(k), r.referralCapPerH * ophth(k)];
      const f = [0, 0, 0, 0, 0];
      for (let s = 0; s < 5; s++) {
        let inflow;
        if (s === 0) inflow = r.patPerSessionHour * session(k);
        else if (s === 1) inflow = f[0] * r.imgPerPatient;
        else if (s === 2) inflow = f[1];
        else if (s === 3) inflow = f[2] / r.imgPerPatient * r.humanTouchRate;
        else inflow = f[3] * (p.pReferable / r.humanTouchRate);
        f[s] = Math.min(inflow + state[s] / dt, c[s]);
        state[s] = Math.max(0, state[s] + (inflow - f[s]) * dt);
      }
      flow[k] = f;
      cap[k] = c;
    }
    return { dt, flow, backlog, cap };
  }

  // drishtiSummariseFlow.m
  function summariseFlow(fm, p) {
    const dt = fm.dt;
    const perDay = Math.round(24 / dt);
    const nDays = Math.floor(fm.flow.length / perDay);
    const total = [0, 0, 0, 0, 0];
    const capTotal = [0, 0, 0, 0, 0];
    const maxBacklog = [0, 0, 0, 0, 0];
    for (let k = 0; k < fm.flow.length; k++) {
      for (let s = 0; s < 5; s++) {
        total[s] += fm.flow[k][s] * dt;
        capTotal[s] += fm.cap[k][s] * dt;
        maxBacklog[s] = Math.max(maxBacklog[s], fm.backlog[k][s]);
      }
    }
    const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

    const startDay = Math.min(Math.max(1, Math.round(nDays / 2)), Math.max(1, nDays - 3));
    const hours = [];
    const wBacklog = [];
    const wFlow = [];
    for (let i = 0; i < 3 * perDay; i++) {
      const k = (startDay - 1) * perDay + i;
      if (k >= fm.flow.length) break;
      hours.push(i * dt);
      wBacklog.push(fm.backlog[k].map((v) => round(v, 3)));
      wFlow.push(fm.flow[k].map((v) => round(v, 3)));
    }

    const day = [];
    const dailyBacklog = [];
    for (let d = 1; d <= nDays; d++) {
      day.push(d);
      dailyBacklog.push(fm.backlog[d * perDay - 1].map((v) => round(v, 2)));
    }

    return {
      stages: ["Acquire", "Uplink", "Compute", "Review", "Referral"],
      units: ["patients", "images", "images", "cases", "referrals"],
      total,
      availUtilPct: total.map((t, s) => 100 * t / Math.max(capTotal[s], 1e-12)),
      maxBacklog,
      window: { hours, backlog: wBacklog, flow: wFlow, startDay },
      daily: { day, backlog: dailyBacklog },
      params: { simStepH: dt, workingDays: p.workingDays },
    };
  }

  /* ================================================= scenario runner */

  // Same names and ranges as validation.py / drishtiRunScenario.m.
  const LIMITS = {
    annualPatients: [10000, 400000, true], sites: [1, 30, true], workers: [1, 16, true],
    procMeanSec: [2, 180, false], graderFTE: [0.5, 10, false], ophthFTE: [0.25, 6, false],
    uplinkMbps: [0.1, 50, false], pReferable: [0.01, 0.4, false], pDisagree: [0, 0.6, false],
  };

  function runScenario(overrides) {
    const p = Object.assign({}, BASE, { uplinkMbps: 4, simStepH: 0.25 });
    delete p.uplinkIdx;
    Object.keys(overrides || {}).forEach((k) => {
      const lim = LIMITS[k];
      const v = overrides[k];
      if (!lim) throw new Error(`Unknown parameter: ${k}`);
      if (!Number.isFinite(v) || v < lim[0] || v > lim[1]) {
        throw new Error(`${k} must be between ${lim[0]} and ${lim[1]}.`);
      }
      p[k] = lim[2] ? Math.round(v) : v;
    });

    const t0 = performance.now();
    const r = simulate(p);
    const t1 = performance.now();
    const flow = summariseFlow(flowModel(p), p);
    const t2 = performance.now();

    const des = {
      patientsScreened: r.screened,
      unmetDemandPct: r.unmetPct,
      ungradableRatePct: 100 * r.ungradable / Math.max(1, r.presented),
      imagesUploaded: r.images,
      gbPerYear: r.gbYear,
      autoMedianMin: r.autoMedian,
      autoP95Min: r.autoP95,
      sameSessionPct: r.sameSession,
      turnaroundP95H: r.turnP95,
      withinSlaPct: r.slaPct,
      humanTouchRatePct: 100 * r.humanCases / Math.max(1, r.screened),
      casesToHuman: r.humanCases,
      referableCases: r.refCases,
      referralP95WaitDays: Number.isFinite(r.aP95) ? r.aP95 : 0,
      computeP95WaitMin: r.procP95,
      computeUtil24hPct: r.cpuUtil24,
    };

    const utilisation = [
      { key: "technician", label: "Technician", pct: r.techUtil, basis: "of session hours" },
      { key: "uplink", label: "Site uplink", pct: r.linkUtil, basis: "of session hours" },
      { key: "compute", label: "Compute workers", pct: r.cpuUtilSess, basis: "of session hours" },
      { key: "grader", label: "Graders", pct: r.graderUtil, basis: "of shift hours" },
      { key: "ophthalmologist", label: "Ophthalmologist", pct: r.ophthUtil, basis: "of appointment slots" },
    ];
    const bottleneck = utilisation.reduce((a, b) => (b.pct > a.pct ? b : a));

    const names = ["Patients screened", "Images uploaded", "Images processed", "Human review cases", "Referrals"];
    const desVals = [des.patientsScreened, des.imagesUploaded, des.imagesUploaded, des.casesToHuman, des.referableCases];
    const validation = names.map((quantity, i) => ({
      quantity,
      flow: Math.round(flow.total[i]),
      des: desVals[i],
      diffPct: Math.round(1000 * (flow.total[i] - desVals[i]) / Math.max(1, desVals[i])) / 10,
    }));

    const params = {};
    Object.keys(LIMITS).forEach((k) => { params[k] = p[k]; });
    params.workingDays = p.workingDays;
    params.sessionHours = p.sessionHours;

    return {
      engine: "browser",
      engineNote: "Ran in your browser: JavaScript ports of the MATLAB discrete-event model and the Simulink block equations.",
      params, des, utilisation, bottleneck, flow, validation,
      timing: { desSec: (t1 - t0) / 1000, flowSec: (t2 - t1) / 1000 },
    };
  }

  window.DRishtiCapacity = { runScenario, flowModel, flowRates, summariseFlow, simulate, BASE };
})();
