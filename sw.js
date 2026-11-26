'use strict';
const release = {"id":"5dc4b7643c90bea7a3f0","builtAt":1795730670563,"shell":"shell-5dc4b7643c90bea7a3f0.html","payload":"cartridge-bdb948db1001c2695e79213e60a4a4e9a2f577c79e19225b52427d52d36ec3af.bin","bytes":15481647,"digest":"bdb948db1001c2695e79213e60a4a4e9a2f577c79e19225b52427d52d36ec3af","codec":"gzip","parts":[{"payload":"cartridge-1013530f1681e438ae718f723569b464a29bebeb834fb0c7168f68db6e8b8e82.bin","digest":"1013530f1681e438ae718f723569b464a29bebeb834fb0c7168f68db6e8b8e82","bytes":43023962},{"payload":"cartridge-9dc52bff6f810582f3928a7cf2ecc2c79847d9c76ca5779b3eb953a887c376a1.bin","digest":"9dc52bff6f810582f3928a7cf2ecc2c79847d9c76ca5779b3eb953a887c376a1","bytes":604047}],"assets":[{"file":"shell-5dc4b7643c90bea7a3f0.html","digest":"d1c21d5f13538e0cc0bc150f263c64fb8c8ba54e2e6f033a39e202ad2e92e632","type":"text/html; charset=utf-8"},{"file":"launcher-5dc4b7643c90bea7a3f0.js","digest":"762aa304b5a261b326baed2d21019cde45dde9463034da86c5deb77842053ba7","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"f0b7796b296e1a67b6e3771944ed6ef395c3ef1199042aa25d6f5f0bd0d72424","type":"image/png"},{"file":"icon-512.png","digest":"45a93567bf56a70b9286f0ad3937dc2185bdc01fa1974ef822d256edbefd973d","type":"image/png"}]};
const base = new URL('./', self.location.href);
const prefix = 'private-arcade:' + base.pathname + ':release-';
const cacheName = prefix + release.id;
const shellUrl = new URL(release.shell, base).href;
const payloadUrl = new URL(release.payload, base).href;
const partUrls=[payloadUrl,...release.parts.map(part=>new URL(part.payload,base).href)];
const staticUrls = release.assets.map(asset => new URL(asset.file, base).href);
const enrollmentPaths=['__home-enrollment-box','__home-enrollment-seed'].map(path=>base.pathname+path);
const builtMarker = id => new URL('installed-' + id, base).href;
const requestedId = self.location.searchParams
  ? self.location.searchParams.get('v')
  : new URL(self.location.href).searchParams.get('v');

async function verifyBytes(bytes, expected) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('') === expected;
}

async function getStaticAsset(asset) {
  const url = new URL(asset.file, base);
  const online = new URL(url);
  online.searchParams.set('arcade-build', release.id);
  const response = await fetch(online, {cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer'});
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

async function readInstalled(cache, id) {
  const marker = await cache.match(builtMarker(id));
  if (!marker) return null;
  try {
    const data = await marker.json();
    if (data.id === id && Number.isSafeInteger(data.builtAt)) return data;
  } catch {}
  return null;
}

self.addEventListener('install', event => {
  event.waitUntil(installRelease());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Cleanup is best-effort. It must never prevent a verified worker taking
    // control after installation, particularly after Safari storage purges.
    try {
      const older = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
      const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
      if (clients.length <= 1) await Promise.all(older.slice(0, -2).map(name => caches.delete(name)));
    } catch {}
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if (event.data === 'arcade-release') event.ports[0]?.postMessage(release.id);
  if (event.data === 'arcade-enrollment-frame') event.ports[0]?.postMessage(true);
  if (event.data === 'arcade-activate') event.waitUntil(self.skipWaiting());
  if (event.data === 'arcade-installation') {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      const installed = await readInstalled(cache, release.id);
      event.ports[0]?.postMessage(installed && {...installed,cachedNavigation:true});
    })());
  }
});

async function installRelease() {
    if (requestedId && requestedId !== release.id) throw Error('The requested release is not at this origin yet');
    const cache = await caches.open(cacheName);
    let keepFull = false;
    // Keep a prior complete offline installation usable across an update.
    // Legacy releases held all modes in one verified cartridge. A split
    // release carries a marker only after its launcher authenticated every part.
    for(const previous of (await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName).reverse()){
      const old=await caches.open(previous);
      const previousId=previous.slice(prefix.length);
      const installed=await readInstalled(old,previousId);
      if (installed && installed.builtAt >= release.builtAt) {
        throw Error('A newer verified release already exists');
      }
      const paths=(await old.keys()).map(request=>new URL(request.url).pathname.slice(base.pathname.length));
      if(!paths.includes('shell-'+previousId+'.html'))continue;
      if(paths.includes('full-'+previousId)||paths.includes('prefetched-'+previousId))keepFull=true;
      else if(!keepFull){
        const client=await old.match(new URL('launcher-'+previousId+'.js',base).href);
        if(client&&paths.some(path=>path.startsWith('cartridge-')))keepFull=!(await client.text()).includes('__arcadePart');
      }
    }
    const required = keepFull ? [release, ...release.parts] : [release];
    const pending = [];
    // Finish every download before writing any of this install's large bodies.
    // A rejected install can leave WebKit's next worker with missing cache entries.
    for (const part of required) {
      const url = new URL(part.payload, base).href;
      const stored = await cache.match(url);
      if (stored && await verifyBytes(await stored.arrayBuffer(), part.digest)) continue;
      const response = await fetch(url, {cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy:'no-referrer'});
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
    await cache.put(builtMarker(release.id), new Response(JSON.stringify({id:release.id,builtAt:release.builtAt})));
    await self.skipWaiting();
}

async function verifiedCache(id) {
  if (!(await caches.keys()).includes(prefix+id)) return null;
  const cache = await caches.open(prefix+id);
  const installation = await readInstalled(cache, id);
  return installation && {cache,...installation};
}

async function newestLocalShell(cache) {
  let builtAt = release.builtAt;
  let shell = await cache.match(shellUrl);
  for (const name of await caches.keys()) {
    if (!name.startsWith(prefix) || name === cacheName) continue;
    const id = name.slice(prefix.length);
    const candidate = await verifiedCache(id);
    if (!candidate || candidate.builtAt <= builtAt) continue;
    const replacement = await candidate.cache.match(new URL('shell-'+id+'.html',base).href);
    if (replacement) {
      builtAt = candidate.builtAt;
      shell = replacement;
    }
  }
  return {shell,builtAt};
}

async function onlineShell() {
  const url = new URL('play.html', base);
  url.searchParams.set('arcade-nav', Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    if (!response.ok || !response.url || new URL(response.url).origin !== base.origin || !response.headers.get('Content-Type')?.includes('text/html')) return null;
    const bytes = await response.arrayBuffer();
    const html = new TextDecoder().decode(bytes);
    const id = html.match(/<meta name="private-arcade-build" content="([a-f0-9]{20})">/)?.[1];
    const builtAt = Number(html.match(/<meta name="private-arcade-build-time" content="(\d+)">/)?.[1]);
    if (id === release.id && builtAt === release.builtAt) {
      const asset = release.assets.find(item => item.file === release.shell);
      if (await verifyBytes(bytes, asset.digest)) {
        return new Response(bytes, {headers:{'Content-Type':asset.type,'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'}});
      }
    }
    if (!id || !Number.isSafeInteger(builtAt) || builtAt <= release.builtAt) return null;
    const candidate = await verifiedCache(id);
    if (candidate?.builtAt === builtAt) return await candidate.cache.match(new URL('shell-'+id+'.html',base).href);
  } catch {} finally { clearTimeout(timer); }
  return null;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin) return;
  if (request.mode === 'navigate' && enrollmentPaths.includes(url.pathname)) {
    event.respondWith(new Response('<!doctype html><meta name="arcade-enrollment-frame" content="local">', {headers:{
      'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'",'Referrer-Policy':'no-referrer'
    }}));
    return;
  }
  const navigation = request.mode === 'navigate' && [base.pathname,base.pathname+'index.html',base.pathname+'play.html'].includes(url.pathname);
  const launcherId = url.pathname.startsWith(base.pathname) && url.pathname.slice(base.pathname.length).match(/^launcher-([a-f0-9]{20})\.js$/)?.[1];
  if (!navigation && !launcherId && !staticUrls.includes(url.href) && !partUrls.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // A Home Screen launch uses an online release only after its installer
    // verified the files. During an outage or partial deploy the verified
    // local shell can still open the complete saved game.
    if (navigation) {
      const local = await newestLocalShell(cache);
      if (local.builtAt > release.builtAt) return local.shell;
      return (await onlineShell()) || local.shell || fetch(request);
    }
    if (launcherId && launcherId !== release.id) {
      const candidate = await verifiedCache(launcherId);
      const cached = await candidate?.cache.match(request);
      if (cached) return cached;
    }
    // The client uses no-store only after independently rejecting a local copy.
    if (request.cache === 'no-store' && partUrls.includes(url.href)) return fetch(request);
    return (await cache.match(request)) || fetch(request);
  })());
});
