// Firstline Map service worker: offline app shell, saved areas, cached map tiles.
const SHELL="mmm-shell-v75", RUNTIME="mmm-runtime-v1", OFFLINE="mmm-offline-v1", RUNTIME_MAX=1500;
const SHELL_FILES=["./","index.html","manifest.webmanifest","icon.svg","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(SHELL).then(c=>Promise.all(SHELL_FILES.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("mmm-shell-")&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const isTile=u=>u.hostname==="mapsneu.wien.gv.at"||u.hostname==="gis.tirol.gv.at"||u.hostname==="tiles.maps.eox.at"||u.hostname==="wmts.geo.admin.ch"||(u.hostname==="data.geopf.fr"&&u.pathname==="/wmts")||u.hostname.endsWith(".bayernwolke.de")||u.hostname==="geoservices.buergernetz.bz.it"||u.hostname==="air.discomap.eea.europa.eu"||(u.hostname==="s3.amazonaws.com"&&u.pathname.startsWith("/elevation-tiles-prod/"));
const isLib=u=>/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.hostname);
async function trim(){const c=await caches.open(RUNTIME);const ks=await c.keys();for(let i=0;i<ks.length-RUNTIME_MAX;i++)await c.delete(ks[i])}
self.addEventListener("fetch",e=>{
  const req=e.request; if(req.method!=="GET")return;
  const u=new URL(req.url);
  // live data (avalanche bulletins, stations, weather): network first, last copy when offline
  if(/^(static\.avalanche\.report|regions\.avalanches\.org|public-meas-data-v2\.slf\.ch|dataset\.api\.hub\.geosphere\.at|api\.open-meteo\.com)$/.test(u.hostname)){
    e.respondWith((async()=>{try{const r=await fetch(req);if(r.ok){const c=await caches.open("mmm-live");c.put(req.url,r.clone())}return r}catch(err){return (await caches.match(req.url))||Response.error()}})());
    return;
  }
  if(isTile(u)||isLib(u)||u.pathname.includes("/data/")){
    // cache first: saved offline area, then recently viewed, then network
    e.respondWith((async()=>{
      const hit=await caches.match(req.url); if(hit)return hit;
      const r=await fetch(req);
      if(r.ok&&u.hostname!=="gis.tirol.gv.at"){const c=await caches.open(RUNTIME);c.put(req.url,r.clone());if(Math.random()<0.05)trim()}
      return r;
    })());
    return;
  }
  // prepared OSM files: the app keeps its own cache of them
  if(u.origin===location.origin&&u.pathname.includes("/osm/v1/"))return;
  if(u.origin===location.origin){
    // network first for the app itself so updates arrive, cache when offline
    e.respondWith((async()=>{
      try{const r=await fetch(req,{cache:"no-cache"});if(r.ok){const c=await caches.open(SHELL);c.put(req,r.clone())}return r}
      catch(err){return (await caches.match(req))||(await caches.match(req.url,{ignoreSearch:true}))||(await caches.match("index.html"))||Response.error()}
    })());
  }
});
