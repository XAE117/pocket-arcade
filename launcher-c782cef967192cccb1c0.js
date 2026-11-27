'use strict';
(() => {
  const release = {"id":"c782cef967192cccb1c0","builtAt":1795743828559,"shell":"shell-c782cef967192cccb1c0.html","payload":"cartridge-8c7d6ff67f8aef5a1a6289ee7337be3b279214b9e12435a3f22b805f658c70e0.bin","bytes":17724165,"digest":"8c7d6ff67f8aef5a1a6289ee7337be3b279214b9e12435a3f22b805f658c70e0","codec":"gzip","parts":[{"payload":"cartridge-3925f781fea09f242da08099874c757f5bfee34cdb66e66c9f3a2956ca1598b5.bin","digest":"3925f781fea09f242da08099874c757f5bfee34cdb66e66c9f3a2956ca1598b5","bytes":43326499},{"payload":"cartridge-d3128b58d71145eb169be19b88ebf56fbbe38da66159f21148d2320f9a422b1c.bin","digest":"d3128b58d71145eb169be19b88ebf56fbbe38da66159f21148d2320f9a422b1c","bytes":683174}],"passwordAccess":{"v":1,"iterations":600000,"salt":"_8642n2zkkG0rabdI2rFrg","box":"yryRAs3zzESOXocOEhSuEMfvF1SPqBL8AhoPNmU4vhjTeNNuLVsV83QMX9kVLkpvfCIK0yXs1O_BqNAQ"}};
  const base = new URL('./', location.href);
  const scopePrefix = 'private-arcade:' + base.pathname + ':';
  const cacheName = scopePrefix + 'release-' + release.id;
  const storageKey = scopePrefix + 'invitation';
  const playedKey = scopePrefix + 'played';
  const shell = document.querySelector('main');
  const status = document.querySelector('#status');
  const hint = document.querySelector('#hint');
  const phaseLabel = document.querySelector('#phase-label');
  const transfer = document.querySelector('#transfer');
  const progress = document.querySelector('#progress');
  const transferDetail = document.querySelector('#transfer-detail');
  const form = document.querySelector('#unlock');
  const input = document.querySelector('#invite');
  const retry = document.querySelector('#retry');
  const play = document.querySelector('#play');
  const offlineButton=document.querySelector('#save-offline');
  const checkUpdateButton=document.querySelector('#check-update');
  let cache, decryptionKey, shellSetup, keySaved=false, activeLoad=null;
  let updateDialog, checkingUpdate, bootUpdate;
  let busy = false;
  let retryInvitation = '';
  let gameHtml = null;
  let requestedEntry = new URLSearchParams(location.search).get('m');

  function readSetting(name) {
    try { return localStorage.getItem(name); } catch { return null; }
  }
  function saveSetting(name, value) {
    try { localStorage.setItem(name, value); return true; } catch { return false; }
  }
  window.__arcadeRelease = release.id;
  window.__arcadeCheckUpdate = checkUpdate;
  window.__arcadeOfflineReady = false;

  async function registerWorker(target) {
    const url = new URL('sw.js', base);
    url.searchParams.set('v', target.id);
    url.searchParams.set('attempt', Date.now());
    // A legacy worker cannot reject a stale script at its own URL. Check the
    // same qualified URL before it can replace the current registration.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {cache:'no-store', credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', signal:controller.signal});
      if (!response.ok || response.url !== url.href) throw Error('worker');
      const source = await response.text();
      const config = source.match(/^const release = (\{[^\r\n]+\});$/m)?.[1];
      const candidate = JSON.parse(config || 'null');
      if (candidate?.id !== target.id || candidate.builtAt !== target.builtAt) throw Error('worker');
    } finally { clearTimeout(timeout); }
    return navigator.serviceWorker.register(url, {scope: base.href, updateViaCache:'none'});
  }

  async function publishedRelease() {
    const url = new URL('play.html', base);
    url.searchParams.set('arcade-check', Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
      if (!response.ok || !response.url || new URL(response.url).origin !== base.origin || !response.headers.get('Content-Type')?.includes('text/html')) throw Error('release');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const id = doc.querySelector('meta[name="private-arcade-build"]')?.content;
      const builtAt = Number(doc.querySelector('meta[name="private-arcade-build-time"]')?.content);
      if (!/^[a-f0-9]{20}$/.test(id) || !Number.isSafeInteger(builtAt) || builtAt <= 0 ||
          !doc.querySelector('script[src="./launcher-' + id + '.js"]')) throw Error('release');
      return {id, builtAt};
    } finally { clearTimeout(timeout); }
  }

  function identify(worker, message, timeout = 800) {
    if (!worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => finish(null), timeout);
      function finish(value) {
        clearTimeout(timer);
        channel.port1.close();
        resolve(value);
      }
      channel.port1.onmessage = event => finish(event.data);
      try { worker.postMessage(message, [channel.port2]); }
      catch { finish(null); }
    });
  }

  async function waitForRelease(target) {
    if (!('serviceWorker' in navigator)) return false;
    if (checkingUpdate?.id === target.id) return checkingUpdate.ready;
    if (checkingUpdate?.builtAt >= target.builtAt) return false;
    const ready = (async () => {
      const installedVersion = worker => identify(worker, 'arcade-installation');
      const isTarget = current => current?.id === target.id && current.builtAt === target.builtAt;
      const existing = await navigator.serviceWorker.getRegistration(base.href);
      const current = await installedVersion(existing?.active || navigator.serviceWorker.controller);
      if (isTarget(current) && existing?.active === navigator.serviceWorker.controller) return true;
      if (current?.builtAt >= target.builtAt && !isTarget(current)) return false;
      return new Promise(resolve => {
        const observed = new Set();
        const nudged = new Set();
        let reg, finished = false;
        const poll = setInterval(check, 1500);
        const timeout = setTimeout(() => finish(false), 75000);
        function finish(value) {
          if (finished) return;
          finished = true;
          clearInterval(poll);
          clearTimeout(timeout);
          reg?.removeEventListener('updatefound', observe);
          navigator.serviceWorker.removeEventListener('controllerchange', check);
          for (const worker of observed) worker.removeEventListener('statechange', check);
          resolve(value);
        }
        async function check() {
          const controlling = await installedVersion(navigator.serviceWorker.controller);
          if (finished) return;
          if (isTarget(controlling)) return finish(true);
          const waiting = reg?.waiting || existing?.waiting;
          if (waiting && isTarget(await installedVersion(waiting))) {
            if (!nudged.has(waiting)) {
              nudged.add(waiting);
              try { waiting.postMessage('arcade-activate'); } catch {}
            }
            // Chromium can hold a complete worker in waiting after a
            // history restore. A current worker can open its verified cache.
            if (controlling?.cachedNavigation) finish(true);
          } else if (observed.size && [...observed].every(worker => worker.state === 'redundant')) {
            finish(false);
          }
        }
        const hasTargetScript = worker => worker && new URL(worker.scriptURL).searchParams.get('v') === target.id;
        function observe() {
          const worker = reg?.installing || reg?.waiting;
          if (hasTargetScript(worker) && !observed.has(worker)) {
            observed.add(worker);
            worker.addEventListener('statechange', check);
          }
          check();
        }
        navigator.serviceWorker.addEventListener('controllerchange', check);
        if (isTarget(current) || hasTargetScript(existing?.waiting) || hasTargetScript(existing?.installing)) {
          reg = existing;
          reg?.addEventListener('updatefound', observe);
          observe();
          return;
        }
        registerWorker(target).then(result => {
          if (finished) return;
          reg = result;
          reg.addEventListener('updatefound', observe);
          observe();
          if (!reg.installing && !reg.waiting && new URL(reg.active?.scriptURL || base.href).searchParams.get('v') !== target.id) finish(false);
        }, () => finish(false));
      });
    })();
    checkingUpdate = {...target, ready};
    try { return await ready; } finally {
      if (checkingUpdate?.ready === ready) checkingUpdate = undefined;
    }
  }

  function canOpenUpdate() {
    return !activeLoad && (!input.isConnected || !input.value.trim()) && (!busy || keySaved);
  }

  function openUpdate() {
    location.replace(base.href);
  }

  async function checkUpdate(canReload = () => true) {
    if (updateDialog?.isConnected) return;
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    updateDialog = dialog;
    dialog.id = 'arcade-update-dialog';
    dialog.className = 'arcade-transfer-dialog';
    dialog.setAttribute('aria-labelledby','arcade-update-heading');
    dialog.innerHTML = '<h2 class="arcade-transfer-title" id="arcade-update-heading">Game updates</h2><p class="arcade-transfer-message" role="status" aria-live="polite"></p><progress class="arcade-transfer-meter" aria-label="Downloading and verifying game update" hidden></progress><div class="arcade-transfer-actions"><button type="button">Close</button><button type="button" data-update-retry hidden>Retry update</button><button type="button" data-update-apply hidden>Open update</button></div>';
    const message = dialog.querySelector('[role="status"]');
    const meter = dialog.querySelector('progress');
    const [close, retry, apply] = dialog.querySelectorAll('button');
    close.onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (previous?.isConnected) previous.focus({preventScroll:true});
    });
    dialog.addEventListener('keydown', e => e.stopPropagation());
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
    apply.onclick = () => {
      if (!canReload()) {
        message.textContent = 'Return to the arcade menu to open the update.';
        return;
      }
      if (!canOpenUpdate()) {
        message.textContent = 'Finish opening your invitation first, then check again.';
        return;
      }
      openUpdate();
    };
    async function run() {
      retry.hidden = true;
      if (navigator.onLine === false) {
        message.textContent = 'You’re offline. Connect to check for updates.';
        retry.hidden = false;
        return;
      }
      message.textContent = 'Checking for updates…';
      let target;
      try { target = await publishedRelease(); } catch {
        message.textContent = navigator.onLine === false
          ? 'You’re offline. Connect to check for updates.'
          : 'Couldn’t check for updates. Try again when connected.';
        retry.hidden = false;
        return;
      }
      if (target.id === release.id || target.builtAt <= release.builtAt) {
        message.textContent = 'You’re up to date.';
        return;
      }
      message.textContent = 'Preparing update…';
      meter.removeAttribute('value');
      meter.hidden = false;
      const expectedWorkerPath = new URL('sw.js', base).pathname;
      let verifiedCount = 0;
      let totalCount = 0;
      let progressWorker;
      const onProgress = event => {
        const data = event.data;
        if (!dialog.isConnected || !dialog.open) return;
        if (data?.type !== 'arcade-update-progress' || data.id !== target.id) return;
        if (progressWorker && progressWorker !== event.source) return;
        if (event.source?.state !== 'installing') return;
        let workerUrl;
        try { workerUrl = new URL(event.source.scriptURL); } catch { return; }
        if (workerUrl.origin !== base.origin || workerUrl.pathname !== expectedWorkerPath) return;
        if (workerUrl.searchParams.get('v') !== target.id) return;
        if ((workerUrl.searchParams.get('attempt') || '') !== data.attempt) return;
        if (!Number.isSafeInteger(data.total) || data.total < 1 || data.total > 128) return;
        if (!Number.isSafeInteger(data.completed) || data.completed < 1 || data.completed > data.total) return;
        if ((totalCount && data.total !== totalCount) || data.completed < verifiedCount) return;
        progressWorker = event.source;
        totalCount = data.total;
        verifiedCount = data.completed;
        meter.max = totalCount;
        meter.value = verifiedCount;
        const noun = totalCount === 1 ? 'file' : 'files';
        const finishing = verifiedCount === totalCount ? ' · Finishing update…' : '';
        message.textContent = verifiedCount + ' of ' + totalCount + ' game ' + noun + ' verified' + finishing;
      };
      navigator.serviceWorker?.addEventListener('message', onProgress);
      let ready;
      try { ready = await waitForRelease(target).catch(() => false); }
      finally { navigator.serviceWorker?.removeEventListener('message', onProgress); }
      meter.hidden = true;
      if (!ready) {
        message.textContent = 'The update couldn’t finish. Your current game is ready to play.';
        retry.hidden = false;
        if (dialog.open) retry.focus({preventScroll:true});
        return;
      }
      message.textContent = 'Update ready.';
      apply.hidden = false;
    }
    retry.onclick = run;
    await run();
  }

  async function checkOnLaunch() {
    if (!('serviceWorker' in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration(base.href);
      const installed = await identify(reg?.active, 'arcade-installation');
      if (installed?.builtAt > release.builtAt && installed.id !== release.id) return true;
      if (navigator.onLine === false) return false;
      const target = await publishedRelease();
      if (target.builtAt > release.builtAt && target.id !== release.id) return await waitForRelease(target);
      if (target.id === release.id && target.builtAt === release.builtAt) waitForRelease(release).catch(() => {});
      return false;
    } catch { return false; }
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

  // The password opens an envelope carried in the private invitation fragment.
  // The public site never receives the envelope or the family's password.
  const pendingGrantKey=scopePrefix+'pending-family-link';
  const grantPattern=/^f=1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{80}$/;
  let pendingGrant=readSetting(pendingGrantKey)||'';
  function invitationGrant(value){
    let fragment=value.trim();
    if (/^https?:\/\//i.test(fragment)){
      try{
        const url=new URL(fragment);
        if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return '';
        fragment=url.hash;
      }catch{return ''}
    }
    fragment=fragment.replace(/^#/,'');
    return grantPattern.test(fragment)?fragment:'';
  }
  function unpack64(text){
    return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  }
  function pack64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  const isHomeApp=()=>navigator.standalone===true || matchMedia('(display-mode: standalone)').matches;
  const isAppleBrowser=()=>!isHomeApp() && (navigator.standalone===false || /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  const enrollmentTTL=1800;
  const enrollmentBox={name:'arcade_enrollment_box',path:base.pathname+'__home-enrollment-box'};
  const enrollmentSeed={name:'arcade_enrollment_seed',path:base.pathname+'__home-enrollment-seed'};
  const enrollmentContext=new TextEncoder().encode(base.href+'|arcade-home-v1');

  function setEnrollmentCookie({name,path},value='') {
    document.cookie=name+'='+value+'; Path='+path+'; Max-Age='+(value?enrollmentTTL:0)+'; Secure; SameSite=Strict';
  }

  async function enrollmentController() {
    if (!('serviceWorker' in navigator)) return null;
    async function current() {
      const worker=navigator.serviceWorker.controller;
      const supported=await identify(worker,'arcade-enrollment-frame');
      return supported===true && worker===navigator.serviceWorker.controller ? worker : null;
    }
    const existing=await current();
    if(existing)return existing;
    let timeout;
    try{
      return await Promise.race([
        waitForRelease(release).then(current),
        new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),8500);})
      ]);
    }catch{return null;}
    finally{clearTimeout(timeout);}
  }

  function getEnrollmentCookie(worker,{name,path}) {
    // The worker serves these frame documents locally and never fetches
    // their paths. A real scoped Document is needed for the cookie getter.
    if(worker!==navigator.serviceWorker.controller)return Promise.resolve('');
    return new Promise(resolve=>{
      const frame=document.createElement('iframe');
      const timeout=setTimeout(()=>finish(''),1800);
      function finish(value) {
        clearTimeout(timeout);
        frame.remove();
        resolve(value);
      }
      frame.hidden=true;
      frame.title='Private Home Screen setup';
      frame.onload=()=>{
        try{
          const page=frame.contentDocument;
          if(!page?.querySelector('meta[name="arcade-enrollment-frame"]'))return finish('');
          const cookie=page.cookie.split(';').map(row=>row.trim()).find(row=>row.startsWith(name+'='));
          finish(cookie?.slice(name.length+1) || '');
        }catch{finish('');}
      };
      frame.onerror=()=>finish('');
      frame.src=path;
      document.body.append(frame);
    });
  }

  function clearHomeEnrollment() {
    try {
      setEnrollmentCookie(enrollmentBox);
      setEnrollmentCookie(enrollmentSeed);
    } catch {}
  }

  async function issueHomeEnrollment(token) {
    if (!isAppleBrowser() || !invitationKey(token)) return false;
    try {
      const seed=crypto.getRandomValues(new Uint8Array(32));
      const key=await crypto.subtle.importKey('raw',seed,'AES-GCM',false,['encrypt']);
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const expires=Date.now()+enrollmentTTL*1000;
      const data=new TextEncoder().encode(expires+':'+token);
      const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enrollmentContext},key,data));
      const box=pack64([...iv,...encrypted]), wrappingSeed=pack64(seed);
      // iPadOS 17.2+ copies site cookies at Add to Home Screen. The box and
      // its seed have disjoint paths and neither exposes the cartridge key.
      setEnrollmentCookie(enrollmentBox,box);
      setEnrollmentCookie(enrollmentSeed,wrappingSeed);
      return true;
    } catch { return false; }
  }

  async function readHomeEnrollment() {
    if (!isHomeApp()) return '';
    try {
      const worker=await enrollmentController();
      if(!worker)return '';
      const [encodedBox,encodedSeed]=await Promise.all([getEnrollmentCookie(worker,enrollmentBox),getEnrollmentCookie(worker,enrollmentSeed)]);
      if(!/^[A-Za-z0-9_-]{114}$/.test(encodedBox)||!/^[A-Za-z0-9_-]{43}$/.test(encodedSeed))return '';
      const box=unpack64(encodedBox);
      const key=await crypto.subtle.importKey('raw',unpack64(encodedSeed),'AES-GCM',false,['decrypt']);
      const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:box.subarray(0,12),additionalData:enrollmentContext},key,box.subarray(12));
      const [expires,token]=new TextDecoder().decode(data).split(':');
      const remaining=Number(expires)-Date.now();
      return remaining>0 && remaining<=enrollmentTTL*1000 ? invitationKey(token) : '';
    } catch { return ''; }
  }
  async function unseal(key,box){
    const bytes=unpack64(box);
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},key,bytes.subarray(12)));
  }
  async function familyToken(password){
    const [,salt,box]=pendingGrant.split('.');
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:unpack64(salt),iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const raw=await unseal(key,box);
    return pack64(raw);
  }
  async function unlockRootPassword(value){
    const password = value.normalize('NFKC').trim().toLowerCase();
    const access = release.passwordAccess;
    if (!password || password.length > 256 || access?.v !== 1) throw Error('password');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({
      name:'PBKDF2', salt:unpack64(access.salt), iterations:access.iterations, hash:'SHA-256',
    }, material, {name:'AES-GCM', length:256}, false, ['decrypt']);
    const box = unpack64(access.box);
    const raw = new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM', iv:box.subarray(0,12),
      additionalData:new TextEncoder().encode('Super Splash Bros. & Sisters family password v1'),
    }, key, box.subarray(12)));
    if (raw.length !== 32) throw Error('password');
    return pack64(raw);
  }
  function requestFamilyPassword(retry=false, empty=false){
    const detail=empty?'Type the family password, then tap Unlock game.':retry?'Check the password and try again.':'Enter the password once on this device.';
    show('invitation',retry?'Try the family password again':empty?'Password needed':'Enter the family password',detail);
    form.hidden=false;
    input.type='password';
    form.querySelector('label').textContent='Family password';
    input.placeholder='Family password';
    input.value='';
    input.setAttribute('aria-invalid',String(retry||empty));
    form.querySelector('button').textContent='Unlock game';
    input.focus({preventScroll:true});
  }

  function prepareFamilySharing(){
    const link = base.href;
    window.__arcadeShareFamily = async button => {
      try {
        if (navigator.share) {
          await navigator.share({title:'Super Splash Bros. & Sisters',url:link});
          return;
        }
        await navigator.clipboard.writeText(link);
        button.textContent='Game link copied';
      } catch (error) {
        if (error.name !== 'AbortError') window.prompt('Copy the game link',link);
      }
    };
  }

  async function readEnvelope(response, part, onProgress) {
    if(!response.ok)throw Error('download');
    const length=Number(response.headers.get('content-length'));
    if(length&&length!==part.bytes&&!response.headers.get('content-encoding'))throw Error('damage');
    let bytes;
    if(response.body?.getReader){
      bytes=new Uint8Array(part.bytes);
      const reader=response.body.getReader();
      let count=0,last=0;
      try{
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          if(count+value.length>bytes.length){await reader.cancel();throw Error('damage');}
          bytes.set(value,count);count+=value.length;
          if(count-last>=65536){onProgress?.(count);last=count;}
        }
      }finally{reader.releaseLock();}
      if(count!==bytes.length)throw Error('damage');
    }else bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==part.bytes)throw Error('damage');
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    if(Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')!==part.digest)throw Error('damage');
    return bytes;
  }
  async function openPart(part, signal, first=false, update){
    const url=new URL(part.payload,base).href;
    let bytes, stored=false;
    if(cache)try{
      const candidate=await cache.match(url);
      if(candidate){bytes=await readEnvelope(candidate,part);stored=true;}
    }catch{try{await cache.delete(url);}catch{}}
    if(!bytes&&cache)try{
      const candidate=await caches.match(url);
      if(candidate)bytes=await readEnvelope(candidate,part);
    }catch{}
    signal?.throwIfAborted();
    if(!bytes){
      update?.(0,part.bytes);
      if(first){show('download','Downloading the game','Keep this tab open while the files arrive.');downloadProgress(0);}
      let response;
      try{response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal});}
      catch(e){if(signal?.aborted)throw e;throw Error('download');}
      try{bytes=await readEnvelope(response,part,first?downloadProgress:count=>update?.(count,part.bytes));}
      catch(error){if(signal?.aborted||error.message==='damage')throw error;throw Error('download');}
    }
    signal?.throwIfAborted();
    if(first)show('verify','Verifying game files');
    if(first)show('unlocking','Checking your invitation');
    let plain;
    try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},decryptionKey,bytes.subarray(12));}
    catch{throw Error(first?'invite':'damage');}
    if(first)show('opening','Preparing the arcade');
    let text;
    try{text=release.codec==='gzip'?await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(plain);}
    catch{throw Error('damage');}
    let value=text;
    if(part!==release)try{value=JSON.parse(text);}catch{throw Error('damage');}
    signal?.throwIfAborted();
    if(cache)try{
      if(!stored)await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));
      const index=release.parts.indexOf(part);
      if(index>=0)await cache.put(new URL('part-'+index+'-'+release.id,base).href,new Response(part.digest));
    }catch{}
    signal?.throwIfAborted();
    return value;
  }
  async function importInvitation(token){
    const encoded=token.replace(/-/g,'+').replace(/_/g,'/');
    const raw=Uint8Array.from(atob(encoded+'='),c=>c.charCodeAt(0));
    if(btoa(String.fromCharCode(...raw)).replace(/=+$/,'')!==encoded)throw Error('invite');
    return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  }
  // Install the exact shell that opens these bytes. Recheck the active worker
  // on every online launch so a future family release can arrive in one visit.
  async function prepareOffline(cache) {
    if (!cache || !('serviceWorker' in navigator)) return false;
    const shellUrl = new URL(release.shell, base).href;
    const ready = await waitForRelease(release);
    return ready && !!(await cache.match(shellUrl));
  }

  const fullMarker=new URL('full-'+release.id,base).href;
  const prefetchedMarker=new URL('prefetched-'+release.id,base).href;
  async function hasAll(){
    if(!cache||!keySaved)return false;
    if(!(await cache.match(fullMarker))&&!(await cache.match(prefetchedMarker)))return false;
    const urls=[release.shell,...[release,...release.parts].map(p=>p.payload)];
    for(const url of urls)if(!(await cache.match(new URL(url,base).href)))return false;
    return true;
  }
  function interactiveLoad(work, saving=false, title='Opening game files'){
    if(activeLoad)return Promise.resolve(false);
    const dialog=document.createElement('dialog'),previous=document.activeElement;
    dialog.className='arcade-transfer-dialog';
    dialog.setAttribute('aria-labelledby','arcade-transfer-heading');
    dialog.innerHTML='<h2 class="arcade-transfer-title" id="arcade-transfer-heading"></h2><p class="arcade-transfer-message" role="status" aria-live="polite"></p><progress class="arcade-transfer-meter" aria-label="File download" hidden></progress><div class="arcade-transfer-actions"><button type="button">Cancel</button><button type="button" hidden>Retry</button></div>';
    dialog.querySelector('h2').textContent=saving?'Save for offline play':title;
    const message=dialog.querySelector('p'),meter=dialog.querySelector('progress'),[cancel,again]=dialog.querySelectorAll('button');
    document.body.append(dialog);dialog.showModal();cancel.focus();
    const controller=new AbortController();activeLoad=controller;
    const tag=crypto.randomUUID();
    let pushed=false;
    try{history.pushState({...history.state,arcadeLoad:tag},'');pushed=true;}catch{}
    return new Promise(resolve=>{
      let ended=false;
      const finish=ok=>{
        if(ended)return;ended=true;controller.abort();
        removeEventListener('popstate',back);
        function close(){
          clearTimeout(fallback);removeEventListener('popstate',close);
          activeLoad=null;dialog.close();dialog.remove();
          if(previous?.isConnected)previous.focus({preventScroll:true});
          resolve(ok);
        }
        let fallback;
        if(pushed&&history.state?.arcadeLoad===tag){
          addEventListener('popstate',close,{once:true});
          fallback=setTimeout(close,800);history.back();
        }else close();
      };
      const back=()=>finish(false);
      addEventListener('popstate',back);
      dialog.addEventListener('keydown',e=>{
        e.stopPropagation();
        if(e.key==='Escape'){e.preventDefault();finish(false);}
      });
      cancel.onclick=()=>finish(false);
      dialog.oncancel=e=>{e.preventDefault();finish(false);};
      async function run(){
        again.hidden=true;meter.hidden=true;message.textContent=saving?'Checking saved game files…':'Checking this device…';
        try{
          const result=await work(controller.signal,(bytes,total)=>{if(ended)return;meter.max=total;meter.value=bytes;meter.hidden=false;message.textContent=sizeText(bytes)+' of '+sizeText(total);});
          if(ended)return;
          if(saving){meter.hidden=true;message.textContent='Ready to play offline';cancel.textContent='Done';cancel.onclick=()=>finish(true);}
          else if(result){result();finish(true);}
          else finish(true);
        }catch(error){
          if(ended)return;meter.hidden=true;
          message.textContent=error.message==='storage'?'This device could not save the full game. Check available storage or reopen the invitation in Safari.':error.message==='damage'?'The file could not be verified. Retry to get a fresh copy.':'The transfer was interrupted. Check your connection and retry.';
          again.hidden=false;again.focus();
        }
      }
      again.onclick=run;run();
    });
  }
  function installLoader(){
    window.__arcadePart=(index,apply,title)=>{
      if(!Number.isInteger(index)||!release.parts[index]||typeof apply!=='function')return Promise.resolve(false);
      return interactiveLoad(async(signal,update)=>{
        const value=await openPart(release.parts[index],signal,false,update);
        return ()=>apply(value);
      },false,title);
    };
    window.__arcadeSaveOffline=()=>interactiveLoad(async(signal,update)=>{
      if(!keySaved||!cache)throw Error('storage');
      if(!(await shellSetup)){shellSetup=prepareOffline(cache).catch(()=>false);if(!(await shellSetup))throw Error('storage');}
      // The invitation was authenticated before entering. Recheck the actual
      // cached core, in case storage was evicted during play.
      const coreUrl=new URL(release.payload,base).href;
      let coreValid=false;
      try{const stored=await cache.match(coreUrl);if(stored){await readEnvelope(stored,release);coreValid=true;}}catch{}
      if(!coreValid)await openPart(release,signal,false,update);
      for(const part of release.parts)await openPart(part,signal,false,update);
      signal.throwIfAborted();
      for(const part of [release,...release.parts])if(!(await cache.match(new URL(part.payload,base).href)))throw Error('storage');
      await cache.put(fullMarker,new Response('1'));
      if(!(await hasAll()))throw Error('storage');
      window.__arcadeOfflineReady=true;
      if(gameHtml!==null){offlineButton.hidden=true;show('offline','Ready to play offline','This device has saved the full game.');}
    },true);
  }
  async function enter() {
    if (gameHtml === null) return;
    const html = gameHtml;
    gameHtml = null;
    saveSetting(playedKey, '1');
    const appSettings = [
      'meta[name="referrer"]', 'meta[name="robots"]',
      'meta[name="apple-mobile-web-app-capable"]', 'meta[name="apple-mobile-web-app-title"]',
      'meta[name="private-arcade-build"]', 'meta[name="private-arcade-build-time"]', 'link[rel="canonical"]', 'link[rel="manifest"]',
      'link[rel="apple-touch-icon"]', 'link[rel="icon"]'
    ].map(selector => [selector, document.head.querySelector(selector).cloneNode(true)]);
    // Run the original document at the current top-level origin. All game
    // scripts, local saves, user gestures, fullscreen and reload keep their semantics.
    document.open();
    installLoader();
    document.write(html);
    document.close();
    for (const [selector, setting] of appSettings) {
      const previous = document.head.querySelector(selector);
      if (previous) previous.replaceWith(setting);
      else document.head.append(setting);
    }
    if (requestedEntry === '2' || requestedEntry === '3') {
      if(!(await window.CupModeAssets?.prepare('race')))return;
      document.querySelector('[data-arcade-entry="2"]')?.click();
      if (requestedEntry === '3') document.querySelector('[data-arcade-entry="3"]')?.click();
    } else if(requestedEntry === '4') {
      document.querySelector('[data-arcade-entry="4"]')?.click();
    } else if(requestedEntry === '5') {
      document.querySelector('[data-arcade-entry="5"]')?.click();
      document.querySelector('[data-stop="6"]')?.click();
      document.querySelector('[data-stage-pick="6"]')?.click();
    } else if(requestedEntry === '6' || requestedEntry === '7') {
      document.querySelector('[data-arcade-entry="'+requestedEntry+'"]')?.click();
    }
  }

  async function unlock(invitation, submitted=false) {
    if (busy) return;
    const suppliedGrant = invitationGrant(invitation);
    if (suppliedGrant) {
      pendingGrant = suppliedGrant;
      saveSetting(pendingGrantKey,suppliedGrant);
      requestFamilyPassword();
      return;
    }
    let token = invitationKey(invitation);
    if (!token) {
      if (!submitted || !invitation.trim()) {
        requestFamilyPassword(false, submitted);
        return;
      }
      busy = true;
      try {
        // Keep older password-protected invitations valid while also allowing
        // the current family password on an existing saved invitation screen.
        if (grantPattern.test(pendingGrant)) token = await familyToken(invitation).catch(() => '');
        if (!token) token = await unlockRootPassword(invitation);
      } catch {
        requestFamilyPassword(true);
        return;
      } finally {
        busy = false;
      }
    }
    if (/^https?:\/\//i.test(invitation.trim())) {
      const link = new URL(invitation.trim());
      if (link.origin === base.origin && (link.pathname === base.pathname || link.pathname === base.pathname + 'play.html')) {
        requestedEntry = link.searchParams.get('m');
      }
    }
    busy = true;
    retryInvitation = '';
    retry.hidden = true;
    form.hidden = true;
    input.value = '';
    show('opening','Opening the arcade');
    try {
      if (!window.isSecureContext || !window.crypto || !crypto.subtle) throw new Error('security');
      if (release.codec === 'gzip' && (typeof DecompressionStream !== 'function' || !Blob.prototype.stream)) throw new Error('version');
      try { cache = await caches.open(cacheName); } catch {}
      decryptionKey=await importInvitation(token);
      gameHtml=await openPart(release,undefined,true);
      keySaved=saveSetting(storageKey,token);
      if(isHomeApp() && keySaved)clearHomeEnrollment();
      if(isAppleBrowser())await issueHomeEnrollment(token);
      pendingGrant='';
      try{localStorage.removeItem(pendingGrantKey)}catch{}
      prepareFamilySharing();
      shellSetup=prepareOffline(cache).catch(()=>false);
      installLoader();
      if (keySaved && await bootUpdate && gameHtml !== null && canOpenUpdate()) {
        openUpdate();
        return;
      }
      window.__arcadeOfflineReady=await hasAll().catch(()=>false);
      show('ready','Ready to play','Other game files open as needed. Save the full game for offline play.');
      play.hidden=false;offlineButton.hidden=!cache||!keySaved;
      if(readSetting(playedKey)==='1'){enter();return;}
      shellSetup.then(controlled=>{
        if(window.__arcadeOfflineReady&&controlled&&gameHtml!==null){
          offlineButton.hidden=true;show('offline','Ready to play offline','This device has saved the full game.');
        }
      }).catch(()=>{});
      play.focus({preventScroll:true});
    } catch (error) {
      busy = false;
      const messages = {
        invite:['Couldn’t unlock the game','Enter the family password and try again.'],
        damage:['Download didn’t finish','Tap Retry download to get a fresh copy.'],
        download:['Download interrupted','Check your connection, then tap Retry download.'],
        security:['Open the game securely','Use the HTTPS game link in Safari.'],
        version:['Browser update needed','Use a current browser or update iPadOS to open the game.']
      };
      const [title,detail]=messages[error.message]||['Couldn’t open the game','Reconnect and try again.'];
      show('error',title,detail);
      const canRetry = error.message === 'damage' || error.message === 'download';
      retryInvitation = canRetry ? token : '';
      retry.hidden = !canRetry;
      form.hidden = canRetry;
      (canRetry ? retry : input).focus({preventScroll:true});
    }
  }

  offlineButton.addEventListener('click',()=>window.__arcadeSaveOffline());
  checkUpdateButton?.addEventListener('click',()=>checkUpdate());
  play.addEventListener('click', enter);
  retry.addEventListener('click', () => { if (retryInvitation) unlock(retryInvitation); });
  input.addEventListener('input',()=>input.removeAttribute('aria-invalid'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value=input.value;
    input.value='';
    unlock(value,true);
  });
  const supplied = location.hash;
  if (supplied || location.pathname === base.pathname + 'play.html') {
    // Remove the credential from the visible URL before downloads or game scripts.
    history.replaceState(history.state, '', base.pathname);
  }
  // Allow a verified update to win a cold launch, then proceed with this
  // version if installation is slower. An already opened game stays in place.
  let launchTimeout;
  bootUpdate = Promise.race([checkOnLaunch(), new Promise(resolve => {
    launchTimeout = setTimeout(() => resolve(false), 4500);
  })]).finally(() => clearTimeout(launchTimeout));
  const knownInvitation=supplied || readSetting(storageKey);
  if(knownInvitation)unlock(knownInvitation);
  else if(isHomeApp()){
    show('opening','Opening the arcade');
    readHomeEnrollment().then(unlock);
  }else unlock('');
})();
