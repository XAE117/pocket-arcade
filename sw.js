'use strict';
const release = {"id":"c903b7c719a1f3faf5a7","shell":"shell-c903b7c719a1f3faf5a7.html","payload":"cartridge-e9257f9e05cafef9c785fe3d43d70a69207581c58e8d95a562baad4f2ece5092.bin","bytes":29505041,"digest":"e9257f9e05cafef9c785fe3d43d70a69207581c58e8d95a562baad4f2ece5092","codec":"gzip","assets":[{"file":"shell-c903b7c719a1f3faf5a7.html","digest":"bf6aeb753755766bd0c57909df57850391ead1315853fb1b18fbaba7be1e2901","type":"text/html; charset=utf-8"},{"file":"launcher-c903b7c719a1f3faf5a7.js","digest":"16a517a368e3427f3b46ff5ca6af32f8756cc880c3fcd3791d72d55684a8bda3","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"200f77a42259fd86e0080d5203c9ce9029d3d5f4586c8dc52eb658607402fe51","type":"image/png"},{"file":"icon-512.png","digest":"e92b7991144133af613ac7ab67ceca47edeadabc619b88e390efbc58010f58be","type":"image/png"}]};
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
