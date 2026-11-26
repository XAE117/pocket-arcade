'use strict';
const release = {"id":"4185de1e6b52c4f04a9f","shell":"shell-4185de1e6b52c4f04a9f.html","payload":"cartridge-6d6471a04f0ce8ca25c9481d9ee258875bca7195286dfcb7997ab8538f783020.bin","bytes":15216871,"digest":"6d6471a04f0ce8ca25c9481d9ee258875bca7195286dfcb7997ab8538f783020","codec":"gzip","parts":[{"payload":"cartridge-ac6ed2a3620ce37a9253f7581676e2bd36eaebfab46821d8d1257df1aab31dcd.bin","digest":"ac6ed2a3620ce37a9253f7581676e2bd36eaebfab46821d8d1257df1aab31dcd","bytes":36950615},{"payload":"cartridge-f1bc58fb6f813d74af276df334fdd3b2a79c07206ae97d32e5fcda96cb536b0e.bin","digest":"f1bc58fb6f813d74af276df334fdd3b2a79c07206ae97d32e5fcda96cb536b0e","bytes":604047}],"assets":[{"file":"shell-4185de1e6b52c4f04a9f.html","digest":"d7ce10b22a415cff068e83a1d38e33a122999940236b003f6811e712be7c3f4c","type":"text/html; charset=utf-8"},{"file":"launcher-4185de1e6b52c4f04a9f.js","digest":"de608265cca31af4fb10532976ea28eeb179eeb1a36237b0f8379fdffe29f645","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"f0b7796b296e1a67b6e3771944ed6ef395c3ef1199042aa25d6f5f0bd0d72424","type":"image/png"},{"file":"icon-512.png","digest":"45a93567bf56a70b9286f0ad3937dc2185bdc01fa1974ef822d256edbefd973d","type":"image/png"}]};
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
    // Keep a prior complete offline installation usable across an update.
    // Legacy releases held all modes in one verified cartridge. A split
    // release carries a marker only after its launcher authenticated every part.
    for(const previous of (await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName).reverse()){
      const old=await caches.open(previous);
      const paths=(await old.keys()).map(request=>new URL(request.url).pathname.slice(base.pathname.length));
      const previousId=previous.slice(prefix.length);
      if(!paths.includes('shell-'+previousId+'.html'))continue;
      let keepFull=paths.includes('full-'+previousId)||paths.includes('prefetched-'+previousId);
      if(!keepFull){
        const client=await old.match(new URL('launcher-'+previousId+'.js',base).href);
        if(client&&paths.some(path=>path.startsWith('cartridge-')))keepFull=!(await client.text()).includes('__arcadePart');
      }
      if(keepFull)for(const part of release.parts){
        const url=new URL(part.payload,base).href;
        if(await cache.match(url))continue;
        const response=await fetch(url,{cache:'reload',credentials:'omit',redirect:'error'});
        if(!response.ok)throw Error('Update transfer failed');
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength!==part.bytes||!(await verifyBytes(bytes,part.digest)))throw Error('Update verification failed');
        await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));
      }
      if(keepFull)await cache.put(new URL('prefetched-'+release.id,base).href,new Response('1'));
      break;
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
