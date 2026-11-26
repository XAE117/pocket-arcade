'use strict';
(() => {
  const release = {"id":"c903b7c719a1f3faf5a7","shell":"shell-c903b7c719a1f3faf5a7.html","payload":"cartridge-e9257f9e05cafef9c785fe3d43d70a69207581c58e8d95a562baad4f2ece5092.bin","bytes":29505041,"digest":"e9257f9e05cafef9c785fe3d43d70a69207581c58e8d95a562baad4f2ece5092","codec":"gzip"};
  const base = new URL('./', location.href);
  const scopePrefix = 'private-arcade:' + base.pathname + ':';
  const cacheName = scopePrefix + 'release-' + release.id;
  const storageKey = scopePrefix + 'invitation';
  const playedKey = scopePrefix + 'played';
  const payloadUrl = new URL(release.payload, base).href;
  const status = document.querySelector('#status');
  const hint = document.querySelector('#hint');
  const form = document.querySelector('#unlock');
  const input = document.querySelector('#invite');
  const play = document.querySelector('#play');
  let busy = false;
  let gameHtml = null;
  let requestedEntry = new URLSearchParams(location.search).get('m');

  function readSetting(name) {
    try { return localStorage.getItem(name); } catch { return null; }
  }
  function saveSetting(name, value) {
    try { localStorage.setItem(name, value); return true; } catch { return false; }
  }
  function show(message, detail = '') {
    status.textContent = message;
    hint.textContent = detail;
    hint.hidden = !detail;
  }

  function invitationKey(invitation) {
    let fragment = invitation.trim();
    if (/^https?:\/\//i.test(fragment)) {
      try { fragment = new URL(fragment).hash; } catch { return ''; }
    }
    if (fragment.startsWith('#')) fragment = fragment.slice(1);
    if (fragment.startsWith('k=')) fragment = fragment.slice(2);
    return /^[A-Za-z0-9_-]{43}$/.test(fragment) ? fragment : '';
  }

  async function readEnvelope(response) {
    if (!response.ok) throw new Error('download');
    const length = Number(response.headers.get('content-length'));
    if (length && length !== release.bytes && !response.headers.get('content-encoding')) throw new Error('damage');
    let bytes;
    if (response.body && response.body.getReader) {
      bytes = new Uint8Array(release.bytes);
      const reader = response.body.getReader();
      let count = 0;
      let lastPercent = -10;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (count + value.length > bytes.length) {
            await reader.cancel();
            throw new Error('damage');
          }
          bytes.set(value, count);
          count += value.length;
          const percent = Math.floor(100 * count / bytes.length);
          if (percent >= lastPercent + 10) {
            show('Opening the game · ' + percent + '%');
            lastPercent = percent;
          }
        }
      } finally { reader.releaseLock(); }
      if (count !== bytes.length) throw new Error('damage');
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== release.bytes) throw new Error('damage');
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const fingerprint = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
    if (fingerprint !== release.digest) throw new Error('damage');
    return bytes;
  }

  async function getEnvelope(cache) {
    if (cache) {
      try {
        const stored = await cache.match(payloadUrl);
        if (stored) return {bytes: await readEnvelope(stored), downloaded: false};
      } catch {
        try { await cache.delete(payloadUrl); } catch {}
      }
    }
    let response;
    try {
      response = await fetch(payloadUrl, {cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'});
    } catch { throw new Error('download'); }
    return {bytes: await readEnvelope(response), downloaded: true};
  }

  async function openGame(token, cache) {
    const {bytes, downloaded} = await getEnvelope(cache);
    const encoded = token.replace(/-/g, '+').replace(/_/g, '/');
    const raw = Uint8Array.from(atob(encoded + '='), c => c.charCodeAt(0));
    // Reject alternate encodings of the last four padding bits.
    if (btoa(String.fromCharCode(...raw)).replace(/=+$/, '') !== encoded) throw new Error('invite');
    const key = await crypto.subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['decrypt']);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.subarray(0, 12)}, key, bytes.subarray(12));
    } catch { throw new Error('invite'); }
    let text;
    if (release.codec === 'gzip') {
      const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(plain);
    }
    let saved = !!cache;
    if (cache && downloaded) {
      try {
        await cache.put(payloadUrl, new Response(bytes, {headers: {'Content-Type': 'application/octet-stream'}}));
      } catch { saved = false; }
    }
    return {text, saved};
  }

  // Install the exact shell that opens these bytes. Recheck the active worker
  // on every online launch so a future family release can arrive in one visit.
  async function prepareOffline(cache) {
    if (!cache || !('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.href, updateViaCache: 'none'
    });
    const shellUrl = new URL(release.shell, base).href;
    if (registration.active) registration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    if (await cache.match(shellUrl)) return true;
    // An earlier installed worker may still own this tab while the new shell downloads.
    return new Promise(resolve => {
      let finished = false;
      function end(value) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', check);
        resolve(value);
      }
      function check() { cache.match(shellUrl).then(found => { if (found) end(true); }).catch(() => end(false)); }
      const timeout = setTimeout(() => end(false), 25000);
      navigator.serviceWorker.addEventListener('controllerchange', check);
      check();
    });
  }

  function enter() {
    if (gameHtml === null) return;
    const html = gameHtml;
    gameHtml = null;
    saveSetting(playedKey, '1');
    const appSettings = [
      'meta[name="referrer"]', 'meta[name="robots"]',
      'meta[name="apple-mobile-web-app-capable"]', 'meta[name="apple-mobile-web-app-title"]',
      'meta[name="private-arcade-build"]', 'link[rel="canonical"]', 'link[rel="manifest"]',
      'link[rel="apple-touch-icon"]', 'link[rel="icon"]'
    ].map(selector => [selector, document.head.querySelector(selector).cloneNode(true)]);
    // Run the original document at the current top-level origin. All game
    // scripts, local saves, user gestures, fullscreen and reload keep their semantics.
    document.open();
    document.write(html);
    document.close();
    for (const [selector, setting] of appSettings) {
      const previous = document.head.querySelector(selector);
      if (previous) previous.replaceWith(setting);
      else document.head.append(setting);
    }
    if (requestedEntry === '2' || requestedEntry === '3') {
      document.querySelector('[data-arcade-entry="2"]')?.click();
      if (requestedEntry === '3') document.querySelector('[data-arcade-entry="3"]')?.click();
    } else if(requestedEntry === '4') {
      document.querySelector('[data-arcade-entry="4"]')?.click();
    } else if(requestedEntry === '5') {
      document.querySelector('[data-arcade-entry="5"]')?.click();
      document.querySelector('[data-stop="6"]')?.click();
      document.querySelector('[data-stage-pick="6"]')?.click();
    }
  }

  async function unlock(invitation) {
    if (busy) return;
    const token = invitationKey(invitation);
    if (!token) {
      show('Open your private invitation link, or paste the complete link below.',
        'If you added the arcade to your Home Screen, you can use the same invitation here.');
      form.hidden = false;
      return;
    }
    if (/^https?:\/\//i.test(invitation.trim())) {
      const link = new URL(invitation.trim());
      if (link.origin === base.origin && (link.pathname === base.pathname || link.pathname === base.pathname + 'play.html')) {
        requestedEntry = link.searchParams.get('m');
      }
    }
    busy = true;
    form.hidden = true;
    input.value = '';
    show('Opening Super Splash Bros. & Sisters…', 'Keep this page open while the game downloads.');
    try {
      if (!window.isSecureContext || !window.crypto || !crypto.subtle) throw new Error('security');
      if (release.codec === 'gzip' && (typeof DecompressionStream !== 'function' || !Blob.prototype.stream)) throw new Error('version');
      let cache;
      try { cache = await caches.open(cacheName); } catch {}
      const opened = await openGame(token, cache);
      gameHtml = opened.text;
      const keySaved = saveSetting(storageKey, token);
      const played = readSetting(playedKey) === '1';
      show('Preparing offline play…');
      const check = opened.saved && keySaved ? prepareOffline(cache).catch(() => false) : Promise.resolve(false);
      let timeout;
      const ready = await Promise.race([check, new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), 7000);
      })]);
      clearTimeout(timeout);
      if (played && ready) { enter(); return; }
      if (ready) {
        show('Ready to play offline.', 'Turn the iPad sideways for two players. For a Home Screen icon, choose Share → Add to Home Screen in Safari.');
      } else {
        show('Ready to play in this tab.', 'Offline setup is incomplete. Keep your invitation and reopen it online in Safari to try again.');
        check.then(ok => {
          if (ok && gameHtml !== null) show('Ready to play offline.', 'Turn the iPad sideways for two players. In Safari, choose Share → Add to Home Screen for an icon.');
        });
      }
      play.hidden = false;
    } catch (error) {
      busy = false;
      const messages = {
        invite: 'This invitation could not unlock the game. Paste the original private link.',
        damage: 'The game download was incomplete. Reconnect and open the invitation again.',
        download: 'The game could not be downloaded. Connect to the internet and reopen the invitation.',
        security: 'Open your invitation using its full HTTPS address in Safari.',
        version: 'This version needs a browser with gzip support. Update iPadOS or open the invitation in a current browser.'
      };
      show(messages[error.message] || 'The game could not open. Reconnect and try your invitation again.');
      form.hidden = false;
    }
  }

  play.addEventListener('click', enter);
  form.addEventListener('submit', event => { event.preventDefault(); unlock(input.value); });
  const supplied = location.hash;
  if (supplied || location.pathname === base.pathname + 'play.html') {
    // Remove the credential from the visible URL before downloads or game scripts.
    history.replaceState(history.state, '', base.pathname);
  }
  unlock(supplied || readSetting(storageKey) || '');
})();
