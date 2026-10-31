// National open data outside Tirol: picks the best free terrain and aerial imagery per country.
// - Switzerland/Liechtenstein: swisstopo swissALTI3D (2 m, COG tiles of 1 km, LV95) and SWISSIMAGE (10 cm)
// - France: IGN RGE ALTI (1 m, WMS-R float32) and IGN orthophotos (20 cm)
// - Bavaria: LDBV DOP (20 cm)
// Everything else falls back to Terrarium terrain and Sentinel-2 imagery in the callers.
(function(root){
"use strict";
const R=6378137, D2R=Math.PI/180;
const B=root.MMM_BORDERS||{};
const merc2ll=(x,y)=>[x/R/D2R,(2*Math.atan(Math.exp(y/R))-Math.PI/2)/D2R];

// ---- countries ----
const rings=[];
for(const c in B)for(const r of B[c]){let a=1e9,b=1e9,d=-1e9,e=-1e9;for(const [x,y] of r){a=Math.min(a,x);b=Math.min(b,y);d=Math.max(d,x);e=Math.max(e,y)}rings.push({c,r,bb:[a,b,d,e]})}
function inRing(r,x,y){let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins}return ins}
function country(lon,lat){for(const g of rings){const b=g.bb;if(lon<b[0]||lon>b[2]||lat<b[1]||lat>b[3])continue;if(inRing(g.r,lon,lat))return g.c}return null}
function countriesIn(mx0,mx1,my0,my1){const s=new Set();
  for(let j=0;j<=4;j++)for(let i=0;i<=4;i++){const ll=merc2ll(mx0+(mx1-mx0)*i/4,my0+(my1-my0)*j/4);const c=country(ll[0],ll[1]);if(c)s.add(c)}
  return s}

// ---- imagery ----
const inBZ=(lon,lat)=>lon>10.35&&lon<12.53&&lat>46.17&&lat<47.15;
function orthoUrl(z,x,y){
  const n=2**z, lon=(x+0.5)/n*360-180, lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+0.5)/n)))/D2R, c=country(lon,lat);
  if((c==="CH"||c==="LI")&&z<=19)return `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`;
  if(c==="FR"&&z<=19)return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
  if(c==="DE"&&z<=19)return `https://wmtsod${1+(x+y)%3}.bayernwolke.de/wmts/by_dop/smerc/${z}/${x}/${y}`;
  // South Tyrol: aerial images 2023 of the province (CC0); outside the province the service answers with a transparent PNG
  if(c==="IT"&&inBZ(lon,lat)&&z<=19)return `https://geoservices.buergernetz.bz.it/mapproxy/ows?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=p_bz-Orthoimagery:Aerial-2023-RGB&STYLE=default&FORMAT=image/png&TILEMATRIXSET=EPSG_3857&TILEMATRIX=${String(z).padStart(2,"0")}&TILEROW=${y}&TILECOL=${x}`;
  return null;
}

// ---- cached fetch (own cache, so region pruning does not drop terrain tiles) ----
async function cget(url,opt){
  opt=opt||{}; const key=opt.range?url+(url.includes("?")?"&":"?")+"mmmrange="+opt.range[0]+"-"+opt.range[1]:url;
  let c=null; try{c=await caches.open("mmm-dem")}catch(e){}
  if(c){const hit=await c.match(key); if(hit)return opt.json?hit.json():hit.arrayBuffer()}
  const ac=new AbortController(), to=setTimeout(()=>ac.abort(),opt.timeout||30000);
  let r; try{r=await fetch(url,{mode:"cors",signal:ac.signal,headers:opt.range?{Range:`bytes=${opt.range[0]}-${opt.range[1]}`}:undefined})}finally{clearTimeout(to)}
  if(!r.ok)throw new Error("HTTP "+r.status);
  const buf=await r.arrayBuffer();
  if(c){try{await c.put(key,new Response(buf));const ks=await c.keys();for(let i=0;i<ks.length-1500;i++)await c.delete(ks[i])}catch(e){}}
  return opt.json?JSON.parse(new TextDecoder().decode(buf)):buf;
}
async function pool(items,n,fn){let i=0;const run=async()=>{while(i<items.length){const k=i++;await fn(items[k],k)}};await Promise.all(Array.from({length:Math.min(n,items.length)},run))}

