'use strict';
(() => {
  const release = {"id":"4c0cff2fa999c0b8feee","shell":"shell-4c0cff2fa999c0b8feee.html","payload":"cartridge-f43e48eb8eefcf1dc0f0739d18bedc8c46ddae0fcf4e09fb70e5025682c378f8.bin","bytes":15258022,"digest":"f43e48eb8eefcf1dc0f0739d18bedc8c46ddae0fcf4e09fb70e5025682c378f8","codec":"gzip","parts":[{"payload":"cartridge-c269a19740c0e776d487d6b46c8bbf9ecfa4deaf47244c1173098ce4a6871331.bin","digest":"c269a19740c0e776d487d6b46c8bbf9ecfa4deaf47244c1173098ce4a6871331","bytes":43023962},{"payload":"cartridge-853b8e2f3f962314f13ba7b49cf52bcab984b08757a866b5b554f76d69b47bf7.bin","digest":"853b8e2f3f962314f13ba7b49cf52bcab984b08757a866b5b554f76d69b47bf7","bytes":604047}]};
  const base = new URL('./', location.href);
  const scopePrefix = 'private-arcade:' + base.pathname + ':';
  const cacheName = scopePrefix + 'release-' + release.id;
  const storageKey = scopePrefix + 'invitation';
  const playedKey = scopePrefix + 'played';
  const payloadUrl = new URL(release.payload, base).href;
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
  let cache, decryptionKey, shellSetup, keySaved=false, activeLoad=null;
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
    let bytes, stored;
    if(cache)try{
      stored=await cache.match(url);
      if(stored)bytes=await readEnvelope(stored,part);
    }catch{try{await cache.delete(url);}catch{}stored=null;}
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
    if(!stored&&cache)try{await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));}catch{}
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
    const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.href, updateViaCache: 'none'
    });
    const shellUrl = new URL(release.shell, base).href;
    if (registration.active) registration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    // The shell can exist before the installer takes control. Ask the worker
    // actually serving this tab which release it can reopen.
    return new Promise(resolve=>{
      let finished=false;
      function end(value){
        if(finished)return;
        finished=true;clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange',check);
        resolve(value);
      }
      async function check(){
        const worker=navigator.serviceWorker.controller;
        if(!worker||!(await cache.match(shellUrl)))return;
        const channel=new MessageChannel();
        const cleanup=setTimeout(()=>channel.port1.close(),1500);
        channel.port1.onmessage=event=>{
          clearTimeout(cleanup);channel.port1.close();
          if(event.data===release.id&&navigator.serviceWorker.controller===worker)end(true);
        };
        worker.postMessage('arcade-release',[channel.port2]);
      }
      const timeout=setTimeout(()=>end(false),25000);
      navigator.serviceWorker.addEventListener('controllerchange',check);
      check().catch(()=>end(false));
    });
  }

  const fullMarker=new URL('full-'+release.id,base).href;
  async function hasAll(){
    if(!cache||!keySaved)return false;
    const urls=[fullMarker,release.shell,...[release,...release.parts].map(p=>p.payload)];
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
      'meta[name="private-arcade-build"]', 'link[rel="canonical"]', 'link[rel="manifest"]',
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
    }
  }

  async function unlock(invitation) {
    if (busy) return;
    const token = invitationKey(invitation);
    if (!token) {
      const homeIcon = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      const guidance = homeIcon
        ? 'Open this icon while connected and paste the complete family link. Then choose Save full game for offline play.'
        : 'Paste the complete invitation link your family shared with you.';
      show('invitation','Open your invitation',guidance);
      form.hidden = false;
      return;
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
      shellSetup=prepareOffline(cache).catch(()=>false);
      installLoader();
      show('ready','Ready to play','Other game files open as needed. Save the full game for offline play.');
      play.hidden=false;offlineButton.hidden=!cache||!keySaved;
      if(readSetting(playedKey)==='1'){enter();return;}
      Promise.all([hasAll(),shellSetup]).then(([complete,controlled])=>{
        if(complete&&controlled&&gameHtml!==null){
          offlineButton.hidden=true;show('offline','Ready to play offline','This device has saved the full game.');
        }
      }).catch(()=>{});
      play.focus({preventScroll:true});
    } catch (error) {
      busy = false;
      const messages = {
        invite:['Invitation didn’t open','This invitation could not unlock the game. Paste the original private link.'],
        damage:['Download didn’t finish','Tap Retry download to get a fresh copy.'],
        download:['Download interrupted','Check your connection, then tap Retry download.'],
        security:['Open the full invitation','Use the complete HTTPS link in Safari.'],
        version:['Browser update needed','Use a current browser or update iPadOS to open the game.']
      };
      const [title,detail]=messages[error.message]||['Couldn’t open the game','Reconnect and try your invitation again.'];
      show('error',title,detail);
      const canRetry = error.message === 'damage' || error.message === 'download';
      retryInvitation = canRetry ? token : '';
      retry.hidden = !canRetry;
      form.hidden = canRetry;
      (canRetry ? retry : input).focus({preventScroll:true});
    }
  }

  offlineButton.addEventListener('click',()=>window.__arcadeSaveOffline());
  play.addEventListener('click', enter);
  retry.addEventListener('click', () => { if (retryInvitation) unlock(retryInvitation); });
  form.addEventListener('submit', event => { event.preventDefault(); unlock(input.value); });
  const supplied = location.hash;
  if (supplied || location.pathname === base.pathname + 'play.html') {
    // Remove the credential from the visible URL before downloads or game scripts.
    history.replaceState(history.state, '', base.pathname);
  }
  unlock(supplied || readSetting(storageKey) || '');
})();
