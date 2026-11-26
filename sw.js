'use strict';
const release = {"id":"eb0d75ff7c16b976191a","shell":"shell-eb0d75ff7c16b976191a.html","payload":"cartridge-d576f8850def15fd31f374641b6f37dd6e8d6075091b55410bfbc5e05e238514.bin","bytes":23522370,"digest":"d576f8850def15fd31f374641b6f37dd6e8d6075091b55410bfbc5e05e238514","codec":"gzip","assets":[{"file":"shell-eb0d75ff7c16b976191a.html","digest":"ae97ca4f9e82f18b29b44a1fff05d295b8969222e219071c8a382913022b4c2c","type":"text/html; charset=utf-8"},{"file":"launcher-eb0d75ff7c16b976191a.js","digest":"86875f9e55d3ccfde3cd21280878fa6141a965814ad98b84dd1835282ed00276","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"71cebdb94499ce881c4bfe10cdacb0334c1933c2e0dd735133156a510430154d","type":"application/manifest+json"},{"file":"icon-192.png","digest":"7e4ffb57a7114dd7b11ac7ebe9dce84f4cee648920863a3b4b60c3910e72eb12","type":"image/png"},{"file":"icon-512.png","digest":"52344bb3ae195fbcbd13674d59e644e32991ee3f15d954b7bd8b77979a0daaf5","type":"image/png"}]};
const base = new URL('./', self.location.href);
const prefix = 'private-arcade:' + base.pathname + ':release-';
const cacheName = prefix + release.id;
const shellUrl = new URL(release.shell, base).href;
const payloadUrl = new URL(release.payload, base).href;
const staticUrls = release.assets.map(asset => new URL(asset.file, base).href);

async function verifyBytes(bytes, expected) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('') === expected;
}

async function getStaticAsset(asset) {
  const url = new URL(asset.file, base);
  const response = await fetch(url, {cache: 'reload', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer'});
  const finalUrl = new URL(response.url);
  if (!response.ok || finalUrl.origin !== base.origin || !finalUrl.pathname.startsWith(base.pathname)) {
    throw new Error('Shell download failed');
  }
  const bytes = await response.arrayBuffer();
  if (!(await verifyBytes(bytes, asset.digest))) throw new Error('Shell verification failed');
  // A new local response has no redirect history. Safari can serve this for
  // offline navigation even when the host canonicalizes public .html paths.
  return [url.href, new Response(bytes, {headers: {
    'Content-Type': asset.type, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive'
  }})];
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    // A successful invite has normally already put this entry in the cache.
    // An update running in the background needs to acquire its own ciphertext.
    if (!(await cache.match(payloadUrl))) {
      const response = await fetch(new Request(payloadUrl, {cache: 'reload', credentials: 'omit', redirect: 'error'}));
      if (!response.ok) throw new Error('Cartridge download failed');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== release.bytes) throw new Error('Incomplete cartridge');
      if (!(await verifyBytes(bytes, release.digest))) throw new Error('Cartridge verification failed');
      await cache.put(payloadUrl, new Response(bytes, {headers: {'Content-Type': 'application/octet-stream'}}));
    }
    const assets = await Promise.all(release.assets.map(getStaticAsset));
    await Promise.all(assets.map(([url, response]) => cache.put(url, response)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const older = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
    // Retain one preceding release for a page that was already opening.
    await Promise.all(older.slice(0, -1).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin) return;
  const latest = request.mode === 'navigate' && url.pathname === base.pathname + 'play.html';
  const navigation = latest || request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === base.pathname + 'index.html');
  if (!navigation && !staticUrls.includes(url.href) && url.href !== payloadUrl) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // Explicit invitation opens check the current release; an installed icon starts instantly offline.
    if (latest) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const next = await fetch(request, {cache:'no-store', signal:controller.signal});
        if (next.ok && next.headers.get('Content-Type')?.includes('text/html')) return next;
      } catch {} finally { clearTimeout(timer); }
    }
    // The client uses no-store only after independently rejecting a local copy.
    if (request.cache === 'no-store' && url.href === payloadUrl) return fetch(request);
    return (await cache.match(navigation ? shellUrl : request)) || fetch(request);
  })());
});