// ---- Switzerland: LV95 (swisstopo approximate formulas, about 1 m) ----
function lv95(lon,lat){
  const p=(lat*3600-169028.66)/10000, l=(lon*3600-26782.5)/10000;
  return [2600072.37+211455.93*l-10938.51*l*p-0.36*l*p*p-44.54*l*l*l,
          1200147.07+308807.95*p+3745.25*l*l+76.63*p*p-194.56*l*l*p+119.79*p*p*p];
}
// TIFF LZW
function lzw(src,outLen){
  const pre=new Int32Array(4096), suf=new Uint8Array(4096), len=new Int32Array(4096), out=new Uint8Array(outLen);
  for(let i=0;i<256;i++){pre[i]=-1;suf[i]=i;len[i]=1}
  let next=258,w=9,op=0,old=-1,bit=0; const nb=src.length*8;
  const read=()=>{if(bit+w>nb)return 257;let v=0,b=bit;for(let i=0;i<w;i++,b++)v=(v<<1)|((src[b>>3]>>(7-(b&7)))&1);bit+=w;return v};
  const first=c=>{while(pre[c]>=0)c=pre[c];return suf[c]};
  const emit=c=>{const l=len[c];let p=op+l-1;while(c>=0){if(p<outLen)out[p]=suf[c];p--;c=pre[c]}op+=l};
  for(;;){const c=read(); if(c===257||op>=outLen)break;
    if(c===256){next=258;w=9;old=-1;continue}
    if(old<0){emit(c);old=c;continue}
    if(next<4096){if(c<next){pre[next]=old;suf[next]=first(c)}else{pre[next]=old;suf[next]=first(old)}len[next]=len[old]+1;next++}
    emit(c);old=c;
    if(next>=(1<<w)-1&&w<12)w++;
  }
  return out;
}
function ifds(buf){
  const dv=new DataView(buf), le=dv.getUint16(0)===0x4949, u16=o=>dv.getUint16(o,le), u32=o=>dv.getUint32(o,le), out=[];
  let o=u32(4), g=0;
  while(o&&o+2<=buf.byteLength&&g++<8){const n=u16(o), t={};
    if(o+2+n*12>buf.byteLength)break;
    for(let i=0;i<n;i++){const e=o+2+i*12, tag=u16(e), type=u16(e+2), cnt=u32(e+4), sz=type===3?2:type===16?8:4;
      t[tag]={type,cnt,inl:cnt*sz<=4,v:type===3?u16(e+8):u32(e+8)}}
    out.push(t); o=u32(o+2+n*12)}
  return {le,list:out};
}
function arr(buf,le,f){ // read a TIFF array tag from buf (offset must be inside)
  if(f.inl)return [f.v]; const dv=new DataView(buf), a=[];
  for(let i=0;i<f.cnt;i++)a.push(f.type===3?dv.getUint16(f.v+i*2,le):dv.getUint32(f.v+i*4,le));
  return a;
}
// read one level of a swissALTI3D COG (0 = 2 m, 1 = 4 m overview)
async function cogLevel(url,level){
  const head=await cget(url,{range:[0,16383]});
  const {le,list}=ifds(head), t=list[Math.min(level,list.length-1)];
  if(!t||t[259].v!==5||(t[317]&&t[317].v!==1))throw new Error("COG-Format");
  const w=t[256].v,h=t[257].v,tw=t[322].v,th=t[323].v, offs=arr(head,le,t[324]), cnts=arr(head,le,t[325]);
  const a=Math.min(...offs), b=Math.max(...offs.map((x,i)=>x+cnts[i]));
  const body=await cget(url,{range:[a,b-1]});
  const across=Math.ceil(w/tw), out=new Float32Array(w*h);
  offs.forEach((off,ti)=>{
    const raw=lzw(new Uint8Array(body,off-a,cnts[ti]),tw*th*4), f=new DataView(raw.buffer), tx=ti%across, ty=Math.floor(ti/across);
    for(let r=0;r<th;r++){const y=ty*th+r;if(y>=h)break;for(let c=0;c<tw;c++){const x=tx*tw+c;if(x<w){const v=f.getFloat32((r*tw+c)*4,le);out[y*w+x]=v<-1000?NaN:v}}}
  });
  return {w,h,data:out};
}
const STAC="https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items";
async function chIndex(lon0,lat0,lon1,lat1){
  const m=new Map(); let url=`${STAC}?bbox=${lon0.toFixed(4)},${lat0.toFixed(4)},${lon1.toFixed(4)},${lat1.toFixed(4)}&limit=100`, g=0;
  while(url&&g++<30){const j=await cget(url,{json:true});
    for(const f of j.features||[])for(const a of Object.values(f.assets||{})){const mm=/swissalti3d_(\d{4})_(\d+)-(\d+)_2_2056_5728\.tif$/.exec(a.href||"");
      if(mm){const k=mm[2]+"-"+mm[3], y=+mm[1]; if(!m.has(k)||m.get(k).y<y)m.set(k,{y,url:a.href})}}
    const nx=(j.links||[]).find(l=>l.rel==="next"); url=nx?nx.href:null}
  return m;
}
// lattice of (lon,lat)->LV95 over the merc box, bilinear for every sample
function lattice(mx0,mx1,my0,my1,fn){const L=17,p=[];for(let j=0;j<L;j++)for(let i=0;i<L;i++){const ll=merc2ll(mx0+(mx1-mx0)*i/(L-1),my1-(my1-my0)*j/(L-1));p.push(fn(ll[0],ll[1]))}return {L,p}}
async function chGrid(mx0,mx1,my0,my1,nx,ny,corner,fine,out,onTile){
  const a=merc2ll(mx0,my0), b=merc2ll(mx1,my1);
  const idx=await chIndex(a[0],a[1],b[0],b[1]); if(!idx.size)return 0;
  const lat=lattice(mx0,mx1,my0,my1,lv95), P=lat.p;
  let e0=1e12,e1=-1e12,n0=1e12,n1=-1e12; P.forEach(([e,n])=>{e0=Math.min(e0,e);e1=Math.max(e1,e);n0=Math.min(n0,n);n1=Math.max(n1,n)});
  const K0=Math.floor(e0/1000)-1, K1=Math.floor(e1/1000)+1, M0=Math.floor(n0/1000)-1, M1=Math.floor(n1/1000)+1, KW=K1-K0+1;
  const tiles=new Array(KW*(M1-M0+1)).fill(null), jobs=[];
  for(let m=M0;m<=M1;m++)for(let k=K0;k<=K1;k++){const it=idx.get(k+"-"+m);if(it)jobs.push([k,m,it.url])}
  let done=0;
  await pool(jobs,6,async([k,m,u])=>{try{tiles[(m-M0)*KW+(k-K0)]=await cogLevel(u,fine?0:1)}catch(e){console.warn("swissALTI3D",u,e)}done++;onTile&&onTile(done/jobs.length)});
  const px=fine?2:4, per=1000/px;
  const val=(c,q)=>{const k=Math.floor(c/per), m=Math.floor(q/per), t=tiles[(m-M0)*KW+(k-K0)];
    if(!t||k<K0||k>K1||m<M0||m>M1)return NaN; const lc=c-k*per, lr=per-1-(q-m*per); return t.data[lr*t.w+lc]};
  let got=0; const L=lat.L;
  for(let j=0;j<ny;j++){const v=(corner?j/(ny-1):(j+0.5)/ny)*(L-1), lj=Math.min(L-2,Math.floor(v)), fv=v-lj;
    for(let i=0;i<nx;i++){const kk=j*nx+i; if(out[kk]===out[kk])continue;
      const u=(corner?i/(nx-1):(i+0.5)/nx)*(L-1), li=Math.min(L-2,Math.floor(u)), fu=u-li;
      const A=P[lj*L+li],Bq=P[lj*L+li+1],C=P[(lj+1)*L+li],D=P[(lj+1)*L+li+1];
      const E=(A[0]*(1-fu)+Bq[0]*fu)*(1-fv)+(C[0]*(1-fu)+D[0]*fu)*fv, N=(A[1]*(1-fu)+Bq[1]*fu)*(1-fv)+(C[1]*(1-fu)+D[1]*fu)*fv;
      const cx=E/px-0.5, cy=N/px-0.5, c0=Math.floor(cx), q0=Math.floor(cy), ax=cx-c0, ay=cy-q0;
      const h00=val(c0,q0),h10=val(c0+1,q0),h01=val(c0,q0+1),h11=val(c0+1,q0+1);
      const h=h00*(1-ax)*(1-ay)+h10*ax*(1-ay)+h01*(1-ax)*ay+h11*ax*ay;
      if(h===h){out[kk]=h;got++}}}
  return got;
}

