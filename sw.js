'use strict';
const release = {"id":"48d677960404f445da56","shell":"shell-48d677960404f445da56.html","payload":"cartridge-bb255ea126e3121aeca2aa11c54c053a80728338c445027196babcb665dd3d75.bin","bytes":15230467,"digest":"bb255ea126e3121aeca2aa11c54c053a80728338c445027196babcb665dd3d75","codec":"gzip","parts":[{"payload":"cartridge-0d02e1113248196e56bf6f872b05c2ee6b97f1f46b36b74d0903dd007a7d3792.bin","digest":"0d02e1113248196e56bf6f872b05c2ee6b97f1f46b36b74d0903dd007a7d3792","bytes":40467153},{"payload":"cartridge-6e6c6fed169f2a5cc8e2e2d440c91d568c7ac5b873d4cf27e6a5909c80494261.bin","digest":"6e6c6fed169f2a5cc8e2e2d440c91d568c7ac5b873d4cf27e6a5909c80494261","bytes":604047}],"assets":[{"file":"shell-48d677960404f445da56.html","digest":"42ca5b8be9b6af0a3a57b39c599a41ef61645ecfcf430d765bb733b6694b14f8","type":"text/html; charset=utf-8"},{"file":"launcher-48d677960404f445da56.js","digest":"a8c580b408b500482e89daf3c3e2ac2c0d7bb04b9dbb756acbd9b7dd74f78a31","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"f0b7796b296e1a67b6e3771944ed6ef395c3ef1199042aa25d6f5f0bd0d72424","type":"image/png"},{"file":"icon-512.png","digest":"45a93567bf56a70b9286f0ad3937dc2185bdc01fa1974ef822d256edbefd973d","type":"image/png"}]};
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
