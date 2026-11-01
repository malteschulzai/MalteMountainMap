// Firstline Map: any place in the Alps: Land Tirol laser scan, swissALTI3D, IGN RGE ALTI, else Mapterhorn (national laser scans).
// Active when the URL has ?at=lon,lat[&n=name]. Builds the same data the app gets for the Nordkette:
// 5 m terrain grid (Web Mercator), vegetation from surface minus terrain, tree positions, surrounding terrain.
(function(){
"use strict";
const root=self, isMain=typeof document!=="undefined";
const GEO=root.MMMGeo, R=6378137, ORIGIN=Math.PI*R;
const WCS="https://gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WCSServer";
let say=()=>{};
let urls=[];
const mkCanvas=(w,h)=>{if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);const c=document.createElement("canvas");c.width=w;c.height=h;return c};

async function cachedFetch(url,onBytes){
  let c=null; try{c=await caches.open("mmm-regions")}catch(e){}
  if(c){const hit=await c.match(url); if(hit)return hit.arrayBuffer()}
  const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw new Error("Server antwortet mit Fehler "+r.status);
  let buf;
  if(onBytes&&r.body&&r.body.getReader){
    const rd=r.body.getReader(), parts=[]; let n=0;
    for(;;){const {done,value}=await rd.read(); if(done)break; parts.push(value); n+=value.length; onBytes(n)}
    buf=new Uint8Array(n); let o=0; parts.forEach(p=>{buf.set(p,o);o+=p.length}); buf=buf.buffer;
  } else buf=await r.arrayBuffer();
  if(c){try{await c.put(url,new Response(buf,{headers:{"Content-Type":r.headers.get("Content-Type")||"application/octet-stream"}}));
    const ks=await c.keys(); for(let i=0;i<ks.length-40;i++)await c.delete(ks[i])}catch(e){}}
  return buf;
}
// sample a Land Tirol coverage at the cell centres of a Web Mercator grid
function wcsReq(cov,zone,mx0,mx1,my0,my1,res){
  const L=17, lat9=[];
  for(let j=0;j<L;j++)for(let i=0;i<L;i++){const ll=GEO.mercToLonLat(mx0+(mx1-mx0)*i/(L-1),my1-(my1-my0)*j/(L-1));lat9.push(GEO.lonLatToGK(ll[0],ll[1],zone))}
  let e0=1e12,e1=-1e12,n0=1e12,n1=-1e12; lat9.forEach(([e,n])=>{e0=Math.min(e0,e);e1=Math.max(e1,e);n0=Math.min(n0,n);n1=Math.max(n1,n)});
  e0=Math.floor(e0/res-3)*res; n0=Math.floor(n0/res-3)*res; e1=Math.ceil(e1/res+3)*res; n1=Math.ceil(n1/res+3)*res;
  const url=`${WCS}?service=WCS&version=1.0.0&request=GetCoverage&coverage=${cov}&CRS=EPSG:${zone===31?31255:31254}&BBOX=${e0},${n0},${e1},${n1}&RESX=${res}&RESY=${res}&FORMAT=GeoTIFF&INTERPOLATION=bilinear`;
  return {L,lat9,e0,e1,n0,n1,url};
}
async function sampleWcs(covs,mx0,mx1,my0,my1,nx,ny,res){
  let best=null;
  for(const [cov,zone] of covs){
    const {L,lat9,e0,e1,n0,n1,url}=wcsReq(cov,zone,mx0,mx1,my0,my1,res);
    let tif; try{tif=GEO.readTiff(await cachedFetch(url))}catch(e){console.warn(cov,e);continue}
    const rx=(e1-e0)/tif.w, ry=(n1-n0)/tif.h, T=tif.data, out=new Float32Array(nx*ny); let bad=0;
    for(let j=0;j<ny;j++){const v=(j+0.5)/ny*(L-1), lj=Math.min(L-2,Math.floor(v)), fv=v-lj;
      for(let i=0;i<nx;i++){const u=(i+0.5)/nx*(L-1), li=Math.min(L-2,Math.floor(u)), fu=u-li;
        const a=lat9[lj*L+li],b=lat9[lj*L+li+1],c=lat9[(lj+1)*L+li],d=lat9[(lj+1)*L+li+1];
        const E=(a[0]*(1-fu)+b[0]*fu)*(1-fv)+(c[0]*(1-fu)+d[0]*fu)*fv, Nn=(a[1]*(1-fu)+b[1]*fu)*(1-fv)+(c[1]*(1-fu)+d[1]*fu)*fv;
        const cx=(E-e0)/rx-0.5, cy=(n1-Nn)/ry-0.5, x=Math.min(tif.w-2,Math.max(0,Math.floor(cx))), y=Math.min(tif.h-2,Math.max(0,Math.floor(cy))), ax=cx-x, ay=cy-y, k=y*tif.w+x;
        const p=[T[k],T[k+1],T[k+tif.w],T[k+tif.w+1]];
        let h;
        // outside its coverage the Land Tirol service returns 0 or a huge negative number: both mean "no data"
        if(p.every(q=>q>200&&q<5000))h=p[0]*(1-ax)*(1-ay)+p[1]*ax*(1-ay)+p[2]*(1-ax)*ay+p[3]*ax*ay;
        else{const q=p[(ay>0.5?2:0)+(ax>0.5?1:0)]; h=q>200&&q<5000?q:NaN}
        if(!(h===h))bad++;
        out[j*nx+i]=h;
      }}
    if(bad<nx*ny*0.5){urls.push(url);return {data:out,bad}}
    if(bad<nx*ny&&(!best||bad<best.bad))best={data:out,bad,url};
  }
  if(best)urls.push(best.url);
  return best;
}
// global terrain (Terrarium, ~25 m at z12) to fill everything outside the Land Tirol data
// Mapbox terrain only when explicitly enabled (Raster Tiles API is not part of Mapbox demo access)
const MBT=(root.MMM_CONFIG||{}).mapboxDem?(root.MMM_CONFIG||{}).mapboxToken||"":"";
const DEMZ=MBT?14:13;
function terrUrls(z,mx0,mx1,my0,my1){
  const tileM=2*ORIGIN/2**z, out=[];
  for(let ty=Math.floor((ORIGIN-my1)/tileM);ty<=Math.floor((ORIGIN-my0)/tileM);ty++)
    for(let tx=Math.floor((mx0+ORIGIN)/tileM);tx<=Math.floor((mx1+ORIGIN)/tileM);tx++)
      out.push({tx,ty,url:MBT&&z>=13?`https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${tx}/${ty}.pngraw?access_token=${MBT}`:`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`});
  return out;
}
// Mapterhorn first (national laser scans merged, about 3 m at z14), the older AWS Terrarium tiles if that fails
async function terrainGrid(mx0,mx1,my0,my1,nx,ny,z,onTile){
  if(root.MMMSrc&&root.MMMSrc.mtGrid){
    const out=new Float32Array(nx*ny).fill(NaN);
    const got=await root.MMMSrc.mtGrid(mx0,mx1,my0,my1,nx,ny,false,z,out,onTile).catch(e=>{console.warn("Mapterhorn",e);return 0});
    if(got>nx*ny*0.98){if(got<nx*ny)fillGaps(out,nx,ny); return out}
  }
  return terrariumGrid(mx0,mx1,my0,my1,nx,ny);
}
async function terrariumGrid(mx0,mx1,my0,my1,nx,ny){
  const z=DEMZ, tileM=2*ORIGIN/2**z, list=terrUrls(z,mx0,mx1,my0,my1), mb=MBT&&z>=13;
  const tx0=Math.min(...list.map(t=>t.tx)), ty0=Math.min(...list.map(t=>t.ty)), tw=Math.max(...list.map(t=>t.tx))-tx0+1, th=Math.max(...list.map(t=>t.ty))-ty0+1;
  const cv=mkCanvas(tw*256,th*256);
  const ctx=cv.getContext("2d",{willReadFrequently:true}); let ok=0;
  await Promise.all(list.map(t=>cachedFetch(t.url).then(b=>createImageBitmap(new Blob([b]))).then(bm=>{ctx.drawImage(bm,(t.tx-tx0)*256,(t.ty-ty0)*256);ok++;urls.push(t.url)}).catch(()=>{})));
  if(ok<list.length)return null;
  const px=ctx.getImageData(0,0,cv.width,cv.height).data, W=cv.width, cell=tileM/256, ox=tx0*tileM-ORIGIN, oy=ORIGIN-ty0*tileM;
  const at=(x,y)=>{x=Math.max(0,Math.min(W-1,x));y=Math.max(0,Math.min(cv.height-1,y));const i=(y*W+x)*4;return mb?-10000+(px[i]*65536+px[i+1]*256+px[i+2])*0.1:px[i]*256+px[i+1]+px[i+2]/256-32768};
  const out=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++){const my=my1-(j+0.5)*(my1-my0)/ny, fy=(oy-my)/cell-0.5, y=Math.floor(fy), ay=fy-y;
    for(let i=0;i<nx;i++){const mx=mx0+(i+0.5)*(mx1-mx0)/nx, fx=(mx-ox)/cell-0.5, x=Math.floor(fx), ax=fx-x;
      out[j*nx+i]=at(x,y)*(1-ax)*(1-ay)+at(x+1,y)*ax*(1-ay)+at(x,y+1)*(1-ax)*ay+at(x+1,y+1)*ax*ay}}
  return out;
}
// Copernicus tree cover density 2018 (10 m, 0..100 %) and forest type 2015 (20 m: 1 broadleaved, 2 coniferous), EEA image services
const EEA="https://air.discomap.eea.europa.eu/arcgis/rest/services/FISE/";
async function forestGrid(x0,x1,y0,y1,w,h){
  const rr=encodeURIComponent('{"rasterFunction":"None"}'), mr=encodeURIComponent('{"mosaicMethod":"esriMosaicLockRaster","lockRasterIds":[16]}');
  const q=(svc,extra)=>`${EEA}${svc}/ImageServer/exportImage?bbox=${x0.toFixed(1)},${y0.toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=bsq&pixelType=U8&interpolation=RSP_NearestNeighbor&renderingRule=${rr}${extra}&f=image`;
  const [a,b]=await Promise.all([cachedFetch(q("TreCoverDensity_serie","&mosaicRule="+mr)).catch(()=>null),cachedFetch(q("Copernicus_ForestType_2015_20m_FAO","")).catch(()=>null)]);
  if(!a||a.byteLength<w*h)return null;
  const A=new Uint8Array(a,0,w*h), B=b&&b.byteLength>=w*h?new Uint8Array(b,0,w*h):null, out=new Uint8Array(w*h*2);
  for(let k=0;k<w*h;k++){out[2*k]=A[k]<=100?A[k]:0; out[2*k+1]=B&&B[k]<=2?B[k]:0}
  return out;
}
root.MMM_forestGrid=forestGrid;
function fillGaps(a,nx,ny){
  const valid=new Uint8Array(nx*ny); let any=false;
  for(let k=0;k<a.length;k++)if(a[k]===a[k]){valid[k]=1;any=true}
  if(!any)return;
  for(let y=0;y<ny;y++){const o=y*nx;let last=-1;
    for(let x=0;x<nx;x++){if(valid[o+x]){if(last<x-1){for(let q=last+1;q<x;q++)a[o+q]=last<0?a[o+x]:(q-last<x-q?a[o+last]:a[o+x])}last=x}}
    if(last>=0)for(let q=last+1;q<nx;q++)a[o+q]=a[o+last]; else for(let q=0;q<nx;q++)a[o+q]=NaN}
  let lastRow=-1;
  for(let y=0;y<ny;y++){if(a[y*nx]===a[y*nx]){if(lastRow<y-1)for(let q=lastRow+1;q<y;q++)for(let x=0;x<nx;x++)a[q*nx+x]=a[(lastRow<0?y:lastRow)*nx+x];lastRow=y}}
  for(let q=lastRow+1;q<ny;q++)for(let x=0;x<nx;x++)a[q*nx+x]=a[lastRow*nx+x];
}
const predict=(el,w,h)=>{const p=new Int16Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x;p[k]=y===0?(x===0?el[k]:el[k]-el[k-1]):(x===0?el[k]-el[k-w]:el[k]-el[k-1]-el[k-w]+el[k-w-1])}
  return new Uint8Array(p.buffer)};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};