// ---- France: IGN RGE ALTI via WMS-R, float32 BIL directly in Web Mercator ----
const IGN="https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&CRS=EPSG:3857&FORMAT=image/x-bil;bits=32";
async function frGrid(mx0,mx1,my0,my1,nx,ny,corner,out,onTile){
  // pixel centres of the WMS image = sample points
  const dx=(mx1-mx0)/(corner?nx-1:nx), dy=(my1-my0)/(corner?ny-1:ny);
  const X0=corner?mx0-dx/2:mx0, Y1=corner?my1+dy/2:my1, S=500, jobs=[];
  for(let by=0;by<ny;by+=S)for(let bx=0;bx<nx;bx+=S)jobs.push([bx,by,Math.min(S,nx-bx),Math.min(S,ny-by)]);
  let got=0, done=0;
  await pool(jobs,4,async([bx,by,w,h])=>{
    const a=X0+bx*dx, d=Y1-by*dy, b=a+w*dx, c=d-h*dy;
    try{const buf=await cget(`${IGN}&BBOX=${a.toFixed(2)},${c.toFixed(2)},${b.toFixed(2)},${d.toFixed(2)}&WIDTH=${w}&HEIGHT=${h}`,{timeout:25000});
      if(buf.byteLength!==w*h*4)throw new Error("Größe");
      const f=new Float32Array(buf);
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){const v=f[j*w+i], k=(by+j)*nx+bx+i; if(v>-100&&v<5000&&!(out[k]===out[k])){out[k]=v;got++}}
    }catch(e){console.warn("IGN",e)}
    done++; onTile&&onTile(done/jobs.length);
  });
  return got;
}

