/* GitHub Pages copy of the scan page: find out whether the live DRishti
   server is running, and if so offer a link to it.

   run-public.ps1 writes {"online": true, "url": "https://....trycloudflare.com"}
   to live.json on the repository's `live` branch when it starts, and
   {"online": false} when it stops. Because a laptop can also just switch off,
   the page does not trust that file alone: it asks the server's /api/health
   directly, and only shows the link if the server answers. */
(function () {
  'use strict';

  const panel = document.getElementById('scan');
  const state = document.getElementById('liveState');
  const title = document.getElementById('liveTitle');
  const text = document.getElementById('liveText');
  const link = document.getElementById('liveLink');
  if (!panel || !state) return;

  const TUNNEL_URL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
  const PING_TIMEOUT_MS = 6000;

  function show(kind, heading, body, url) {
    state.dataset.state = kind;
    title.textContent = heading;
    text.textContent = body;
    if (url) {
      link.href = `${url}/scan`;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  function offline() {
    show('offline', 'Live screening is offline right now',
      'It runs on the team’s demo server, which is switched on for demonstrations. ' +
      'Everything else on this site works without it.');
  }

  async function ping(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/api/health`, { cache: 'no-store', signal: controller.signal });
      const body = await res.json();          // read it, so the request closes
      return res.ok && body.ok === true;
    } catch (err) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function check() {
    const repo = panel.dataset.repo;
    if (!repo) return offline();
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/live.json?ref=live`, {
        headers: { Accept: 'application/vnd.github.raw+json' },
        cache: 'no-store',
      });
      if (!res.ok) return offline();
      const info = await res.json();
      // Only ever link to a Cloudflare quick-tunnel address.
      if (!info || !info.online || !TUNNEL_URL.test(info.url || '')) return offline();
      if (await ping(info.url)) {
        show('online', 'Live screening is online',
          'Upload a fundus photograph on the live server and get a graded, explained result in seconds.',
          info.url);
      } else {
        offline();
      }
    } catch (err) {
      offline();
    }
  }

  check();
})();
