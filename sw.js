'use strict';
const release = {"id":"d62451533cefbfd4538b","builtAt":1795749279752,"shell":"shell-d62451533cefbfd4538b.html","payload":"cartridge-dd6df8ef18d11561aaa17d43614a9a676b0bbf023d209833d03fac6542a64dd8.bin","bytes":17740117,"digest":"dd6df8ef18d11561aaa17d43614a9a676b0bbf023d209833d03fac6542a64dd8","codec":"gzip","parts":[{"payload":"cartridge-3925f781fea09f242da08099874c757f5bfee34cdb66e66c9f3a2956ca1598b5.bin","digest":"3925f781fea09f242da08099874c757f5bfee34cdb66e66c9f3a2956ca1598b5","bytes":43326499},{"payload":"cartridge-d3128b58d71145eb169be19b88ebf56fbbe38da66159f21148d2320f9a422b1c.bin","digest":"d3128b58d71145eb169be19b88ebf56fbbe38da66159f21148d2320f9a422b1c","bytes":683174}],"assets":[{"file":"shell-d62451533cefbfd4538b.html","digest":"39c6a4f0e8bc38454358ce64df72296c212d277eaf1e88054c725ff8a0312d27","type":"text/html; charset=utf-8"},{"file":"launcher-d62451533cefbfd4538b.js","digest":"9a7ff542e60ce5431facdc04a4d2537591c84f381291347a1937ec12827442d0","type":"text/javascript; charset=utf-8"},{"file":"app.webmanifest","digest":"13c25d4ecbd02a2c7e842b66fe5621ba6d7c33c8ca1189e3859fc2194e84660c","type":"application/manifest+json"},{"file":"icon-192.png","digest":"a18a5e350116cfd9beafd1ec7e23ae65bbc8f0921ef000427ca1717d1660697e","type":"image/png"},{"file":"icon-512.png","digest":"67e2f7f9fe8c2a74a1e50427eded1efcedcdf8ddf2b4b23991e8d9a001ebd90a","type":"image/png"}]};
const base = new URL('./', self.location.href);
const prefix = 'private-arcade:' + base.pathname + ':release-';
const cacheName = prefix + release.id;
const shellUrl = new URL(release.shell, base).href;
const payloadUrl = new URL(release.payload, base).href;
const partUrls=[payloadUrl,...release.parts.map(part=>new URL(part.payload,base).href)];
const staticUrls = release.assets.map(asset => new URL(asset.file, base).href);
const enrollmentPaths=['__home-enrollment-box','__home-enrollment-seed'].map(path=>base.pathname+path);
const builtMarker = id => new URL('installed-' + id, base).href;
const fullMarker = id => new URL('full-' + id, base).href;
const prefetchedMarker = id => new URL('prefetched-' + id, base).href;
const partMarker = (index, id) => new URL('part-' + index + '-' + id, base).href;
const requestedId = self.location.searchParams
  ? self.location.searchParams.get('v')
  : new URL(self.location.href).searchParams.get('v');

async function verifyBytes(bytes, expected) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('') === expected;
}

async function verifiedPart(response, part) {
  if (!response?.ok || !part || !Number.isSafeInteger(part.bytes) ||
      !/^[a-f0-9]{64}$/.test(part.digest) || part.payload !== 'cartridge-' + part.digest + '.bin') return null;
  const bytes = await response.arrayBuffer();
  return bytes.byteLength === part.bytes && await verifyBytes(bytes, part.digest) ? bytes : null;
}

function binaryResponse(bytes) {
  return new Response(bytes, {headers: {'Content-Type': 'application/octet-stream'}});
}