// ---- Mapterhorn: open terrain tiles merged from the national laser scans (BEV 1 m, Bozen 2.5 m, Trentino,
// Lombardia, Piemonte, Aosta, Bayern 1 m, Slovenia, swissALTI3D, IGN ...), Terrarium-encoded 512 px WebP ----
const MT="https://tiles.mapterhorn.com/", ORIG=Math.PI*R;
const mkCv=(w,h)=>{if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);const c=document.createElement("canvas");c.width=w;c.height=h;return c};
function mtTiles(mx0,mx1,my0,my1,z){const tileM=2*ORIG/2**z, pad=-tileM*1e-6, o=[];   // no neighbour tiles just for the outermost half pixel (clamped)
  for(let ty=Math.floor((ORIG-(my1+pad))/tileM);ty<=Math.floor((ORIG-(my0-pad))/tileM);ty++)
    for(let tx=Math.floor((mx0-pad+ORIG)/tileM);tx<=Math.floor((mx1+pad+ORIG)/tileM);tx++)o.push({tx,ty,url:`${MT}${z}/${tx}/${ty}.webp`});
  return o}
// fill the NaN samples of out (nx*ny, corner lattice or cell centres) from Mapterhorn zoom z; returns the number filled
async function mtGrid(mx0,mx1,my0,my1,nx,ny,corner,z,out,onTile){
  const tileM=2*ORIG/2**z, cell=tileM/512, list=mtTiles(mx0,mx1,my0,my1,z); if(!list.length||list.length>80)return 0;
  const tx0=Math.min(...list.map(t=>t.tx)), ty0=Math.min(...list.map(t=>t.ty)), tw=Math.max(...list.map(t=>t.tx))-tx0+1, th=Math.max(...list.map(t=>t.ty))-ty0+1;
  const cv=mkCv(tw*512,th*512), ctx=cv.getContext("2d",{willReadFrequently:true}); let ok=0, done=0;
  await pool(list,6,async t=>{try{const buf=await cget(t.url,{timeout:20000}); const bm=await createImageBitmap(new Blob([buf],{type:"image/webp"})); ctx.drawImage(bm,(t.tx-tx0)*512,(t.ty-ty0)*512); ok++}catch(e){console.warn("Mapterhorn",e)}
    done++; onTile&&onTile(done/list.length)});
  if(!ok)return 0;
  const px=ctx.getImageData(0,0,cv.width,cv.height).data, CW=cv.width, CHh=cv.height, ox=tx0*tileM-ORIG, oy=ORIG-ty0*tileM;
  const at=(x,y)=>{x=Math.max(0,Math.min(CW-1,x));y=Math.max(0,Math.min(CHh-1,y));const i=(y*CW+x)*4;return px[i+3]<255?NaN:px[i]*256+px[i+1]+px[i+2]/256-32768};
  const dx=(mx1-mx0)/(corner?nx-1:nx), dy=(my1-my0)/(corner?ny-1:ny), X0=corner?mx0:mx0+dx/2, Y0=corner?my1:my1-dy/2; let got=0;
  for(let j=0;j<ny;j++){const my=Y0-j*dy, fy=(oy-my)/cell-0.5, y=Math.floor(fy), ay=fy-y;
    for(let i=0;i<nx;i++){const k=j*nx+i; if(out[k]===out[k])continue;
      const mx=X0+i*dx, fx=(mx-ox)/cell-0.5, x=Math.floor(fx), ax=fx-x;
      const v=at(x,y)*(1-ax)*(1-ay)+at(x+1,y)*ax*(1-ay)+at(x,y+1)*(1-ax)*ay+at(x+1,y+1)*ax*ay;
      if(v>-100&&v<5000){out[k]=v;got++}}}
  return got;
}
// heights from national sources on a Web Mercator grid; NaN where none
// corner=true: nx*ny lattice including the edges (detail tiles); else cell centres (region grid)
async function demGrid(mx0,mx1,my0,my1,nx,ny,opt){
  opt=opt||{}; const out=new Float32Array(nx*ny).fill(NaN), cs=countriesIn(mx0,mx1,my0,my1); let got=0;
  if(cs.has("CH")||cs.has("LI"))got+=await chGrid(mx0,mx1,my0,my1,nx,ny,!!opt.corner,!!opt.fine,out,opt.onTile).catch(e=>{console.warn("swissALTI3D",e);return 0});
  if(cs.has("FR"))got+=await frGrid(mx0,mx1,my0,my1,nx,ny,!!opt.corner,out,opt.onTile).catch(e=>{console.warn("IGN",e);return 0});
  // detail tiles everywhere else (and where a national service failed): Mapterhorn at about 1 m
  if(opt.fine&&got<nx*ny)got+=await mtGrid(mx0,mx1,my0,my1,nx,ny,!!opt.corner,16,out).catch(e=>{console.warn("Mapterhorn",e);return 0});
  return got?out:null;
}
function sourceName(lon,lat){const c=country(lon,lat);
  return c==="CH"||c==="LI"?"swisstopo":c==="FR"?"IGN":c==="DE"?"Bayern":c==="AT"?"basemap.at":c==="IT"&&inBZ(lon,lat)?"Südtirol":null}
root.MMMSrc={country,orthoUrl,demGrid,sourceName,lv95,mtGrid,mtTiles};
})(typeof window!=="undefined"?window:globalThis);
