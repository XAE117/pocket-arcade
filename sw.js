'use strict';
const release = {"id":"cd49aae87eeaa883432e","shell":"shell-cd49aae87eeaa883432e.html","payload":"cartridge-091d2c51daeaac03ba2c80492177ac4c7304a080b5863917db7d89c957b8a173.bin","bytes":15258099,"digest":"091d2c51daeaac03ba2c80492177ac4c7304a080b5863917db7d89c957b8a173","codec":"gzip","parts":[{"payload":"cartridge-d346a390c691e7ba0513126823ecdab765e4c74dd15d6ead9b05e85c3509a12f.bin","digest":"d346a390c691e7ba0513126823ecdab765e4c74dd15d6ead9b05e85c3509a12f","bytes":43023962},{"payload":"cartridge-c968e44edf562d0cfc2f42c9d2a45bd402ac137a6ee3b2d195b02bad7911ba11.bin","digest":"c968e44edf562d0cfc2f42c9d2a45bd402ac137a6ee3b2d195b02bad7911ba11","bytes":604047}],"assets":[{"file":"shell-cd49aae87eeaa883432e.html","digest":"57f0fc63b068395d7eada815937e65443a100f8c5ebe0515dd2a21d14ff579ed","type":"text/html; charset=utf-8"},{"file":"launcher-cd49aae87eeaa883432e.js","digest":"4f3c4a79ceb0f2863c27a9b1f5c23ece49ea5bdc79bfc2fa1aa9fdb8555fc556","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"f0b7796b296e1a67b6e3771944ed6ef395c3ef1199042aa25d6f5f0bd0d72424","type":"image/png"},{"file":"icon-512.png","digest":"45a93567bf56a70b9286f0ad3937dc2185bdc01fa1974ef822d256edbefd973d","type":"image/png"}]};
const base = new URL('./', self.location.href);
const prefix = 'private-arcade:' + base.pathname + ':release-';
const cacheName = prefix + release.id;
const shellUrl = new URL(release.shell, base).href;
const payloadUrl = new URL(release.payload, base).href;
const partUrls=[payloadUrl,...release.parts.map(part=>new URL(part.payload,base).href)];
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
    let keepFull = false;
    // Keep a prior complete offline installation usable across an update.
    // Legacy releases held all modes in one verified cartridge. A split
    // release carries a marker only after its launcher authenticated every part.
    for(const previous of (await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName).reverse()){
      const old=await caches.open(previous);
      const paths=(await old.keys()).map(request=>new URL(request.url).pathname.slice(base.pathname.length));
      const previousId=previous.slice(prefix.length);
      if(!paths.includes('shell-'+previousId+'.html'))continue;
      keepFull=paths.includes('full-'+previousId)||paths.includes('prefetched-'+previousId);
      if(!keepFull){
        const client=await old.match(new URL('launcher-'+previousId+'.js',base).href);
        if(client&&paths.some(path=>path.startsWith('cartridge-')))keepFull=!(await client.text()).includes('__arcadePart');
      }
      break;
    }
    const required = keepFull ? [release, ...release.parts] : [release];
    const pending = [];
    // Finish every download before writing any of this install's large bodies.
    // A rejected install can leave WebKit's next worker with missing cache entries.
    for (const part of required) {
      const url = new URL(part.payload, base).href;
      const stored = await cache.match(url);
      if (stored && await verifyBytes(await stored.arrayBuffer(), part.digest)) continue;
      const response = await fetch(url, {cache: 'reload', credentials: 'omit', redirect: 'error'});
      if (!response.ok) throw new Error('Cartridge download failed');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== part.bytes || !(await verifyBytes(bytes, part.digest))) {
        throw new Error('Cartridge verification failed');
      }
      pending.push({url, bytes});
    }
    const assets = await Promise.all(release.assets.map(getStaticAsset));
    for (const {url, bytes} of pending) {
      await cache.put(url, new Response(bytes, {headers: {'Content-Type': 'application/octet-stream'}}));
    }
    await Promise.all(assets.map(([url, response]) => cache.put(url, response)));
    for (const part of required) {
      const stored = await cache.match(new URL(part.payload, base).href);
      if (!stored || !(await verifyBytes(await stored.arrayBuffer(), part.digest))) {
        throw new Error('Offline installation incomplete');
      }
    }
    if (keepFull) await cache.put(new URL('prefetched-' + release.id, base).href, new Response('1'));
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

self.addEventListener('message',event=>{
  if(event.data==='arcade-release')event.ports[0]?.postMessage(release.id);
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin) return;
  const latest = request.mode === 'navigate' && url.pathname === base.pathname + 'play.html';
  const navigation = latest || request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === base.pathname + 'index.html');
  if (!navigation && !staticUrls.includes(url.href) && !partUrls.includes(url.href)) return;
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
    if (request.cache === 'no-store' && partUrls.includes(url.href)) return fetch(request);
    return (await cache.match(navigation ? shellUrl : request)) || fetch(request);
  })());
});