async function priorCartridges(cache, id) {
  if (!(await cache.match(new URL('shell-' + id + '.html', base).href))) return null;
  const client = await cache.match(new URL('launcher-' + id + '.js', base).href);
  if (!client) return null;
  const source = await client.text();
  const data = source.match(/^\s*const release = ({.*});$/m)?.[1];
  if (!data) return null;
  try {
    const config = JSON.parse(data);
    if (config.id !== id || typeof config.payload !== 'string') return null;
    const parts = Array.isArray(config.parts) ? config.parts : [];
    const full = !source.includes('__arcadePart') || !!(await cache.match(fullMarker(id))) ||
      !!(await cache.match(prefetchedMarker(id)));
    return {core: config, parts, full};
  } catch { return null; }
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

// These messages contain only public release/attempt identifiers and verified file counts.
async function reportInstallProgress(completed,total) {
  try {
    const attempt = new URL(self.location.href).searchParams.get('attempt') || '';
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of clients) {
      client.postMessage({type:'arcade-update-progress', id:release.id, attempt, completed, total});
    }
  } catch {} // A missing listener must never change installation or recovery.
}

async function installRelease() {
    if (requestedId && requestedId !== release.id) throw Error('The requested release is not at this origin yet');
    const cache = await caches.open(cacheName);
    let keepFull = false;
    const keepParts = new Set();
    // Match old cartridge URLs from the installed launcher. Releases before
    // per-mode markers saved exactly the same verified bodies on first visit.
    for(const previous of (await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName).reverse()){
      const old=await caches.open(previous);
      const previousId=previous.slice(prefix.length);
      const installed=await readInstalled(old,previousId);
      if (installed && installed.builtAt >= release.builtAt) {
        throw Error('A newer verified release already exists');
      }
      if (keepFull) continue;
      const prior = await priorCartridges(old, previousId);
      if (!prior) continue;
      const modeIndices = new Set();
      for (const [index, part] of prior.parts.entries()) {
        if (!release.parts[index] && !prior.full) continue;
        if (keepParts.has(index) && !prior.full) continue;
        const marker = await old.match(partMarker(index, previousId));
        const proven = marker && await marker.text() === part?.digest;
        const stored = part?.payload && await old.match(new URL(part.payload, base).href);
        if (stored && ((!prior.full && proven) || await verifiedPart(stored, part))) {
          modeIndices.add(index);
          if (release.parts[index]) keepParts.add(index);
        }
      }
      if (prior.full && modeIndices.size === prior.parts.length) {
        const core = await old.match(new URL(prior.core.payload, base).href);
        keepFull = !!(await verifiedPart(core, prior.core));
      }
    }
    const parts = release.parts.filter((_, index) => keepFull || keepParts.has(index));
    const required = [release, ...parts];
    const pending = [];
    // Finish every download before writing any of this install's large bodies.
    // A rejected install can leave WebKit's next worker with missing cache entries.
    let verifiedCount = 0;
    for (const part of required) {
      const url = new URL(part.payload, base).href;
      if (await verifiedPart(await cache.match(url), part)) {
        await reportInstallProgress(++verifiedCount, required.length);
        continue;
      }
      const stored = await caches.match(url);
      const bytes = await verifiedPart(stored, part) || await verifiedPart(await fetch(url, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy:'no-referrer'
      }), part);
      if (!bytes) throw new Error('Cartridge verification failed');
      pending.push({url, bytes});
      await reportInstallProgress(++verifiedCount, required.length);
    }
    const assets = await Promise.all(release.assets.map(getStaticAsset));
    for (const {url, bytes} of pending) {
      await cache.put(url, binaryResponse(bytes));
    }
    await Promise.all(assets.map(([url, response]) => cache.put(url, response)));
    for (const part of required) {
      const stored = await cache.match(new URL(part.payload, base).href);
      if (!(await verifiedPart(stored, part))) {
        throw new Error('Offline installation incomplete');
      }
    }
    for (const [index, part] of release.parts.entries()) {
      if (keepFull || keepParts.has(index)) await cache.put(partMarker(index, release.id), new Response(part.digest));
    }
    if (keepFull) await cache.put(fullMarker(release.id), new Response('1'));
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
