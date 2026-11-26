'use strict';
(() => {
  const release = {"id":"fd36538f57d72b4d6511","shell":"shell-fd36538f57d72b4d6511.html","payload":"cartridge-ff60cdc6c3a712d8f73f8d13d0e105d398fb5ab8790311b098928b6ddddd8ca2.bin","bytes":45311462,"digest":"ff60cdc6c3a712d8f73f8d13d0e105d398fb5ab8790311b098928b6ddddd8ca2","codec":"gzip"};
  const base = new URL('./', location.href);
  const scopePrefix = 'private-arcade:' + base.pathname + ':';
  const cacheName = scopePrefix + 'release-' + release.id;
  const storageKey = scopePrefix + 'invitation';
  const playedKey = scopePrefix + 'played';
  const payloadUrl = new URL(release.payload, base).href;
  const shell = document.querySelector('main');
  const status = document.querySelector('#status');
  const hint = document.querySelector('#hint');
  const phaseLabel = document.querySelector('#phase-label');
  const transfer = document.querySelector('#transfer');
  const progress = document.querySelector('#progress');
  const transferDetail = document.querySelector('#transfer-detail');
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
  const phaseLabels = {
    invitation:'Family arcade',download:'Transfer',verify:'Integrity check',unlocking:'Private access',
    opening:'Arcade setup',preparing:'Offline setup',offline:'Saved on this device',ready:'Family arcade',error:'Try again'
  };
  function show(phase, message, detail = '') {
    shell.dataset.phase = phase;
    phaseLabel.textContent = phaseLabels[phase];
    status.textContent = message;
    hint.textContent = detail;
    hint.hidden = !detail;
    transfer.hidden = phase !== 'download';
  }

  const sizeText = bytes => (bytes / 1e6).toFixed(1) + ' MB';
  function downloadProgress(bytes) {
    progress.max = release.bytes;
    progress.value = bytes;
    transferDetail.textContent = sizeText(bytes) + ' of ' + sizeText(release.bytes);
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

  async function readEnvelope(response, downloaded) {
    if (!response.ok) throw new Error('download');
    const length = Number(response.headers.get('content-length'));
    if (length && length !== release.bytes && !response.headers.get('content-encoding')) throw new Error('damage');
    let bytes;
    if (response.body && response.body.getReader) {
      bytes = new Uint8Array(release.bytes);
      const reader = response.body.getReader();
      let count = 0;
      let lastReported = 0;
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
          if (downloaded && count - lastReported >= Math.max(64*1024,bytes.length*.035)) {
            downloadProgress(count);
            lastReported = count;
          }
        }
      } finally { reader.releaseLock(); }
      if (count !== bytes.length) throw new Error('damage');
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== release.bytes) throw new Error('damage');
    }
    show('verify','Verifying game files',downloaded?'The download is complete.':'Checking your saved copy.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const fingerprint = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
    if (fingerprint !== release.digest) throw new Error('damage');
    return bytes;
  }

  async function getEnvelope(cache) {
    if (cache) {
      try {
        const stored = await cache.match(payloadUrl);
        if (stored) return {bytes: await readEnvelope(stored, false), downloaded: false};
      } catch {
        try { await cache.delete(payloadUrl); } catch {}
      }
    }
    show('download','Downloading the game','Keep this tab open while the files arrive.');
    downloadProgress(0);
    let response;
    try {
      response = await fetch(payloadUrl, {cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'});
    } catch { throw new Error('download'); }
    return {bytes: await readEnvelope(response, true), downloaded: true};
  }

  async function openGame(token, cache) {
    const {bytes, downloaded} = await getEnvelope(cache);
    show('unlocking','Checking your invitation');
    const encoded = token.replace(/-/g, '+').replace(/_/g, '/');
    const raw = Uint8Array.from(atob(encoded + '='), c => c.charCodeAt(0));
    // Reject alternate encodings of the last four padding bits.
    if (btoa(String.fromCharCode(...raw)).replace(/=+$/, '') !== encoded) throw new Error('invite');
    const key = await crypto.subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['decrypt']);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.subarray(0, 12)}, key, bytes.subarray(12));
    } catch { throw new Error('invite'); }
    show('opening','Preparing the arcade','Getting the game ready to play.');
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
      show('invitation','Open your invitation','Paste the link your family shared with you. The same invitation works from your Home Screen.');
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
    show('opening','Opening the arcade');
    try {
      if (!window.isSecureContext || !window.crypto || !crypto.subtle) throw new Error('security');
      if (release.codec === 'gzip' && (typeof DecompressionStream !== 'function' || !Blob.prototype.stream)) throw new Error('version');
      let cache;
      try { cache = await caches.open(cacheName); } catch {}
      const opened = await openGame(token, cache);
      gameHtml = opened.text;
      const keySaved = saveSetting(storageKey, token);
      const played = readSetting(playedKey) === '1';
      const canSave = opened.saved && keySaved;
      if(canSave)show('preparing','Setting up offline play','You can play now while this device saves the game.');
      play.hidden = false;
      const check = canSave ? prepareOffline(cache).catch(() => false) : Promise.resolve(false);
      let timeout;
      const ready = await Promise.race([check, new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), 7000);
      })]);
      clearTimeout(timeout);
      if(gameHtml===null)return;
      if (played && ready) { enter(); return; }
      const offline = () => show('offline','Ready to play offline','Turn the iPad sideways for two players. To keep an icon, choose Share → Add to Home Screen in Safari.');
      if (ready) offline();
      else {
        show('ready','Ready to play','Play in this tab. To try offline setup again, reopen your invitation in Safari while online.');
        check.then(ok => { if (ok && gameHtml !== null) offline(); });
      }
      play.focus({preventScroll:true});
    } catch (error) {
      busy = false;
      const messages = {
        invite:['Invitation didn’t open','This invitation could not unlock the game. Paste the original private link.'],
        damage:['Download didn’t finish','Reconnect and open your invitation again to get a fresh copy.'],
        download:['Can’t reach the arcade','Connect to the internet and reopen your invitation.'],
        security:['Open the full invitation','Use the complete HTTPS link in Safari.'],
        version:['Browser update needed','Use a current browser or update iPadOS to open the game.']
      };
      const [title,detail]=messages[error.message]||['Couldn’t open the game','Reconnect and try your invitation again.'];
      show('error',title,detail);
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