function terrariumTiles(cx,cy,cosl){
  const z=10, tileM=2*ORIGIN/2**z, hx=34000/cosl, hy=28000/cosl, out=[];
  const tx0=Math.floor((cx-hx+ORIGIN)/tileM), tx1=Math.floor((cx+hx+ORIGIN)/tileM), ty0=Math.floor((ORIGIN-(cy+hy))/tileM), ty1=Math.floor((ORIGIN-(cy-hy))/tileM);
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)out.push(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`);
  return out;
}
async function surroundings(cx,cy,cosl){
  // global terrain (Terrarium tiles, ~100 m) for the horizon
  try{
    const z=10, tileM=2*ORIGIN/2**z, hx=34000/cosl, hy=28000/cosl; // same frame as terrariumTiles
    const tx0=Math.floor((cx-hx+ORIGIN)/tileM), tx1=Math.floor((cx+hx+ORIGIN)/tileM), ty0=Math.floor((ORIGIN-(cy+hy))/tileM), ty1=Math.floor((ORIGIN-(cy-hy))/tileM);
    const cv=mkCanvas((tx1-tx0+1)*256,(ty1-ty0+1)*256);
    const ctx=cv.getContext("2d",{willReadFrequently:true}); let ok=0;
    await Promise.all([]);
    const jobs=[];
    for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){
      const u=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      jobs.push(cachedFetch(u).then(b=>createImageBitmap(new Blob([b]))).then(bm=>{ctx.drawImage(bm,(tx-tx0)*256,(ty-ty0)*256);ok++;urls.push(u)}).catch(e=>console.warn("Umgebung",e)));
    }
    await Promise.all(jobs);
    if(ok<(tx1-tx0+1)*(ty1-ty0+1))return null;
    const px=ctx.getImageData(0,0,cv.width,cv.height).data, cell=tileM/256;
    const gx0=Math.floor((cx-hx-(tx0*tileM-ORIGIN))/cell), gy0=Math.floor(((ORIGIN-ty0*tileM)-(cy+hy))/cell);
    const w=Math.floor(2*hx/cell), h=Math.floor(2*hy/cell), el=new Int16Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((gy0+y)*cv.width+(gx0+x))*4; el[y*w+x]=Math.round(px[i]*256+px[i+1]+px[i+2]/256-32768)}
    return {bytes:predict(el,w,h),grid:{W:w,H:h,x0:tx0*tileM-ORIGIN+gx0*cell,y1:ORIGIN-ty0*tileM-gy0*cell,cell}};
  }catch(e){console.warn("Umgebung",e);return null}
}

function frame(lon,lat){
  const cosl=Math.cos(lat*Math.PI/180), res=5, cell=res/cosl, W=2000, H=1500;
  const [cx,cy]=GEO.lonLatToMerc(lon,lat);
  const x0=cx-W/2*cell, y1=cy+H/2*cell, x1=x0+W*cell, y0=y1-H*cell;
  return {cosl,res,cell,W,H,cx,cy,x0,y1,x1,y0};
}
// download a region's data into the cache in the background, so switching to it is quick
async function prefetchRaw(lon,lat,onBytes){
  const f=frame(lon,lat), zone=lon<11.75?28:31;
  const u=[wcsReq(zone===28?"Gelaendemodell_5m_M28":"Gelaendemodell_50cm_M31",zone,f.x0,f.x1,f.y0,f.y1,5).url,
           wcsReq(zone===28?"Oberflaechenmodell_5m_M28":"Oberflaechenmodell_50cm_M31",zone,f.x0,f.x1,f.y0,f.y1,10).url,
           ...terrariumTiles(f.cx,f.cy,f.cosl)];
  const tirol=lon>10.0&&lon<13.05&&lat>46.6&&lat<47.8;
  let err="";
  const natP=root.MMMSrc?root.MMMSrc.demGrid(f.x0,f.x1,f.y0,f.y1,f.W,f.H).catch(()=>null):Promise.resolve(null);
  const mtP=terrainGrid(f.x0,f.x1,f.y0,f.y1,200,150,(lon>10.0&&lon<13.05&&lat>46.6&&lat<47.8)?13:14).then(g=>!!g).catch(()=>false);
  const res=await Promise.all(u.map((x,i)=>i<2&&!tirol?Promise.resolve(false):cachedFetch(x,i===0?onBytes:null).then(()=>true).catch(e=>{if(i===0)err=e.message||String(e);return false})));
  await natP; const mtOk=await mtP;
  // outside Tirol the Land Tirol request may fail, the global terrain is enough then
  return {ok:res[0]||mtOk,err};
}
async function buildRegion(lon,lat,name,sayFn){
  say=sayFn||(()=>{}); urls=[];
  const {cosl,res,cell,W,H,cx,cy,x0,y1,x1,y0}=frame(lon,lat);
  const src=root.MMMSrc&&root.MMMSrc.sourceName(lon,lat);
  say(lon>10.0&&lon<13.05&&lat>46.6&&lat<47.8?"Gelände wird geladen …":src==="swisstopo"||src==="IGN"?`Gelände wird geladen (${src}) …`:"Gelände wird geladen …");
  const tirolR=lon>10.0&&lon<13.05&&lat>46.6&&lat<47.8;
  const ctxP=surroundings(cx,cy,cosl), terrP=terrainGrid(x0,x1,y0,y1,W,H,tirolR?13:14,tirolR?null:f=>say(`Gelände wird geladen (Mapterhorn) … ${Math.round(f*100)} %`)).catch(()=>null);
  const VW=W/2, VH=H/2;
  const forestP=forestGrid(x0,x1,y0,y1,VW,VH).catch(()=>null);
  const tirol=lon>10.0&&lon<13.05&&lat>46.6&&lat<47.8;
  const domP=!tirol?Promise.resolve(null):sampleWcs(lon<11.75?[["Oberflaechenmodell_5m_M28",28],["Oberflaechenmodell_50cm_M31",31]]:[["Oberflaechenmodell_50cm_M31",31],["Oberflaechenmodell_5m_M28",28]],x0,x1,y0,y1,VW,VH,10).catch(()=>null);
  const dgmR=!tirol?null:await sampleWcs(lon<11.75?[["Gelaendemodell_5m_M28",28],["Gelaendemodell_50cm_M31",31],["Gelaendemodell_50cm_M28",28]]:[["Gelaendemodell_50cm_M31",31],["Gelaendemodell_5m_M28",28]],x0,x1,y0,y1,W,H,res);
  const natP=root.MMMSrc?root.MMMSrc.demGrid(x0,x1,y0,y1,W,H,{onTile:f=>say(`Gelände wird geladen (${src||"Landesdaten"}) … ${Math.round(f*100)} %`)}).catch(e=>{console.warn(e);return null}):Promise.resolve(null);
  const nat=await natP;
  const terr=await terrP;
  if(!dgmR&&!terr&&!nat)throw new Error("Für diesen Ort konnten keine Geländedaten geladen werden. Prüfe die Verbindung und versuche es nochmal.");
  const dgm=dgmR?dgmR.data:new Float32Array(W*H).fill(NaN);
  if(nat)for(let k=0;k<W*H;k++)if(!(dgm[k]===dgm[k])&&nat[k]===nat[k])dgm[k]=nat[k];
  if(terr){
    // blend the 5 m laser scan into the global terrain over ~100 m at the data edge
    const valid=new Uint8Array(W*H); for(let k=0;k<W*H;k++)valid[k]=dgm[k]===dgm[k]?1:0;
    const dist=new Float32Array(W*H).fill(1e9);
    for(let k=0;k<W*H;k++)if(!valid[k])dist[k]=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=y*W+x;if(x>0)dist[k]=Math.min(dist[k],dist[k-1]+1);if(y>0)dist[k]=Math.min(dist[k],dist[k-W]+1)}
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const k=y*W+x;if(x<W-1)dist[k]=Math.min(dist[k],dist[k+1]+1);if(y<H-1)dist[k]=Math.min(dist[k],dist[k+W]+1)}
    for(let k=0;k<W*H;k++){if(!valid[k])dgm[k]=terr[k];else if(dist[k]<20){const f=dist[k]/20;dgm[k]=dgm[k]*f+terr[k]*(1-f)}}
  } else fillGaps(dgm,W,H);
  const dm=new Uint16Array(W*H); for(let k=0;k<W*H;k++)dm[k]=Math.max(0,Math.min(65535,Math.round(dgm[k]*10)));
  say("Wald und Latschen werden erkannt …");
  const domR=await domP;
  let veg=null, trees=null, nTrees=0;
  if(domR){
    const dom=domR.data; veg=new Uint8Array(VW*VH*2);
    const tx=[],ty=[],th=[]; let seed=12345; const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
    for(let j=0;j<VH;j++)for(let i=0;i<VW;i++){
      const k=j*VW+i, a=(2*j)*W+2*i, g=(dgm[a]+dgm[a+1]+dgm[a+W]+dgm[a+W+1])/4, d=dom[k];
      if(!(d===d))continue;
      // terrain slope at 10 m, to drop false "canopy" on cliffs
      const gxm=dgm[a+(i<VW-1?2:0)]-dgm[a-(i>0?2:0)], gym=dgm[a+(j<VH-1?2*W:0)]-dgm[a-(j>0?2*W:0)];
      const sl=Math.atan(Math.hypot(gxm,gym)/(20))*180/Math.PI;
      let c=d-g; if(sl>40||g>2300)c=0;
      const t=smooth(3,9,c), s=smooth(0.6,2.5,c)*(1-t);
      veg[k*2]=t*255; veg[k*2+1]=s*255;
      if(c>4&&t>0.5&&tx.length<420000){const n=c>12?2:1;
        for(let q=0;q<n;q++){tx.push(Math.round((2*i+rnd()*2)*16));ty.push(Math.round((2*j+rnd()*2)*16));th.push(Math.min(255,Math.round(c*(0.75+0.3*rnd())*4)))}}
    }
    nTrees=tx.length;
    const buf=new Uint8Array(nTrees*5), dv=new DataView(buf.buffer);
    for(let i=0;i<nTrees;i++){dv.setUint16(i*2,tx[i],true);dv.setUint16(nTrees*2+i*2,ty[i],true);buf[nTrees*4+i]=th[i]}
    trees=buf;
  }
  const forest=await forestP;
  if(!domR&&forest){
    // no laser surface model here: forest and trees from the satellite tree cover density
    veg=new Uint8Array(VW*VH*2); const tx=[],ty=[],th=[]; let seed=777; const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
    for(let j=0;j<VH;j++)for(let i=0;i<VW;i++){
      const k=j*VW+i, a=(2*j)*W+2*i, g=(dgm[a]+dgm[a+1]+dgm[a+W]+dgm[a+W+1])/4;
      const gxm=dgm[a+(i<VW-1?2:0)]-dgm[a-(i>0?2:0)], gym=dgm[a+(j<VH-1?2*W:0)]-dgm[a-(j>0?2*W:0)], sl=Math.atan(Math.hypot(gxm,gym)/20)*180/Math.PI;
      let t=forest[2*k]/100; if(sl>45)t*=0.3;
      veg[2*k]=smooth(0.08,0.6,t)*255;
      const n=(rnd()<t*1.3?1:0)+(t>0.7&&rnd()<0.5?1:0);
      for(let q=0;q<n&&tx.length<420000;q++){tx.push(Math.round((2*i+rnd()*2)*16));ty.push(Math.round((2*j+rnd()*2)*16));th.push(Math.round((12+14*rnd())*(1-0.45*smooth(1700,2200,g))*4))}
    }
    nTrees=tx.length; const buf=new Uint8Array(nTrees*5), dv=new DataView(buf.buffer);
    for(let i=0;i<nTrees;i++){dv.setUint16(i*2,tx[i],true);dv.setUint16(nTrees*2+i*2,ty[i],true);buf[nTrees*4+i]=th[i]}
    trees=buf;
  }
  say("Umgebung wird geladen …");
  const ctx=await ctxP;
  const meta={grid:{W,H,x0,y1,cell},labels:[],region:true,name,center:[lon,lat]};
  if(veg)meta.veg={W:VW,H:VH};
  if(forest)meta.forest={W:VW,H:VH};
  if(trees)meta.trees={n:nTrees};
  if(ctx)meta.context=ctx.grid;
  return {meta,dm,veg,trees,forest,ctx:ctx?ctx.bytes:null,urls};
}
root.MMM_buildRegion=buildRegion;

// ---- built areas: packed, gzipped and kept in the Cache API, so switching is quick ----
const BUILD_V="b2", BUILT="mmm-built", KEEP="mmm-built-keep";
const builtKey=(lon,lat)=>`https://linefinder.local/built/${BUILD_V}/${(+lon).toFixed(2)},${(+lat).toFixed(2)}`;
async function gz(u8,pack){
  if(typeof CompressionStream==="undefined")return null;
  const st=new Blob([u8]).stream().pipeThrough(pack?new CompressionStream("gzip"):new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
// heights as differences to the neighbours (much smaller after gzip): used for the prebuilt areas
function predictU16(a,w,h){const p=new Int16Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x;p[k]=y===0?(x===0?a[k]:a[k]-a[k-1]):(x===0?a[k]-a[k-w]:a[k]-a[k-1]-a[k-w]+a[k-w-1])}
  return new Uint16Array(p.buffer)}
function unpredictU16(p16,w,h){const p=new Int16Array(p16.buffer,p16.byteOffset,w*h), a=new Uint16Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x;a[k]=y===0?(x===0?p[k]:p[k]+a[k-1]):(x===0?p[k]+a[k-w]:p[k]+a[k-1]+a[k-w]-a[k-w-1])}
  return a}
async function packBuilt(r,compact){
  const dm=compact?["dmp",predictU16(r.dm,r.meta.grid.W,r.meta.grid.H)]:["dm",r.dm];
  const parts=[dm,["veg",r.veg],["trees",r.trees],["forest",r.forest],["ctx",r.ctx]].filter(p=>p[1]);
  const head=new TextEncoder().encode(JSON.stringify({meta:r.meta,urls:compact?[]:r.urls,parts:parts.map(p=>[p[0],p[1] instanceof Uint16Array?"u16":"u8",p[1].byteLength])}));
  const pad=o=>o+((8-o%8)%8);
  let total=pad(4+head.length); parts.forEach(p=>total=pad(total+p[1].byteLength));
  const out=new Uint8Array(total), dv=new DataView(out.buffer); dv.setUint32(0,head.length,true); out.set(head,4);
  let o=pad(4+head.length);
  for(const [,a] of parts){out.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),o); o=pad(o+a.byteLength)}
  return gz(out,true);
}
async function storeBuilt(lon,lat,r){
  try{
    const parts=[["dm",r.dm],["veg",r.veg],["trees",r.trees],["forest",r.forest],["ctx",r.ctx]].filter(p=>p[1]);
    const head=new TextEncoder().encode(JSON.stringify({meta:r.meta,urls:r.urls,parts:parts.map(p=>[p[0],p[1] instanceof Uint16Array?"u16":"u8",p[1].byteLength])}));
    const pad=o=>o+((8-o%8)%8);
    let total=pad(4+head.length); parts.forEach(p=>total=pad(total+p[1].byteLength));
    const out=new Uint8Array(total), dv=new DataView(out.buffer); dv.setUint32(0,head.length,true); out.set(head,4);
    let o=pad(4+head.length);
    for(const [,a] of parts){out.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),o); o=pad(o+a.byteLength)}
    const z=await gz(out,true); if(!z)return;
    const c=await caches.open(BUILT); await c.put(builtKey(lon,lat),new Response(z));
    const ks=await c.keys(); for(let i=0;i<ks.length-12;i++)await c.delete(ks[i]);
  }catch(e){console.warn("Bereich speichern",e)}
}
async function loadBuilt(lon,lat){
  try{
    if(typeof DecompressionStream==="undefined")return null;
    const hit=(await (await caches.open(BUILT)).match(builtKey(lon,lat)))||(await (await caches.open(KEEP)).match(builtKey(lon,lat))); if(!hit)return null;
    const u=await gz(new Uint8Array(await hit.arrayBuffer()),false), dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
    const pad=o=>o+((8-o%8)%8);
    const hl=dv.getUint32(0,true), head=JSON.parse(new TextDecoder().decode(u.subarray(4,4+hl)));
    let o=pad(4+hl); const r={meta:head.meta,urls:head.urls,dm:null,veg:null,trees:null,forest:null,ctx:null};
    for(const [name,type,len] of head.parts){const b=u.buffer.slice(u.byteOffset+o,u.byteOffset+o+len); r[name]=type==="u16"?new Uint16Array(b):new Uint8Array(b); o=pad(o+len)}
    if(r.dmp){r.dm=unpredictU16(r.dmp,r.meta.grid.W,r.meta.grid.H); delete r.dmp}
    return r;
  }catch(e){console.warn("Bereich lesen",e);return null}
}
const transfers=r=>[r.dm,r.veg,r.trees,r.forest,r.ctx].filter(Boolean).map(a=>a.buffer);

