'use strict';
const release = {"id":"6420f6e858c26be3521e","shell":"shell-6420f6e858c26be3521e.html","payload":"cartridge-7c282aa1b130aff915f4a67f53edf9c378cca09c7968639ce433393a41d4f171.bin","bytes":14054819,"digest":"7c282aa1b130aff915f4a67f53edf9c378cca09c7968639ce433393a41d4f171","codec":"gzip","assets":[{"file":"shell-6420f6e858c26be3521e.html","digest":"111be57a5bd41d063fb2c3d8bb2f6de024ab000806e0e9c89ad7ae548cc88c02","type":"text/html; charset=utf-8"},{"file":"launcher-6420f6e858c26be3521e.js","digest":"b5b019791cf965f30107b91169b3c9eaabd3bb4c0352bef40fead80c702d95fe","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"71cebdb94499ce881c4bfe10cdacb0334c1933c2e0dd735133156a510430154d","type":"application/manifest+json"},{"file":"icon-192.png","digest":"7e4ffb57a7114dd7b11ac7ebe9dce84f4cee648920863a3b4b60c3910e72eb12","type":"image/png"},{"file":"icon-512.png","digest":"52344bb3ae195fbcbd13674d59e644e32991ee3f15d954b7bd8b77979a0daaf5","type":"image/png"}]};
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
  const navigation = request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === base.pathname + 'index.html');
  if (!navigation && !staticUrls.includes(url.href) && url.href !== payloadUrl) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // The client uses no-store only after independently rejecting a local copy.
    if (request.cache === 'no-store' && url.href === payloadUrl) return fetch(request);
    return (await cache.match(navigation ? shellUrl : request)) || fetch(request);
  })());
});
