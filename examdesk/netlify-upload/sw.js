/* ExamDesk offline cache: newest page when online, saved copy when offline */
const CACHE='examdesk-v2';
const PAGE=new URL('./',self.location).href;
const ASSETS=['manifest.webmanifest','icon.svg','favicon-32.png','icon-192.png','icon-512.png','apple-touch-icon.png'].map(f=>new URL(f,self.location).href);
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(async c=>{
    try{const r=await fetch(PAGE,{cache:'reload'});if(r.ok)await c.put(PAGE,r);}catch(err){}
    await Promise.all(ASSETS.map(u=>fetch(u).then(r=>{if(r.ok)return c.put(u,r);}).catch(()=>{})));
  }));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(r.mode==='navigate'&&u.origin===self.location.origin){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      const net=fetch(r).then(res=>{if(res.ok)c.put(PAGE,res.clone());return res;});
      const hit=await c.match(PAGE);
      if(!hit)return net;
      try{return await Promise.race([net,new Promise((_,j)=>setTimeout(j,4000))]);}
      catch(err){net.catch(()=>{});return hit;}
    })());
    return;
  }
  if(u.origin===self.location.origin&&!u.pathname.startsWith('/api/')&&!u.pathname.endsWith('/sw.js')){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      const hit=await c.match(r);
      const net=fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res;}).catch(()=>hit);
      return hit||net;
    })());
    return;
  }
  if(/(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      const hit=await c.match(r);
      const net=fetch(r).then(res=>{c.put(r,res.clone());return res;}).catch(()=>hit);
      return hit||net;
    })());
  }
});
