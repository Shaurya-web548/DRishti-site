/* DRishti - screening page: upload, run the pipeline, show the result,
   and download the PDF report. */
(function () {
  'use strict';

  const MIN_AGE = 0;
  const MAX_AGE = 120;
  const STEP_MS = 2600;

  const $ = (id) => document.getElementById(id);
  const uploadDrop = $('uploadDrop');
  const imageInput = $('imageInput');
  const uploadLabel = $('uploadLabel');
  const previewImg = $('previewImg');
  const scanForm = $('scanForm');
  const submitBtn = $('submitBtn');
  const loadingState = $('loadingState');
  const loadingSteps = $('loadingSteps');
  const errorState = $('errorState');
  const resultState = $('resultState');
  const ageInput = $('patientAge');
  const ageError = $('ageError');

  let lastScanId = null;
  let stepTimer = null;

  /* --------------------------------------------------------- choosing */
  function showPreview(file) {
    uploadLabel.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      previewImg.src = reader.result;
      previewImg.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  imageInput.addEventListener('change', () => {
    if (imageInput.files.length) showPreview(imageInput.files[0]);
  });

  ['dragover', 'dragenter'].forEach((evt) =>
    uploadDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadDrop.classList.add('dragover');
    }));
  ['dragleave', 'drop'].forEach((evt) =>
    uploadDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadDrop.classList.remove('dragover');
    }));
  uploadDrop.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) {
      imageInput.files = e.dataTransfer.files;
      showPreview(file);
    }
  });

  /* ---------------------------------------------------- progress steps */
  function startSteps() {
    const items = Array.from(loadingSteps.children);
    let i = 0;
    items.forEach((li) => li.classList.remove('active', 'done'));
    items[0].classList.add('active');
    stepTimer = setInterval(() => {
      if (i < items.length - 1) {
        items[i].classList.replace('active', 'done');
        i += 1;
        items[i].classList.add('active');
      }
    }, STEP_MS);
  }

  function stopSteps() {
    clearInterval(stepTimer);
    stepTimer = null;
  }

  /* ------------------------------------------------------------- scan */
  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!imageInput.files.length) {
      showError('Choose a fundus photograph first.');
      return;
    }

    errorState.classList.add('hidden');
    resultState.classList.add('hidden');
    loadingState.classList.remove('hidden');
    submitBtn.disabled = true;
    startSteps();

    const formData = new FormData();
    formData.append('image', imageInput.files[0]);

    try {
      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Something went wrong analysing this image.');
      }
      if (data.mode === 'rejected') {
        throw new Error(data.message || 'Image quality too low to grade. Please retake the photo.');
      }
      renderResult(data);
    } catch (err) {
      showError(err.message);
    } finally {
      stopSteps();
      loadingState.classList.add('hidden');
      submitBtn.disabled = false;
    }
  });

  function showError(message) {
    errorState.textContent = message;
    errorState.classList.remove('hidden');
  }

  function renderResult(data) {
    lastScanId = data.scan_id;

    const modeBadge = $('modeBadge');
    const full = data.mode === 'real_full';
    modeBadge.textContent = full ? 'AI-assisted · CNN + rules' : 'Rule-based grading';
    modeBadge.classList.toggle('rule-based', !full);

    const grade = Number(data.grade);
    const chip = $('gradeChip');
    chip.textContent = Number.isFinite(grade) ? grade : '?';
    chip.style.setProperty('--c', `var(--g${Number.isFinite(grade) ? grade : 0})`);

    $('gradeHeadline').textContent = data.grade_label;
    const refer = $('referLine');
    refer.textContent = data.referable
      ? 'Referable: this patient should see an ophthalmologist.'
      : 'Not referable: continue routine annual screening.';
    refer.classList.toggle('is-refer', Boolean(data.referable));

    document.querySelectorAll('#gradeScale span').forEach((s) => {
      s.classList.toggle('on', Number(s.dataset.g) === grade);
    });

    $('confidenceLine').textContent = typeof data.confidence === 'number'
      ? `Calibrated AI confidence: ${Math.round(data.confidence * 100)}%`
      : 'No confidence score in rule-based mode. The grade comes from the clinical rules alone.';

    $('imgOriginal').src = data.original_url;
    setFigure('figOverlay', 'imgOverlay', data.overlay_url);
    setFigure('figGradcam', 'imgGradcam', data.gradcam_url);

    resultState.classList.remove('hidden');
    resultState.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setFigure(figId, imgId, url) {
    const fig = $(figId);
    if (url) {
      $(imgId).src = url;
      fig.classList.remove('hidden');
    } else {
      fig.classList.add('hidden');
    }
  }

  /* -------------------------------------------------------------- age */

  // Refuse the characters that let a number field hold a sign or exponent.
  ageInput.addEventListener('keydown', (e) => {
    if (['-', '+', 'e', 'E', '.', ','].includes(e.key)) e.preventDefault();
  });

  ageInput.addEventListener('input', () => validateAge());

  function validateAge() {
    const raw = ageInput.value.trim();
    let message = '';
    if (ageInput.validity.badInput) {
      message = 'Age must be a whole number of years.';
    } else if (raw !== '') {
      const age = Number(raw);
      if (!Number.isInteger(age)) message = 'Age must be a whole number of years.';
      else if (age < MIN_AGE) message = 'Age cannot be negative.';
      else if (age > MAX_AGE) message = `Age must be ${MAX_AGE} or less.`;
    }
    ageError.textContent = message;
    ageError.classList.toggle('hidden', !message);
    ageInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  }

  function showReportError(message) {
    ageError.textContent = message;
    ageError.classList.toggle('hidden', !message);
  }

  // Fetch rather than navigate, so a server-side rejection (the same age
  // rules, checked again in validation.py) shows up here instead of as a
  // raw JSON page.
  $('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!lastScanId || !validateAge()) {
      ageInput.focus();
      return;
    }
    const params = new URLSearchParams({
      name: $('patientName').value.trim() || '-',
      age: ageInput.value.trim() || '-',
      location: $('patientLocation').value.trim() || '-',
    });
    const button = $('downloadReportBtn');
    button.disabled = true;
    try {
      const res = await fetch(`/api/report/${lastScanId}?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showReportError(body.error || 'The report could not be generated.');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `DRishti_report_${lastScanId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      showReportError('');
    } catch (err) {
      showReportError('The report could not be downloaded. Is the server still running?');
    } finally {
      button.disabled = false;
    }
  });
})();