// ---- worker: build an area on request and keep it in the cache ----
if(!isMain){
  root.onmessage=async e=>{
    const {id,lon,lat,name}=e.data;
    try{
      const r=await buildRegion(lon,lat,name,m=>root.postMessage({id,say:m}));
      await storeBuilt(lon,lat,r);
      root.postMessage({id,res:r},transfers(r));
    }catch(err){root.postMessage({id,err:err.message||String(err)})}
  };
  return;
}

// ---- main thread ----
let worker=null, wid=0; const waiting=new Map();
function getWorker(){
  if(worker!==null)return worker;
  try{
    const v=(document.querySelector('script[src*="js/region.js"]').src.match(/v=(\d+)/)||[])[1]||"0";
    worker=new Worker("js/region-worker.js?v="+v);
    worker.onmessage=e=>{const w=waiting.get(e.data.id); if(!w)return;
      if(e.data.say!==undefined){w.say&&w.say(e.data.say);return}
      waiting.delete(e.data.id); e.data.err?w.rej(new Error(e.data.err)):w.res(e.data.res)};
    worker.onerror=e=>{console.warn("Worker",e.message);worker=false;waiting.forEach(w=>w.rej(new Error("worker")));waiting.clear()};
  }catch(e){console.warn("Worker",e);worker=false}
  return worker;
}
async function build(lon,lat,name,sayFn){
  const w=getWorker();
  if(w){try{return await new Promise((res,rej)=>{const id=++wid;waiting.set(id,{res,rej,say:sayFn});w.postMessage({id,lon,lat,name})})}
    catch(e){if(e.message!=="worker")throw e}}
  const r=await buildRegion(lon,lat,name,sayFn); await storeBuilt(lon,lat,r); return r;
}
// areas built in advance by a GitHub workflow (tools/prebuild.mjs), served next to the app
const PRE="regions/"+BUILD_V+"/";
let preIdx=null;
function prebuiltIndex(){
  if(!preIdx)preIdx=fetch(PRE+"index.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).catch(()=>null).then(j=>{
    const keys=j&&Array.isArray(j.keys)?j.keys:[];
    // the app picks these centres when a place lies well inside one of them
    window.MMM_preList=keys.map(k=>k.split(",").map(Number));
    return new Set(keys)});
  return preIdx;
}
window.MMM_prebuiltIndex=prebuiltIndex;
prebuiltIndex();
async function loadPrebuilt(lon,lat,sayFn){
  const k=(+lon).toFixed(2)+","+(+lat).toFixed(2);
  if(!(await prebuiltIndex()).has(k))return null;
  try{sayFn&&sayFn("Gebiet wird geladen …");
    const r=await fetch(PRE+k+".bin"); if(!r.ok)return null;
    const buf=await r.arrayBuffer();
    await (await caches.open(BUILT)).put(builtKey(lon,lat),new Response(buf));
    return await loadBuilt(lon,lat);
  }catch(e){console.warn("vorgebautes Gebiet",e);return null}
}
const pending=new Map();
function ensureBuilt(lon,lat,name,sayFn){
  const k=(+lon).toFixed(2)+","+(+lat).toFixed(2);
  if(!pending.has(k))pending.set(k,(async()=>{const r=await loadBuilt(lon,lat)||await loadPrebuilt(lon,lat,sayFn); if(r)return r; return build(lon,lat,name,sayFn)})().finally(()=>setTimeout(()=>pending.delete(k),0)));
  return pending.get(k);
}
// for the build workflow: build one area and return the compact pack
window.MMM_buildPack=async(lon,lat)=>{const r=await build(lon,lat,"",()=>{}); return packBuilt(r,true)};
// background: download and build an area, so switching to it is quick
window.MMM_prefetchRegion=async(lon,lat,onProgress)=>{
  try{await ensureBuilt(lon,lat,"",m=>{const n=/(\d+) %/.exec(m||"");if(onProgress&&n)onProgress(+n[1])}); return {ok:true,err:""}}
  catch(e){return {ok:false,err:e.message||String(e)}}
};
// offline areas: keep a built area permanently (not pruned with the recent ones)
window.MMM_keepRegion=async(lon,lat,onProgress)=>{
  await ensureBuilt(lon,lat,"",m=>{const n=/(\d+) %/.exec(m||"");if(onProgress&&n)onProgress(+n[1])});
  const key=builtKey(lon,lat), keep=await caches.open(KEEP);
  if(await keep.match(key))return true;
  const hit=await (await caches.open(BUILT)).match(key); if(!hit)throw new Error("Bereich konnte nicht gespeichert werden");
  await keep.put(key,hit); return true;
};
window.MMM_dropRegion=async(lon,lat)=>{try{await (await caches.open(KEEP)).delete(builtKey(lon,lat))}catch(e){}};
const qs=new URLSearchParams(location.search), at=qs.get("at");
if(!at)return;
const parts=at.split(",").map(Number), lon=parts[0], lat=parts[1];
if(!isFinite(lon)||!isFinite(lat))return;
const name=(qs.get("n")||"").slice(0,80);
const sayMain=m=>{const l=document.getElementById("loading");if(l){l.hidden=false;l.textContent=m}};
window.MMM_REGION_PROMISE=ensureBuilt(lon,lat,name,sayMain).then(r=>{r.meta.name=name;return r});
})();

