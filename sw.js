'use strict';
const release = {"id":"856a8b5ba4a7df4c2650","shell":"shell-856a8b5ba4a7df4c2650.html","payload":"cartridge-91a9783cba6218c2c6b2e47ea6614640364c9db62b724f854e6c234b11ce0a36.bin","bytes":49878132,"digest":"91a9783cba6218c2c6b2e47ea6614640364c9db62b724f854e6c234b11ce0a36","codec":"gzip","assets":[{"file":"shell-856a8b5ba4a7df4c2650.html","digest":"961b072a5b8442b0974c2ae88066f4b385dbf666b850ada0e7ebe52b7f98336a","type":"text/html; charset=utf-8"},{"file":"launcher-856a8b5ba4a7df4c2650.js","digest":"a2ea3d270d66e3d4e0d6fbceb14c2bb5d088325f6f9ecc0b1123a9c96714fcd0","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"f0b7796b296e1a67b6e3771944ed6ef395c3ef1199042aa25d6f5f0bd0d72424","type":"image/png"},{"file":"icon-512.png","digest":"45a93567bf56a70b9286f0ad3937dc2185bdc01fa1974ef822d256edbefd973d","type":"image/png"}]};
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
