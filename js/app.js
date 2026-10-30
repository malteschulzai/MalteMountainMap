// Malte Mountain Map – 3D terrain with basemap.at orthophoto, slope, contours, winter model, GPX.
(async function(){
"use strict";
let REG=null;
if(window.MMM_REGION_PROMISE){
  try{REG=await window.MMM_REGION_PROMISE}
  catch(e){const l=document.getElementById("loading");l.hidden=false;l.innerHTML=`<div>${e.message}<br><br><a href="./" style="color:inherit">Zurück zur Nordkette</a></div>`;l.style.pointerEvents="auto";console.error(e);return}
}
const META=REG?REG.meta:window.MMM_META;
const APPV=(document.querySelector('script[src*="js/app.js"]').src.match(/v=(\d+)/)||[])[1]||"0";
const $=id=>document.getElementById(id);
const mapEl=$("map"), loadEl=$("loading"), statusEl=$("status");
const tick=msg=>{loadEl.textContent=msg;return new Promise(r=>setTimeout(r,20))};

// ---------- Grid: Web-Mercator metres, ~3 m on the ground ----------
const G=META.grid, W=G.W, H=G.H, N=W*H, R=6378137;
const mercX=lon=>R*lon*Math.PI/180, mercY=lat=>R*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const lonToX=lon=>(mercX(lon)-G.x0)/G.cell-0.5;
const latToY=lat=>(G.y1-mercY(lat))/G.cell-0.5;
const xToLon=x=>(G.x0+(x+0.5)*G.cell)/R*180/Math.PI;
const yToLat=y=>(2*Math.atan(Math.exp((G.y1-(y+0.5)*G.cell)/R))-Math.PI/2)*180/Math.PI;
const cellAt=y=>G.cell*Math.cos(yToLat(y)*Math.PI/180);
const CELL=cellAt(H/2), U=100, sc=CELL/U;
const fmt=(n,d=0)=>n.toLocaleString("de-AT",{minimumFractionDigits:d,maximumFractionDigits:d});
const small=Math.min(screen.width,screen.height)<700;

// ---------- Elevation ----------
let dm;
if(REG){dm=REG.dm}else{
await tick("Gelände wird geladen …");
const resp=await fetch("data/nordkette-dem.txt?v="+APPV);
if(!resp.ok)throw new Error("Geländedaten nicht erreichbar ("+resp.status+")");
let buf;{const bin=atob((await resp.text()).trim());buf=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i)}
let raw=buf;
if(buf[0]===0x1f&&buf[1]===0x8b){
  raw=window.DecompressionStream?new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()):window.pako.ungzip(buf);
}
const pred=new Int16Array(raw.buffer,raw.byteOffset,N);
dm=new Uint16Array(N); // decimetres
for(let y=0;y<H;y++){const o=y*W;
  for(let x=0;x<W;x++){const k=o+x;
    if(y===0)dm[k]=x===0?pred[k]:dm[k-1]+pred[k];
    else if(x===0)dm[k]=dm[k-W]+pred[k];
    else dm[k]=pred[k]+dm[k-1]+dm[k-W]-dm[k-W-1];
  }}
buf=raw=null;
}
const E=k=>dm[k]*0.1;
async function loadB64Gz(url){
  const r=await fetch(url); if(!r.ok)throw new Error("Daten nicht erreichbar ("+r.status+")");
  const bin=atob((await r.text()).trim()); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);
  if(b[0]===0x1f&&b[1]===0x8b)return window.DecompressionStream?new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()):window.pako.ungzip(b);
  return b;
}
const treesPromise=REG?Promise.resolve(REG.trees):META.trees?loadB64Gz("data/nordkette-trees.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);
const vegPromise=REG?Promise.resolve(REG.veg):META.veg?loadB64Gz("data/nordkette-veg.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);

// ---------- Terrain analysis -> data texture (R shade, G slope*4, B snow, A contours) ----------
await tick("Hangneigung wird berechnet …");
const data=new Uint8Array(N*4);
const slope4=new Uint8Array(N), aspect=new Uint8Array(N), south=new Uint8Array(N), southness=new Uint8Array(N);
{
  const az=315*Math.PI/180, alt=45*Math.PI/180;
  const Lx=Math.sin(az)*Math.cos(alt), Ly=Math.cos(az)*Math.cos(alt), Lz=Math.sin(alt);
  for(let y=0;y<H;y++){
    const c8=8*cellAt(y)*10, ym=Math.max(0,y-1)*W, y0=y*W, yp=Math.min(H-1,y+1)*W;
    for(let x=0;x<W;x++){
      const xm=Math.max(0,x-1), xp=Math.min(W-1,x+1);
      const a=dm[ym+xm],b=dm[ym+x],c=dm[ym+xp],d=dm[y0+xm],f=dm[y0+xp],g=dm[yp+xm],h=dm[yp+x],i=dm[yp+xp];
      const dzdx=((c+2*f+i)-(a+2*d+g))/c8, dzdy=((g+2*h+i)-(a+2*b+c))/c8;
      const k=y0+x, gr=Math.hypot(dzdx,dzdy);
      const s4=Math.min(255,Math.round(Math.atan(gr)*720/Math.PI));
      slope4[k]=s4;
      let asp=Math.atan2(-dzdx,dzdy)*180/Math.PI; if(asp<0)asp+=360;
      aspect[k]=Math.round(asp/45)%8;
      {const wgt=Math.min(1,Math.max(0,(s4/4-3)/9)); southness[k]=(0.5+((1-Math.cos(asp*Math.PI/180))/2-0.5)*wgt)*255;}
      south[k]=Math.min(255,Math.max(0,-dzdy)*200);
      data[k*4]=Math.max(0,(-dzdx*Lx+dzdy*Ly+Lz)/Math.sqrt(gr*gr+1))*255;
      data[k*4+1]=s4;
    }}
  for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){
    const k=y*W+x, b=Math.floor(dm[k]/200), br=Math.floor(dm[k+1]/200), bd=Math.floor(dm[k+W]/200);
    if(b!==br||b!==bd){const lvl=Math.max(b,br,bd)*20; data[k*4+3]=(lvl%100===0)?255:128}
  }
}
const slopeAt=k=>slope4[k]/4;
function elevAt(gx,gy){
  gx=Math.min(W-1.001,Math.max(0,gx)); gy=Math.min(H-1.001,Math.max(0,gy));
  const x=Math.floor(gx),y=Math.floor(gy),fx=gx-x,fy=gy-y,k=y*W+x;
  return 0.1*(dm[k]*(1-fx)*(1-fy)+dm[k+1]*fx*(1-fy)+dm[k+W]*(1-fx)*fy+dm[k+W+1]*fx*fy);
}
const idxAt=(gx,gy)=>Math.min(H-1,Math.max(0,Math.round(gy)))*W+Math.min(W-1,Math.max(0,Math.round(gx)));
const slopeClass=s=>s>=45?3:s>=40?2:s>=35?1:s>=30?0:-1;
const ASPECTS=["Nord","Nordost","Ost","Südost","Süd","Südwest","West","Nordwest"];

// ---------- Winter model ----------
// Relative snow cover from terrain: snow line, steepness, terrain form (gullies vs ridges),
// wind shelter behind edges and sun on south faces. Output 0..1 in the data texture.
function boxMean(r){
  const tmp=new Float32Array(N), out=new Float32Array(N);
  for(let y=0;y<H;y++){const o=y*W;let s=0,n=0;
    for(let x=0;x<Math.min(W,r);x++){s+=dm[o+x];n++}
    for(let x=0;x<W;x++){const a=x+r,b=x-r-1; if(a<W){s+=dm[o+a];n++} if(b>=0){s-=dm[o+b];n--} tmp[o+x]=s/n}}
  for(let x=0;x<W;x++){let s=0,n=0;
    for(let y=0;y<Math.min(H,r);y++){s+=tmp[y*W+x];n++}
    for(let y=0;y<H;y++){const a=y+r,b=y-r-1; if(a<H){s+=tmp[a*W+x];n++} if(b>=0){s-=tmp[b*W+x];n--} out[y*W+x]=s/n*0.1}}
  return out;
}
let form=null; // Int8: >0 hollow/gully (collects snow), <0 ridge/knoll
function computeForm(){
  form=new Int8Array(N);
  let m=boxMean(7); const t=new Float32Array(N);
  for(let k=0;k<N;k++)t[k]=(E(k)-m[k])/2.5;
  m=boxMean(35);
  for(let k=0;k<N;k++){const v=-(t[k]+(E(k)-m[k])/14);form[k]=Math.max(-100,Math.min(100,v*100))}
}
const WINDS={N:[0,-1],NO:[1,-1],O:[1,0],SO:[1,1],S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1]};
const STEPS=[2,4,6,9,13,18,24,32,42,55,70,90];
let shelter=null, shelterDir=null; // Int8 degrees: >0 lee, <0 exposed
function computeShelter(dir){
  shelter=shelter||new Int8Array(N);
  let [ux,uy]=WINDS[dir]; const l=Math.hypot(ux,uy); ux/=l; uy/=l;
  const offs=STEPS.map(s=>[Math.round(ux*s),Math.round(uy*s),s]);
  for(let y=0;y<H;y++){const c10=cellAt(y)*10;
    for(let x=0;x<W;x++){const k=y*W+x,e0=dm[k];let mx=-1e9;
      for(let i=0;i<offs.length;i++){const sx=x+offs[i][0],sy=y+offs[i][1];
        if(sx<0||sy<0||sx>=W||sy>=H)break;
        const tn=(dm[sy*W+sx]-e0)/(offs[i][2]*c10); if(tn>mx)mx=tn}
      shelter[k]=mx===-1e9?0:Math.max(-90,Math.min(90,Math.atan(mx)*180/Math.PI));
    }}
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
let winterKey=null;
// presets per snow amount: snow lines north/south, fill bonus, how much dwarf pine shows, snow on tree crowns
// lo/hi: how much "terrain snow index" is needed for full cover; steep: slope range where snow slides off;
// form/wind: how strongly ridges are scoured and hollows filled; sun: melt on south faces
const PRESETS=[
  {n:1500,s:1900,bonus:-0.30,form:0.75,wind:18,sun:0.50,steepLo:34,steepHi:50,lo:0.35,hi:0.98,bury:0.9,crown:0.20,ctx:0.75},
  {n:1000,s:1400,bonus:-0.08,form:0.55,wind:22,sun:0.40,steepLo:40,steepHi:56,lo:0.28,hi:0.84,bury:0.5,crown:0.42,ctx:0.9},
  {n:650, s:950, bonus:0.28, form:0.40,wind:30,sun:0.30,steepLo:46,steepHi:62,lo:0.18,hi:0.62,bury:0.0,crown:0.65,ctx:1}];
async function computeWinter(quiet){
  const key=[state.snow,state.wind,state.lineN,state.lineS].join("|"); if(key===winterKey)return;
  if(!quiet)loadEl.hidden=false;
  if(!form){await tick("Winter: Geländeformen …");computeForm()}
  if(shelterDir!==state.wind){await tick("Winter: Windschatten …");computeShelter(state.wind);shelterDir=state.wind}
  if(!quiet)await tick("Winter: Schnee wird verteilt …");
  const P=PRESETS[state.snow], LN=state.lineN, LD=state.lineS-state.lineN;
  for(let k=0;k<N;k++){
    const e=E(k), s=slopeAt(k), L=LN+LD*southness[k]/255;
    const fE=smooth(L-100,L+300,e);
    const fS=1-smooth(P.steepLo,P.steepHi,s);
    const sun=P.sun*Math.min(1,south[k]/160)*(1-smooth(L+500,L+1300,e));
    const v=fE*fS*(1+P.bonus+P.form*form[k]/100+shelter[k]/P.wind-sun);
    data[k*4+2]=smooth(P.lo,P.hi,v)*255;
  }
  dataTex.needsUpdate=true; winterKey=key; shared.bury.value=P.bury; shared.crownSnow.value=P.crown;
  shared.lineN.value=state.lineN; shared.lineS.value=state.lineS; shared.steepLo.value=P.steepLo-10; shared.steepHi.value=P.steepHi-12; shared.ctxAmt.value=P.ctx;
  shared.rockLo.value=P.steepLo+6; shared.rockHi.value=P.steepHi+2; needsRender=true;
  if(!quiet)loadEl.hidden=true;
}
const snowText=v=>v<0.12?"kaum Schnee, Fels oder abgeblasen":v<0.45?"lückige Schneedecke":v<0.85?"geschlossene Schneedecke":"durchgehend Schnee, Mulde oder Triebschnee";

// ---------- State ----------
const state={base:"ortho",slope:false,aspect:false,trees:true,contour:false,route:true,labels:true,pistes:true,paths:false,snowgrid:false,winter:true,wind:"NW",snow:2,lineN:650,lineS:950,exag:1};
// settings survive switching to another area of Tirol
const SAVE_KEYS=["base","slope","aspect","trees","contour","labels","pistes","paths","winter","wind","snow","lineN","lineS","exag"];
function saveState(){try{sessionStorage.setItem("mmm-state",JSON.stringify(Object.fromEntries(SAVE_KEYS.map(k=>[k,state[k]]))))}catch(e){}}
// restored only when the page was opened by switching to another area, a fresh start uses the defaults
if(REG&&new URLSearchParams(location.search).has("t"))try{const s=JSON.parse(sessionStorage.getItem("mmm-state")||"null"); if(s)SAVE_KEYS.forEach(k=>{if(k in s&&typeof s[k]===typeof state[k])state[k]=s[k]})}catch(e){}
let needsRender=true;

// ---------- three.js ----------
await tick("3D-Modell wird aufgebaut …");
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.setClearColor(0x000000,0);
mapEl.insertBefore(renderer.domElement,mapEl.firstChild);
const MAXTEX=renderer.capabilities.maxTextureSize;
const scene=new THREE.Scene(); window.MMM_debug={scene};
const camera=new THREE.PerspectiveCamera(45,1,0.1,800);
// ---------- Terrain height in world units (1 m detail tiles first, then 3 m grid) ----------
function heightGrid(gx,gy){const p=patchHeight(gx,gy);return p!==null?p:elevAt(gx,gy)}
function groundY(x,z){const gx=x/sc+W/2, gy=z/sc+H/2; if(gx<0||gy<0||gx>W-1||gy>H-1)return null; return heightGrid(gx,gy)/U*state.exag}
// march a ray over the height field; returns hit point or null
function rayTerrain(o,d){
  let t=0, prev=0;
  for(let i=0;i<600&&t<900;i++){
    const x=o.x+d.x*t, y=o.y+d.y*t, z=o.z+d.z*t, g=groundY(x,z);
    if(g!==null&&y<=g){
      let a=prev,b=t; for(let k=0;k<20;k++){const m=(a+b)/2, gm=groundY(o.x+d.x*m,o.z+d.z*m); if(gm!==null&&o.y+d.y*m<=gm)b=m; else a=m}
      return new THREE.Vector3(o.x+d.x*b,o.y+d.y*b,o.z+d.z*b);
    }
    prev=t; t+=Math.min(4,Math.max(0.01,g===null?2:(y-g)*0.45));
  }
  return null;
}
// Map gestures like Google Earth / FATMAP: grab-pan, pinch toward the fingers, twist to rotate,
// two-finger vertical drag to tilt, wheel zooms toward the cursor, right-drag rotates, glide after a flick.
function createControls(cam,dom){
  const C={target:new THREE.Vector3(),maxPolarAngle:1.3,minDistance:0.25,maxDistance:170,_l:[],
    addEventListener(t,f){if(t==="change")this._l.push(f)},update(){return step()}};
  const emit=()=>C._l.forEach(f=>f());
  const ptr=new Map(), rc=new THREE.Raycaster(), nd=new THREE.Vector2(), UP=new THREE.Vector3(0,1,0), pl=new THREE.Plane();
  let mode=null, grabH=0, grabPt=null, last=null, two=null, lock=null, vel=new THREE.Vector3(), lastMove=0, glide=false, tapT=0, tapXY=null;
  function rayAt(x,y){const r=dom.getBoundingClientRect();nd.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);rc.setFromCamera(nd,cam);return rc.ray}
  function onPlane(x,y,h){pl.set(UP,-h);const q=new THREE.Vector3();return rayAt(x,y).intersectPlane(pl,q)}
  function groundAt(x,y){const r=rayAt(x,y);return rayTerrain(r.origin,r.direction)||onPlane(x,y,C.target.y)}
  function translate(v){cam.position.add(v);C.target.add(v)}
  function rotateAround(p,a){const c=Math.cos(a),s=Math.sin(a);[cam.position,C.target].forEach(v=>{const dx=v.x-p.x,dz=v.z-p.z;v.x=p.x+dx*c-dz*s;v.z=p.z+dx*s+dz*c})}
  function zoomAround(p,f){const d=cam.position.distanceTo(C.target),n=Math.min(C.maxDistance,Math.max(C.minDistance,d*f));f=n/d;
    cam.position.sub(p).multiplyScalar(f).add(p);C.target.sub(p).multiplyScalar(f).add(p)}
  function orbit(dth,dph){const off=cam.position.clone().sub(C.target),s=new THREE.Spherical().setFromVector3(off);
    s.theta+=dth;s.phi=Math.max(0.03,Math.min(C.maxPolarAngle,s.phi+dph));off.setFromSpherical(s);cam.position.copy(C.target).add(off)}
  function finish(){
    const ext=Math.max(W,H)*sc*2.2; C.target.x=Math.max(-ext,Math.min(ext,C.target.x)); C.target.z=Math.max(-ext,Math.min(ext,C.target.z));
    const g=groundY(cam.position.x,cam.position.z); if(g!==null&&cam.position.y<g+0.08)cam.position.y=g+0.08;
    cam.lookAt(C.target); emit();
  }
  function gest(){const [a,b]=[...ptr.values()];return {mx:(a.x+b.x)/2,my:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y),ang:Math.atan2(b.y-a.y,b.x-a.x)}}
  function begin(e){
    glide=false; vel.set(0,0,0);
    if(ptr.size===1){const p=[...ptr.values()][0];
      if(e&&e.pointerType==="mouse"&&(e.button===2||e.ctrlKey||e.shiftKey||e.altKey)){mode="rotate";last={x:p.x,y:p.y}}
      else{mode="pan";const g=groundAt(p.x,p.y);
        // never grab on a plane at or above the camera (e.g. a summit seen from below a north face): drags would flip
        const lim=cam.position.y-0.35*Math.max(0.05,cam.position.y-C.target.y);
        grabH=Math.min(g?g.y:C.target.y,lim,C.target.y+0.6*(cam.position.y-C.target.y));grabPt=onPlane(p.x,p.y,grabH)}}
    else if(ptr.size>=2){mode="two";two=gest();lock=null;const g=groundAt(two.mx,two.my);two.h=g?g.y:C.target.y;two.sx=two.mx;two.sy=two.my;two.sd=two.d;two.sa=two.ang}
  }
  function move(){
    if(mode==="pan"){const p=[...ptr.values()][0],q=onPlane(p.x,p.y,grabH);
      if(q&&grabPt){const dv=grabPt.clone().sub(q);dv.y=0;
        // near the horizon the plane hit runs away; cap each step so the view cannot be flung off
        const d=cam.position.distanceTo(C.target), far=q.distanceTo(cam.position)>8*d+5;
        if(!far){const L=dv.length(), mx=0.35*d+0.05; if(L>mx)dv.multiplyScalar(mx/L); translate(dv);const now=performance.now();vel.lerp(dv,0.5);lastMove=now;finish()}}}
    else if(mode==="rotate"){const p=[...ptr.values()][0];orbit(-(p.x-last.x)*0.006,(p.y-last.y)*0.005);last={x:p.x,y:p.y};finish()}
    else if(mode==="two"&&ptr.size>=2){
      const g=gest();
      if(!lock){const dy=g.my-two.sy,dx=g.mx-two.sx,dd=Math.abs(g.d-two.sd);let da=Math.abs(g.ang-two.sa);if(da>Math.PI)da=2*Math.PI-da;
        if(Math.abs(dy)>10&&Math.abs(dx)<Math.abs(dy)*0.6&&dd<18&&da<0.12)lock="tilt";else if(Math.abs(dx)+Math.abs(dy)+dd>12||da>0.12)lock="pinch"}
      if(lock==="tilt"){orbit(0,(g.my-two.my)*0.006)}
      else if(lock==="pinch"){
        const q0=onPlane(two.mx,two.my,two.h),q1=onPlane(g.mx,g.my,two.h);
        if(q0&&q1){const dv=q0.sub(q1);dv.y=0;translate(dv)}
        const G=onPlane(g.mx,g.my,two.h);
        if(G){if(g.d>0&&two.d>0)zoomAround(G,two.d/g.d);let da=g.ang-two.ang;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;rotateAround(G,-da)}
      }
      two=Object.assign(two,{mx:g.mx,my:g.my,d:g.d,ang:g.ang});finish();
    }
  }
  dom.addEventListener("pointerdown",e=>{dom.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});begin(e)});
  dom.addEventListener("pointermove",e=>{const p=ptr.get(e.pointerId);if(!p)return;p.x=e.clientX;p.y=e.clientY;move()});
  const end=e=>{if(!ptr.has(e.pointerId))return;ptr.delete(e.pointerId);
    if(ptr.size===0){if(mode==="pan"&&performance.now()-lastMove<60&&vel.length()>0.002)glide=true;mode=null;
      // double tap zooms in
      if(e.pointerType!=="mouse"){const now=performance.now();if(tapXY&&now-tapT<300&&Math.hypot(e.clientX-tapXY.x,e.clientY-tapXY.y)<25){const g=groundAt(e.clientX,e.clientY);if(g){zoomAround(g,0.5);finish()}tapXY=null}else{tapT=now;tapXY={x:e.clientX,y:e.clientY}}}}
    else begin(null)};
  dom.addEventListener("pointerup",end); dom.addEventListener("pointercancel",end);
  dom.addEventListener("wheel",e=>{e.preventDefault();glide=false;const g=groundAt(e.clientX,e.clientY);if(g){zoomAround(g,Math.exp(Math.max(-120,Math.min(120,e.deltaY))*0.0022));finish()}},{passive:false});
  dom.addEventListener("dblclick",e=>{const g=groundAt(e.clientX,e.clientY);if(g){zoomAround(g,0.5);finish()}});
  dom.addEventListener("contextmenu",e=>e.preventDefault());
  function step(){
    let ch=false;
    if(glide){const d=cam.position.distanceTo(C.target);if(vel.length()>0.15*d)vel.setLength(0.15*d);translate(vel);vel.multiplyScalar(0.9);if(vel.length()<0.0005)glide=false;ch=true}
    if(ptr.size===0){const g=groundY(C.target.x,C.target.z);if(g!==null&&Math.abs(g-C.target.y)>0.002){const d=(g-C.target.y)*0.12;C.target.y+=d;cam.position.y+=d;ch=true}}
    if(ch)finish(); else cam.lookAt(C.target);
    return ch;
  }
  return C;
}
const controls=createControls(camera,renderer.domElement);

const dataTex=new THREE.DataTexture(data,W,H,THREE.RGBAFormat);
dataTex.magFilter=THREE.LinearFilter; dataTex.minFilter=THREE.LinearFilter; dataTex.generateMipmaps=false;
dataTex.needsUpdate=true;
const blank=new THREE.DataTexture(new Uint8Array([128,140,120,255]),1,1,THREE.RGBAFormat); blank.needsUpdate=true;
const aspectTex=(()=>{const a=new Uint8Array(N);for(let k=0;k<N;k++)a[k]=aspect[k]*32+16;
  const t=new THREE.DataTexture(a,W,H,THREE.LuminanceFormat);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t})();
function blank0(){const b=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1,THREE.RGBAFormat);b.needsUpdate=true;return b}

const shared={
  globalMap:{value:blank}, dataMap:{value:dataTex}, vegMap:{value:blank0()}, aspectMap:{value:aspectTex}, showAspect:{value:0}, sgMap:{value:blank0()}, showSG:{value:0}, globalShade:{value:blank0()}, orthoReady:{value:0}, shadeReady:{value:0}, bury:{value:0.35}, crownSnow:{value:0.65},
  mode:{value:0}, showSlope:{value:0}, showContour:{value:0}, winter:{value:0},
  camPos:{value:new THREE.Vector3()}, haze:{value:new THREE.Color(0xd3e0ea)},
  lineN:{value:650}, lineS:{value:950}, steepLo:{value:36}, steepHi:{value:50}, ctxAmt:{value:1},
  exag:{value:1}, rockLo:{value:52}, rockHi:{value:64},
  fogNear:{value:25}, fogFar:{value:420}
};
const VERT=`
attribute vec2 uvLocal;
varying vec2 vUv; varying vec2 vUv2; varying float vElev; varying vec3 vWorld; varying vec3 vNrm;
void main(){
  vUv=uv; vUv2=uvLocal; vElev=position.y*100.0; vNrm=normal;
  vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const FRAG=`
uniform sampler2D globalMap, localMap, dataMap, vegMap, globalShade, localShade, aspectMap;
uniform float showAspect, treesOn, isPatch, useFineSlope, showSG;
uniform sampler2D sgMap;
uniform sampler2D maskMap, fineSlope;
uniform float exag, rockLo, rockHi;
varying vec3 vNrm;
uniform float useLocal, useLocalShade, orthoReady, shadeReady, mode, showSlope, showContour, winter, fogNear, fogFar, bury, crownSnow;
uniform vec3 camPos, haze;
varying vec2 vUv; varying vec2 vUv2; varying float vElev; varying vec3 vWorld;
vec3 hyps(float e){
  vec3 c=mix(vec3(.84,.87,.80),vec3(.89,.90,.82),smoothstep(500.,1100.,e));
  c=mix(c,vec3(.93,.91,.85),smoothstep(1100.,1700.,e));
  c=mix(c,vec3(.89,.87,.84),smoothstep(1700.,2200.,e));
  return mix(c,vec3(.94,.94,.93),smoothstep(2200.,2700.,e));
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
vec3 snowCol(float s){ return mix(vec3(.79,.855,.95), vec3(1.0), smoothstep(0.08,0.66,s)); }
void main(){
  vec2 dUv=vec2(vUv.x,1.0-vUv.y);
  vec4 d=texture2D(dataMap,dUv);
  vec4 vg=texture2D(vegMap,dUv);
  if(isPatch<0.5 && texture2D(maskMap,dUv).r>0.5) discard;   // a 1 m detail tile covers this spot
  float shade=d.r, slope=(useFineSlope>0.5?texture2D(fineSlope,vUv2).r:d.g)*63.75, snow=d.b, cont=d.a;
  float tree=vg.r, shrub=vg.a;
  // fine 50 cm hillshades from Land Tirol: r = terrain, g = surface (trees, shrubs)
  float sg=shade, so=shade; bool fine=false;
  if(useLocalShade>0.5){ vec4 f=texture2D(localShade,vUv2); sg=f.r; so=f.g; fine=true; if(f.b>0.5){sg=shade;so=shade;fine=false;} }
  else if(shadeReady>0.5){ vec4 f=texture2D(globalShade,vUv); sg=f.r; so=f.g; fine=true; if(f.b>0.5){sg=shade;so=shade;fine=false;} }
  float light=0.42+0.72*sg;
  vec4 oc = useLocal>0.5 ? texture2D(localMap,vUv2) : texture2D(globalMap,vUv);
  bool ortho = mode<0.5 && (orthoReady>0.5 || useLocal>0.5) && oc.a>0.5;
  float rock=smoothstep(38.,58.,slope)*step(1000.,vElev);
  vec3 col; float olum=0.5;
  if(ortho){
    col = oc.rgb;
    olum=dot(col,vec3(.299,.587,.114));
    col *= mix(1.0, 0.72+0.5*sg, 0.38);
    float l2=dot(col,vec3(.299,.587,.114));
    col = clamp(mix(vec3(l2),col,1.18),0.0,1.0);
    col = pow(col, vec3(0.93))*1.03;
  } else {
    col = hyps(vElev)*light;
    col = mix(col, vec3(.55,.52,.49)*light, rock);
    col = mix(col, vec3(.60,.64,.45)*(0.45+0.75*so), shrub*0.75);
    col = mix(col, vec3(.38,.49,.33)*(0.40+0.80*so), tree*0.9);
  }
  // detail tiles: light from the 1 m geometry and a rock look on steep faces instead of the stretched photo
  float geoL=sg, steepF=0.0;
  if(isPatch>0.5){
    vec3 n=normalize(vec3(vNrm.x,vNrm.y/max(exag,0.01),vNrm.z));
    geoL=clamp(dot(n,normalize(vec3(-0.5,0.72,-0.48))),0.0,1.0);
    steepF=smoothstep(46.0,64.0,slope)*step(900.0,vElev);
    float g1=hash(floor(vec2(vWorld.x+vWorld.z,vWorld.y)*60.0)), g2=hash(floor(vec2(vWorld.x-vWorld.z,vWorld.y)*150.0));
    float l=dot(col,vec3(.299,.587,.114));
    vec3 rockBase=ortho?mix(vec3(l)*vec3(1.03,1.0,0.95),col,0.3):vec3(.56,.53,.50);
    vec3 rk=rockBase*(0.22+1.05*geoL)*(0.86+0.2*g1+0.08*g2);
    col=mix(col*mix(1.0,0.72+0.5*geoL,0.4),rk,steepF);
  }
  if(winter>0.5){
    float tr=smoothstep(0.06,0.4,tree), sr=smoothstep(0.06,0.4,shrub);
    float obj = fine ? clamp(abs(so-sg)*3.2-0.07,0.0,1.0) : 0.5;   // something stands above the ground
    obj *= (1.0-smoothstep(38.0,52.0,slope))*(1.0-smoothstep(1950.0,2200.0,vElev));
    tr *= 1.0-smoothstep(42.0,55.0,slope); sr *= 1.0-smoothstep(45.0,58.0,slope);
    float crownT=obj*tr*(1.0-0.85*treesOn);
    if(ortho) crownT=max(crownT, smoothstep(0.30,0.13,olum)*tr);
    // Latschen: clumps of a few metres; "bury" decides which share still sticks out of the snow
    float clump=0.62*vnoise(vWorld.xz*11.0)+0.26*vnoise(vWorld.xz*32.0)+0.12*obj;
    sr*=1.0-smoothstep(2050.0,2250.0,vElev);
    float crownS=mix(sr*smoothstep(1.0-bury-0.07,1.0-bury+0.07,clump), sr*bury*0.8, smoothstep(28.0,70.0,length(vWorld-camPos)));
    vec3 crownC=mix(vec3(.08,.14,.10)*(0.55+0.95*so), snowCol(so)*0.97, crownSnow*smoothstep(0.48,0.85,so));
    vec3 shrubC=mix(vec3(.09,.16,.09)*(0.55+0.9*so), snowCol(so), 0.18);
    vec3 w=snowCol(isPatch>0.5?mix(sg,geoL,0.55):sg);
    w=mix(w, shrubC, clamp(crownS,0.0,1.0)*0.92);
    w=mix(w, crownC, clamp(crownT*1.15,0.0,1.0)*0.93);
    vec3 under=col;
    if(ortho&&isPatch<0.5){ vec3 rk=clamp((under-0.45)*1.35+0.36,0.0,1.0); under=mix(under,rk,rock); }
    else under=mix(under, vec3(.38,.36,.35)*light, rock);
    float vis=smoothstep(0.12,0.88,clamp(snow+(sg-shade)*0.8,0.0,1.0));
    if(isPatch>0.5) vis*=1.0-smoothstep(rockLo,rockHi,slope);
    col=mix(under,w,vis);
  }
  if(showSG>0.5){
    // SNOWGRID snow depth (GeoSphere Austria, 1 km), stored as cm/2; alpha 0 where there is no value
    vec4 sgv=texture2D(sgMap,dUv); float cm=sgv.r*510.0;
    if(sgv.a>0.5 && cm>=1.0){
      vec3 c=mix(vec3(.80,.92,1.0),vec3(.52,.76,.95),smoothstep(1.0,30.0,cm));
      c=mix(c,vec3(.20,.50,.86),smoothstep(30.0,80.0,cm));
      c=mix(c,vec3(.13,.27,.70),smoothstep(80.0,150.0,cm));
      c=mix(c,vec3(.33,.16,.60),smoothstep(150.0,250.0,cm));
      c=mix(c,vec3(.55,.10,.45),smoothstep(250.0,400.0,cm));
      col=mix(col,c*(0.75+0.35*light),0.62);
    }
  }
  if(showAspect>0.5 && slope>=8.0){
    float a=floor(texture2D(aspectMap,dUv).r*255.0/32.0);
    vec3 ac = a<0.5?vec3(.16,.32,.80): a<1.5?vec3(.18,.66,.86): a<2.5?vec3(.30,.70,.30): a<3.5?vec3(.93,.80,.20): a<4.5?vec3(.88,.26,.16): a<5.5?vec3(.86,.38,.66): a<6.5?vec3(.55,.33,.78): vec3(.22,.22,.55);
    col=mix(col,ac,0.5);
  }
  if(showSlope>0.5 && slope>=30.0){
    vec3 sc = slope>=45.0?vec3(.48,.18,.56):slope>=40.0?vec3(.84,.19,.12):slope>=35.0?vec3(.93,.54,.17):vec3(.95,.82,.23);
    col=mix(col,sc,0.55);
  }
  if(showContour>0.5 && cont>0.3){ col=mix(col,vec3(.36,.27,.20),cont>0.75?0.55:0.25); }
  float dist=length(vWorld-camPos);
  col=mix(col,haze,smoothstep(fogNear,fogFar,dist)*(winter>0.5?0.55:0.7));
  gl_FragColor=vec4(col,1.0);
}`;


// ---------- Terrain chunks ----------
const CX=4, CY=4, CW=Math.ceil(W/CX), CH=Math.ceil(H/CY);
const STEP=G.cell*Math.cos(47.2*Math.PI/180)>4?(small?3:2):(small?4:2);
const terrain=new THREE.Group(); scene.add(terrain);
const chunks=[];
function axis(a,b){const r=[];for(let v=a;v<b;v+=STEP)r.push(v);r.push(b);return r}
for(let cj=0;cj<CY;cj++)for(let ci=0;ci<CX;ci++){
  const gx0=ci*CW, gx1=Math.min(W-1,(ci+1)*CW), gy0=cj*CH, gy1=Math.min(H-1,(cj+1)*CH);
  const xs=axis(gx0,gx1), ys=axis(gy0,gy1), nx=xs.length, ny=ys.length;
  const pos=new Float32Array(nx*ny*3), uv=new Float32Array(nx*ny*2), uv2=new Float32Array(nx*ny*2);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const gx=xs[i], gy=ys[j], v=j*nx+i;
    pos[v*3]=(gx-W/2)*sc; pos[v*3+1]=E(gy*W+gx)/U; pos[v*3+2]=(gy-H/2)*sc;
    uv[v*2]=(gx+0.5)/W; uv[v*2+1]=1-(gy+0.5)/H;
    uv2[v*2]=(gx-gx0)/(gx1-gx0); uv2[v*2+1]=1-(gy-gy0)/(gy1-gy0);
  }
  const idxA=[];
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const a=j*nx+i,b=a+1,c=a+nx,d=c+1; idxA.push(a,c,b,b,c,d);
  }
  const P=[...pos], UV=[...uv], UV2=[...uv2];
  const edges=[];
  if(gx0===0)edges.push([...Array(ny).keys()].map(j=>j*nx));
  if(gx1===W-1)edges.push([...Array(ny).keys()].map(j=>j*nx+nx-1));
  if(gy0===0)edges.push([...Array(nx).keys()]);
  if(gy1===H-1)edges.push([...Array(nx).keys()].map(i=>(ny-1)*nx+i));
  for(const e of edges){
    const base=P.length/3;
    e.forEach(v=>{P.push(P[v*3],P[v*3+1]-0.6,P[v*3+2]);UV.push(UV[v*2],UV[v*2+1]);UV2.push(UV2[v*2],UV2[v*2+1])});
    for(let s=0;s<e.length-1;s++){const a=e[s],b=e[s+1],c=base+s,d=base+s+1;idxA.push(a,c,b,b,c,d,a,b,c,b,d,c)}
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(new Float32Array(P),3));
  geo.setAttribute("uv",new THREE.BufferAttribute(new Float32Array(UV),2));
  geo.setAttribute("uvLocal",new THREE.BufferAttribute(new Float32Array(UV2),2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idxA),1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const uniforms=Object.assign({},shared,{localMap:{value:blank},useLocal:{value:0},localShade:{value:blank},useLocalShade:{value:0},treesOn:{value:0}});
  const mesh=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms,vertexShader:VERT,fragmentShader:FRAG,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2}));
  terrain.add(mesh);
  // chunk extent in mercator metres (vertex centres)
  const mx0=G.x0+(gx0+0.5)*G.cell, mx1=G.x0+(gx1+0.5)*G.cell, my1=G.y1-(gy0+0.5)*G.cell, my0=G.y1-(gy1+0.5)*G.cell;
  chunks.push({mesh,uniforms,gx0,gx1,gy0,gy1,mx0,mx1,my0,my1,z:0,loading:0,want:0});
}
terrain.scale.y=state.exag;
vegPromise.then(v=>{
  if(!v)return;
  const vt=new THREE.DataTexture(v,META.veg.W,META.veg.H,THREE.LuminanceAlphaFormat);
  vt.magFilter=THREE.LinearFilter; vt.minFilter=THREE.LinearFilter; vt.generateMipmaps=false; vt.needsUpdate=true;
  shared.vegMap.value=vt; needsRender=true;
});

// ---------- 3D trees (tree tops from laser scan: surface minus terrain) ----------
const treeGroup=new THREE.Group(); treeGroup.scale.y=state.exag; scene.add(treeGroup);
let treeData=null; const treeOffsets=[];
// low-poly fir: two tiers, each an apex plus a ring (no hidden or degenerate triangles)
const treeGeo=(()=>{
  const tiers=[[0.5,0.12,0.74],[0.34,0.5,1.0]], seg=6, pos=[], nor=[];
  for(const [r,y0,y1] of tiers){
    const k=r/(y1-y0);
    for(let i=0;i<seg;i++){
      const a0=i/seg*Math.PI*2, a1=(i+1)/seg*Math.PI*2, am=(a0+a1)/2;
      pos.push(0,y1,0, Math.sin(a0)*r,y0,Math.cos(a0)*r, Math.sin(a1)*r,y0,Math.cos(a1)*r);
      const nx=Math.sin(am), nz=Math.cos(am), ny=k; const l=Math.hypot(nx,ny,nz);
      for(let v=0;v<3;v++)nor.push(nx/l,ny/l,nz/l);
    }
  }
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); g.setAttribute("normal",new THREE.Float32BufferAttribute(nor,3)); return g;
})();
const treeMat=new THREE.ShaderMaterial({
  uniforms:{winter:shared.winter,crownSnow:shared.crownSnow,camPos:shared.camPos,haze:shared.haze,fogNear:shared.fogNear,fogFar:shared.fogFar},
  vertexShader:`
    varying vec3 vN; varying vec3 vW; varying float vR; varying float vY;
    void main(){
      mat4 m=modelMatrix*instanceMatrix; vec4 wp=m*vec4(position,1.0); vW=wp.xyz; vY=position.y;
      vN=normalize(mat3(m)*normal);
      vR=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`,
  fragmentShader:`
    uniform float winter, crownSnow, fogNear, fogFar; uniform vec3 camPos, haze;
    varying vec3 vN; varying vec3 vW; varying float vR; varying float vY;
    void main(){
      vec3 n=normalize(vN); vec3 L=normalize(vec3(-0.55,0.75,-0.45));
      float diff=max(dot(n,L),0.0), lit=0.38+0.75*diff;
      vec3 col=mix(vec3(.09,.17,.11),vec3(.17,.28,.15),vR)*lit*(0.8+0.3*vY);
      if(winter>0.5){
        float s=crownSnow*smoothstep(0.0,0.6,n.y+0.45*diff-0.15)*(0.55+0.45*vR);
        col=mix(col, vec3(.93,.95,1.0)*(0.72+0.3*diff), clamp(s,0.0,0.9));
      }
      col=mix(col,haze,smoothstep(fogNear,fogFar,length(vW-camPos))*(winter>0.5?0.55:0.7));
      gl_FragColor=vec4(col,1.0);
    }`
});
// trees are grouped into ~250 m cells so only the nearby ones are built
const TB=48, tBins=new Map(), tBuilt=new Map();
treesPromise.then(b=>{
  if(!b)return;
  const n=META.trees.n; treeData={x:new Uint16Array(b.buffer,b.byteOffset,n),y:new Uint16Array(b.buffer,b.byteOffset+2*n,n),h:new Uint8Array(b.buffer,b.byteOffset+4*n,n)};
  const tmp=new Map();
  for(let i=0;i<n;i++){const k=Math.floor(treeData.y[i]/16/TB)*1000+Math.floor(treeData.x[i]/16/TB); let a=tmp.get(k); if(!a)tmp.set(k,a=[]); a.push(i)}
  for(const [k,a] of tmp){const bx=k%1000, by=Math.floor(k/1000), gx=(bx+0.5)*TB, gy=(by+0.5)*TB;
    tBins.set(k,{idx:Uint32Array.from(a),gx,gy})}
  scheduleLOD();
});
const TREE_MAX=small?70000:180000, TREE_DIST=small?12:26;
const _m=new THREE.Matrix4(), _p=new THREE.Vector3(), _q=new THREE.Quaternion(), _s=new THREE.Vector3(), _up=new THREE.Vector3(0,1,0);
function buildBin(k){
  if(tBuilt.has(k))return; const bin=tBins.get(k), cnt=bin.idx.length;
  const mesh=new THREE.InstancedMesh(treeGeo,treeMat,cnt); mesh.frustumCulled=false; let m=0;
  for(let j=0;j<cnt;j++){const i=bin.idx[j];
    const gx=treeData.x[i]/16, gy=treeData.y[i]/16, h=treeData.h[i]/4, k=idxAt(gx,gy);
    if(slopeAt(k)>42||E(k)>2150)continue;
    const ps=patchSlope(gx,gy); if(ps!==null&&ps>50)continue;
    _p.set((gx-W/2)*sc, heightGrid(gx,gy)/U, (gy-H/2)*sc);
    _q.setFromAxisAngle(_up,(i*2.399)%6.283);
    const wdt=Math.max(1.6,h*0.38)/U; _s.set(wdt,h/U,wdt);
    mesh.setMatrixAt(m++,_m.compose(_p,_q,_s));
  }
  mesh.count=m;
  mesh.instanceMatrix.needsUpdate=true; treeGroup.add(mesh); tBuilt.set(k,mesh); needsRender=true;
}
function dropBin(k){const m=tBuilt.get(k); if(!m)return; treeGroup.remove(m); m.dispose(); tBuilt.delete(k); needsRender=true}
function updateTrees(){
  if(!treeData)return;
  const want=new Set();
  if(state.trees){
    const cp=camera.position, list=[];
    for(const [k,b] of tBins){const x=(b.gx-W/2)*sc, z=(b.gy-H/2)*sc, y=elevAt(b.gx,b.gy)/U*state.exag, d=Math.hypot(x-cp.x,y-cp.y,z-cp.z)-TB*sc*0.7;
      if(d<TREE_DIST)list.push([k,d,b.idx.length])}
    list.sort((a,b)=>a[1]-b[1]); let used=0;
    for(const [k,,c] of list){if(used+c>TREE_MAX)break; used+=c; want.add(k)}
  }
  [...tBuilt.keys()].forEach(k=>{if(!want.has(k))dropBin(k)});
  let built=0; for(const k of want){if(!tBuilt.has(k)){buildBin(k);if(++built>=12){scheduleLOD();break}}}
}

// ---------- 1 m detail tiles near the camera (Land Tirol laser scan via WCS) ----------
const WCS="https://gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WCSServer";
const PZ=16, PN=513, PSTEP=small?4:2, PMAX=small?4:12, PDIST=small?14:26;
var patches=new Map();
const MW=Math.ceil(W/4), MH=Math.ceil(H/4), maskData=new Uint8Array(MW*MH);
const maskTex=new THREE.DataTexture(maskData,MW,MH,THREE.LuminanceFormat);
maskTex.magFilter=maskTex.minFilter=THREE.NearestFilter; maskTex.generateMipmaps=false; maskTex.needsUpdate=true;
shared.maskMap={value:maskTex}; shared.isPatch={value:0}; shared.useFineSlope={value:0}; shared.fineSlope={value:blank0()};
chunks.forEach(c=>{c.uniforms.maskMap=shared.maskMap;c.uniforms.isPatch=shared.isPatch;c.uniforms.useFineSlope=shared.useFineSlope;c.uniforms.fineSlope=shared.fineSlope});
const TILEM=2*20037508.342789244/2**PZ;
const gxOfMx=mx=>(mx-G.x0)/G.cell-0.5, gyOfMy=my=>(G.y1-my)/G.cell-0.5;
function patchHeight(gx,gy){
  if(!patches||!patches.size)return null;
  const mx=G.x0+(gx+0.5)*G.cell, my=G.y1-(gy+0.5)*G.cell;
  const p=patches.get(Math.floor((mx+ORIGIN)/TILEM)+"/"+Math.floor((ORIGIN-my)/TILEM));
  if(!p||!p.dem)return null;
  const fx=(mx-p.mx0)/(p.mx1-p.mx0)*(PN-1), fy=(p.my1-my)/(p.my1-p.my0)*(PN-1);
  const x=Math.min(PN-2,Math.max(0,Math.floor(fx))), y=Math.min(PN-2,Math.max(0,Math.floor(fy))), ax=fx-x, ay=fy-y, k=y*PN+x, D=p.dem;
  return D[k]*(1-ax)*(1-ay)+D[k+1]*ax*(1-ay)+D[k+PN]*(1-ax)*ay+D[k+PN+1]*ax*ay;
}
function patchSlope(gx,gy){
  if(!patches||!patches.size)return null;
  const mx=G.x0+(gx+0.5)*G.cell, my=G.y1-(gy+0.5)*G.cell;
  const p=patches.get(Math.floor((mx+ORIGIN)/TILEM)+"/"+Math.floor((ORIGIN-my)/TILEM));
  if(!p||!p.slope)return null;
  const x=Math.round((mx-p.mx0)/(p.mx1-p.mx0)*(PN-1)), y=Math.round((p.my1-my)/(p.my1-p.my0)*(PN-1));
  return p.slope[(PN-1-Math.min(PN-1,Math.max(0,y)))*PN+Math.min(PN-1,Math.max(0,x))]/4;
}
function rebuildMask(){
  maskData.fill(0);
  for(const p of patches.values()){ if(!p.mesh)continue;
    const ga=Math.ceil(gxOfMx(p.mx0)+0.5), gb=Math.floor(gxOfMx(p.mx1)-0.5), ha=Math.ceil(gyOfMy(p.my1)+0.5), hb=Math.floor(gyOfMy(p.my0)-0.5);
    for(let my=Math.ceil(ha/4);my<=Math.floor((hb+1)/4)-1;my++){if(my<0||my>=MH)continue;
      for(let mx=Math.ceil(ga/4);mx<=Math.floor((gb+1)/4)-1;mx++){if(mx>=0&&mx<MW)maskData[my*MW+mx]=255}}
  }
  maskTex.needsUpdate=true; needsRender=true;
}
async function fetchDem(mx0,mx1,my0,my1){
  const midLon=MMMGeo.mercToLonLat((mx0+mx1)/2,(my0+my1)/2)[0];
  const order=midLon<11.7?[28,31]:[31,28];
  let last=null;
  for(const z of order){try{const d=await fetchDemZone(mx0,mx1,my0,my1,z); if(d)return d}catch(e){last=e}}
  throw last||new Error("keine Daten");
}
async function fetchDemZone(mx0,mx1,my0,my1,zone){
  // GK West coordinates of the tile on a coarse lattice, interpolated for every sample
  const L=9, lat=[];
  for(let j=0;j<L;j++)for(let i=0;i<L;i++)lat.push(MMMGeo.mercToGK(mx0+(mx1-mx0)*i/(L-1),my1-(my1-my0)*j/(L-1),zone));
  let e0=1e12,e1=-1e12,n0=1e12,n1=-1e12; lat.forEach(([e,n])=>{e0=Math.min(e0,e);e1=Math.max(e1,e);n0=Math.min(n0,n);n1=Math.max(n1,n)});
  e0=Math.floor(e0-4);n0=Math.floor(n0-4);e1=Math.ceil(e1+4);n1=Math.ceil(n1+4);
  const url=`${WCS}?service=WCS&version=1.0.0&request=GetCoverage&coverage=Gelaendemodell_50cm_M${zone}&CRS=EPSG:${zone===31?31255:31254}&BBOX=${e0},${n0},${e1},${n1}&RESX=1&RESY=1&FORMAT=GeoTIFF&INTERPOLATION=bilinear`;
  const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw new Error("WCS "+r.status);
  const tif=MMMGeo.readTiff(await r.arrayBuffer());
  const rx=(e1-e0)/tif.w, ry=(n1-n0)/tif.h, dem=new Float32Array(PN*PN); let bad=0;
  for(let j=0;j<PN;j++){const v=j/(PN-1)*(L-1), lj=Math.min(L-2,Math.floor(v)), fv=v-lj;
    for(let i=0;i<PN;i++){const u=i/(PN-1)*(L-1), li=Math.min(L-2,Math.floor(u)), fu=u-li;
      const a=lat[lj*L+li],b=lat[lj*L+li+1],c=lat[(lj+1)*L+li],d=lat[(lj+1)*L+li+1];
      const E=(a[0]*(1-fu)+b[0]*fu)*(1-fv)+(c[0]*(1-fu)+d[0]*fu)*fv, Nn=(a[1]*(1-fu)+b[1]*fu)*(1-fv)+(c[1]*(1-fu)+d[1]*fu)*fv;
      const cx=(E-e0)/rx-0.5, cy=(n1-Nn)/ry-0.5, x=Math.min(tif.w-2,Math.max(0,Math.floor(cx))), y=Math.min(tif.h-2,Math.max(0,Math.floor(cy))), ax=cx-x, ay=cy-y, k=y*tif.w+x, T=tif.data;
      const c4=[T[k],T[k+1],T[k+tif.w],T[k+tif.w+1]];
      let h=c4.every(q=>q>200&&q<5000)?c4[0]*(1-ax)*(1-ay)+c4[1]*ax*(1-ay)+c4[2]*(1-ax)*ay+c4[3]*ax*ay:NaN;
      if(!(h>200&&h<5000)){bad++;h=elevAt(gxOfMx(mx0+(mx1-mx0)*i/(PN-1)),gyOfMy(my1-(my1-my0)*j/(PN-1)))}
      dem[j*PN+i]=h;
    }}
  return bad>PN*PN*0.4?null:dem;
}
function slopeOf(dem,mx0,mx1,my1){
  const dx=(mx1-mx0)/(PN-1)*Math.cos(mercLat(my1)*Math.PI/180), out=new Uint8Array(PN*PN);
  for(let j=0;j<PN;j++)for(let i=0;i<PN;i++){
    const im=Math.max(0,i-1),ip=Math.min(PN-1,i+1),jm=Math.max(0,j-1),jp=Math.min(PN-1,j+1);
    const zx=(dem[j*PN+ip]-dem[j*PN+im])/((ip-im)*dx), zy=(dem[jp*PN+i]-dem[jm*PN+i])/((jp-jm)*dx);
    out[(PN-1-j)*PN+i]=Math.min(255,Math.round(Math.atan(Math.hypot(zx,zy))*720/Math.PI));
  }
  return out;
}
const mercLat=my=>(2*Math.atan(Math.exp(my/R))-Math.PI/2)*180/Math.PI;
function patchMesh(p){
  const n=Math.floor((PN-1)/PSTEP)+1, pos=[], uv=[], uvl=[], idx=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const si=i*PSTEP, sj=j*PSTEP, mx=p.mx0+(p.mx1-p.mx0)*si/(PN-1), my=p.my1-(p.my1-p.my0)*sj/(PN-1), gx=gxOfMx(mx), gy=gyOfMy(my);
    pos.push((gx-W/2)*sc,p.dem[sj*PN+si]/U,(gy-H/2)*sc); uv.push((gx+0.5)/W,1-(gy+0.5)/H); uvl.push(si/(PN-1),1-sj/(PN-1));
  }
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const a=j*n+i,b=a+1,c=a+n,d=c+1;idx.push(a,c,b,b,c,d)}
  const edges=[[...Array(n).keys()],[...Array(n).keys()].map(i=>(n-1)*n+i),[...Array(n).keys()].map(j=>j*n),[...Array(n).keys()].map(j=>j*n+n-1)];
  for(const e of edges){const base=pos.length/3;
    e.forEach(v=>{pos.push(pos[v*3],pos[v*3+1]-0.06,pos[v*3+2]);uv.push(uv[v*2],uv[v*2+1]);uvl.push(uvl[v*2],uvl[v*2+1])});
    for(let s=0;s<e.length-1;s++){const a=e[s],b=e[s+1],c=base+s,d=base+s+1;idx.push(a,c,b,b,c,d,a,b,c,b,d,c)}}
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2)); g.setAttribute("uvLocal",new THREE.Float32BufferAttribute(uvl,2));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
let patchBusy=0;
async function loadPatch(p){
  patchBusy++; p.loading=true;
  try{
    const [dem,ortho,shade]=await Promise.all([fetchDem(p.mx0,p.mx1,p.my0,p.my1),renderOrtho(p.mx0,p.mx1,p.my0,p.my1,18).catch(()=>null),renderShade(p.mx0,p.mx1,p.my0,p.my1,1024,1024).catch(()=>null)]);
    if(!patches.has(p.key)){patchBusy--;return}
    p.dem=dem; p.slope=slopeOf(dem,p.mx0,p.mx1,p.my1);
    const st=new THREE.DataTexture(p.slope,PN,PN,THREE.LuminanceFormat); st.magFilter=THREE.LinearFilter; st.minFilter=THREE.LinearFilter; st.generateMipmaps=false; st.needsUpdate=true;
    const an=renderer.capabilities.getMaxAnisotropy(), tex=cv=>{if(!cv)return null;const t=new THREE.CanvasTexture(cv);t.anisotropy=an;return t};
    p.tex=[tex(ortho),tex(shade),st];
    const u=Object.assign({},shared,{localMap:{value:p.tex[0]||blank},useLocal:{value:p.tex[0]?1:0},localShade:{value:p.tex[1]||blank},useLocalShade:{value:p.tex[1]?1:0},
      treesOn:{value:0},isPatch:{value:1},useFineSlope:{value:1},fineSlope:{value:st}});
    p.mesh=new THREE.Mesh(patchMesh(p),new THREE.ShaderMaterial({uniforms:u,vertexShader:VERT,fragmentShader:FRAG}));
    terrain.add(p.mesh); rebuildMask(); refreshNear(p); scheduleOverlay();
    if(lastMarker)placeMarker(lastMarker[0],lastMarker[1]);
  }catch(e){console.warn("Detailkachel",p.key,e);p.failed=true}
  p.loading=false; patchBusy--; scheduleLOD();
}
function refreshNear(p){
  // trees placed before the 1 m terrain arrived are rebuilt on it
  if(typeof tBuilt==="undefined")return;
  for(const k of [...tBuilt.keys()]){const b=tBins.get(k), mx=G.x0+(b.gx+0.5)*G.cell, my=G.y1-(b.gy+0.5)*G.cell, r=TB*G.cell;
    if(mx>p.mx0-r&&mx<p.mx1+r&&my>p.my0-r&&my<p.my1+r)dropBin(k)}
  scheduleLOD();
}
function dropPatch(key){const p=patches.get(key);if(!p)return;patches.delete(key);
  if(p.mesh){terrain.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();p.tex.forEach(t=>t&&t.dispose())} rebuildMask()}
function updatePatches(){
  const d=camera.position.distanceTo(controls.target);
  if(d>PDIST||!window.MMMGeo){[...patches.keys()].forEach(dropPatch);return}
  const tg=controls.target, fmx=G.x0+(tg.x/sc+W/2+0.5)*G.cell, fmy=G.y1-(tg.z/sc+H/2+0.5)*G.cell;
  const rM=Math.max(500,d*U*1.3)/Math.cos(47.3*Math.PI/180);
  const ex0=G.x0+G.cell, ex1=G.x0+(W-1)*G.cell, ey0=G.y1-(H-1)*G.cell, ey1=G.y1-G.cell, list=[];
  for(let ty=Math.floor((ORIGIN-(fmy+rM))/TILEM);ty<=Math.floor((ORIGIN-(fmy-rM))/TILEM);ty++)
    for(let tx=Math.floor((fmx-rM+ORIGIN)/TILEM);tx<=Math.floor((fmx+rM+ORIGIN)/TILEM);tx++){
      const mx0=tx*TILEM-ORIGIN, my1=ORIGIN-ty*TILEM; if(mx0<ex0||mx0+TILEM>ex1||my1>ey1||my1-TILEM<ey0)continue;
      list.push({key:tx+"/"+ty,tx,ty,mx0,mx1:mx0+TILEM,my1,my0:my1-TILEM,dist:Math.hypot(mx0+TILEM/2-fmx,my1-TILEM/2-fmy)});
    }
  list.sort((a,b)=>a.dist-b.dist); const want=new Set(list.slice(0,PMAX).map(t=>t.key));
  [...patches.keys()].forEach(k=>{if(!want.has(k))dropPatch(k)});
  for(const tdef of list.slice(0,PMAX)){
    if(patches.has(tdef.key))continue; if(patchBusy>=2)break;
    const p=Object.assign(tdef,{}); patches.set(p.key,p); loadPatch(p);
  }
}

// ---------- Surrounding terrain to the horizon ----------
const CG=META.context;
const ctxGroup=new THREE.Group(); ctxGroup.scale.y=state.exag; scene.add(ctxGroup);
const ctxShared={orthoMap:{value:blank0()},ctxOrtho:{value:0},exag:{value:state.exag},fadeEdge:{value:0.35},
  hole:{value:new THREE.Vector4((-W/2-0.5+1)*sc,(-H/2-0.5+1)*sc,(W/2-0.5-1)*sc,(H/2-0.5-1)*sc)}};
const ctxMat=new THREE.ShaderMaterial({
  uniforms:Object.assign({},ctxShared,{mode:shared.mode,winter:shared.winter,lineN:shared.lineN,lineS:shared.lineS,steepLo:shared.steepLo,steepHi:shared.steepHi,ctxAmt:shared.ctxAmt,camPos:shared.camPos,haze:shared.haze,fogNear:shared.fogNear,fogFar:shared.fogFar}),
  vertexShader:`
    uniform float exag; varying vec2 vUv; varying vec3 vN; varying float vElev; varying vec3 vWorld;
    void main(){ vUv=uv; vElev=position.y*100.0; vN=normalize(vec3(normal.x,normal.y/exag,normal.z));
      vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
  fragmentShader:`
    uniform sampler2D orthoMap; uniform float ctxOrtho, mode, winter, lineN, lineS, steepLo, steepHi, ctxAmt, fogNear, fogFar, fadeEdge;
    uniform vec3 camPos, haze; uniform vec4 hole;
    varying vec2 vUv; varying vec3 vN; varying float vElev; varying vec3 vWorld;
    vec3 hyps(float e){
      vec3 c=mix(vec3(.84,.87,.80),vec3(.89,.90,.82),smoothstep(500.,1100.,e));
      c=mix(c,vec3(.93,.91,.85),smoothstep(1100.,1700.,e));
      c=mix(c,vec3(.89,.87,.84),smoothstep(1700.,2200.,e));
      return mix(c,vec3(.94,.94,.93),smoothstep(2200.,2700.,e));
    }
    void main(){
      if(vWorld.x>hole.x&&vWorld.x<hole.z&&vWorld.z>hole.y&&vWorld.z<hole.w)discard;
      vec3 n=normalize(vN); float sh=clamp(dot(n,normalize(vec3(-0.5,0.7,-0.5))),0.0,1.0);
      float slope=degrees(acos(clamp(n.y,0.0,1.0)));
      vec3 col=hyps(vElev)*(0.42+0.72*sh);
      col=mix(col,vec3(.55,.52,.49)*(0.42+0.72*sh),smoothstep(35.,50.,slope)*step(1200.,vElev));
      vec4 o=texture2D(orthoMap,vUv);
      if(mode<0.5&&ctxOrtho>0.5&&o.a>0.5){ vec3 p=o.rgb; float l=dot(p,vec3(.299,.587,.114)); p=clamp(mix(vec3(l),p,1.18),0.0,1.0); col=pow(p,vec3(.93))*mix(1.0,0.72+0.5*sh,0.45); }
      if(winter>0.5){
        float hz=length(n.xz); float so=hz>0.02?0.5+0.5*n.z/hz:0.5; so=mix(0.5,so,smoothstep(3.,12.,slope));
        float L=mix(lineN,lineS,so);
        float s=smoothstep(L-100.,L+300.,vElev)*(1.0-smoothstep(steepLo,steepHi,slope))*ctxAmt;
        col=mix(col,mix(vec3(.79,.855,.95),vec3(1.0),smoothstep(0.15,0.75,sh)),s);
      }
      col=mix(col,haze,smoothstep(fogNear,fogFar,length(vWorld-camPos))*(winter>0.5?0.6:0.72));
      float e=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));
      col=mix(col,haze,(1.0-smoothstep(0.0,0.12,e))*fadeEdge);   // edges dissolve into the haze
      gl_FragColor=vec4(col,1.0);
    }`
});
// far backdrop (~600 m, ±130 km) so a zoomed-out view never shows the edge of the map
const toWX=mx=>((mx-G.x0)/G.cell-0.5-W/2)*sc, toWZ=my=>((G.y1-my)/G.cell-0.5-H/2)*sc;
async function buildFar(){
  try{
    const z=8, O=20037508.342789244, tileM=2*O/2**z, cx=G.x0+W*G.cell/2, cy=G.y1-H*G.cell/2, r=130000/Math.cos(47.2*Math.PI/180);
    const tx0=Math.floor((cx-r+O)/tileM), tx1=Math.floor((cx+r+O)/tileM), ty0=Math.floor((O-(cy+r))/tileM), ty1=Math.floor((O-(cy-r))/tileM);
    const cv=document.createElement("canvas"); cv.width=(tx1-tx0+1)*256; cv.height=(ty1-ty0+1)*256;
    const c2=cv.getContext("2d",{willReadFrequently:true}); let ok=0, need=0;
    const jobs=[];
    for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){need++;
      jobs.push(fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`,{mode:"cors"}).then(r=>r.ok?r.blob():null).then(b=>b&&createImageBitmap(b)).then(bm=>{if(bm){c2.drawImage(bm,(tx-tx0)*256,(ty-ty0)*256);ok++}}).catch(()=>{}))}
    await Promise.all(jobs); if(ok<need)return;
    const px=c2.getImageData(0,0,cv.width,cv.height).data, cell=tileM/256, ox=tx0*tileM-O, oy=O-ty0*tileM;
    const st=small?3:2, nx=Math.floor(cv.width/st), ny=Math.floor(cv.height/st), pos=new Float32Array(nx*ny*3), uv=new Float32Array(nx*ny*2);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=i*st,y=j*st,p=(y*cv.width+x)*4,h=px[p]*256+px[p+1]+px[p+2]/256-32768,v=j*nx+i;
      pos[v*3]=toWX(ox+(x+0.5)*cell); pos[v*3+1]=(Math.max(0,h)-40)/U; pos[v*3+2]=toWZ(oy-(y+0.5)*cell);
      uv[v*2]=i/(nx-1); uv[v*2+1]=1-j/(ny-1)}
    const idx=new Uint32Array((nx-1)*(ny-1)*6); let n=0;
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b=a+1,c=a+nx,d=c+1;idx[n++]=a;idx[n++]=c;idx[n++]=b;idx[n++]=b;idx[n++]=c;idx[n++]=d}
    const geo=new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.BufferAttribute(pos,3)); geo.setAttribute("uv",new THREE.BufferAttribute(uv,2));
    geo.setIndex(new THREE.BufferAttribute(idx,1)); geo.computeVertexNormals(); geo.computeBoundingSphere();
    const hole=CG?new THREE.Vector4(toWX(CG.x0)+0.5,toWZ(CG.y1)+0.5,toWX(CG.x0+CG.W*CG.cell)-0.5,toWZ(CG.y1-CG.H*CG.cell)-0.5):ctxShared.hole.value.clone();
    const u=Object.assign({},ctxMat.uniforms,{hole:{value:hole},ctxOrtho:{value:0},fadeEdge:{value:1}});
    const mesh=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms:u,vertexShader:ctxMat.vertexShader,fragmentShader:ctxMat.fragmentShader}));
    mesh.renderOrder=-1; ctxGroup.add(mesh); needsRender=true;
  }catch(e){console.warn("Fernsicht",e)}
}
setTimeout(buildFar,6000);
const ctxPromise=REG?Promise.resolve(REG.ctx):CG?loadB64Gz("data/context-dem.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);
ctxPromise.then(b=>{
  if(!b)return;
  const cw=CG.W, chh=CG.H, pr=new Int16Array(b.buffer,b.byteOffset,cw*chh), el=new Int16Array(cw*chh);
  for(let y=0;y<chh;y++)for(let x=0;x<cw;x++){const k=y*cw+x;
    el[k]=y===0?(x===0?pr[k]:el[k-1]+pr[k]):(x===0?el[k-cw]+pr[k]:pr[k]+el[k-1]+el[k-cw]-el[k-cw-1])}
  const st=small?3:2, xs=[], ys=[];
  for(let x=0;x<cw;x+=st)xs.push(x); for(let y=0;y<chh;y+=st)ys.push(y);
  const nx=xs.length, ny=ys.length, pos=new Float32Array(nx*ny*3), uv=new Float32Array(nx*ny*2);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const mxp=CG.x0+(xs[i]+0.5)*CG.cell, myp=CG.y1-(ys[j]+0.5)*CG.cell, v=j*nx+i;
    pos[v*3]=((mxp-G.x0)/G.cell-0.5-W/2)*sc; pos[v*3+1]=(el[ys[j]*cw+xs[i]]-6)/U; pos[v*3+2]=((G.y1-myp)/G.cell-0.5-H/2)*sc;
    uv[v*2]=(xs[i]+0.5)/cw; uv[v*2+1]=1-(ys[j]+0.5)/chh;
  }
  const idx=new Uint32Array((nx-1)*(ny-1)*6); let n=0;
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b2=a+1,c=a+nx,d=c+1;idx[n++]=a;idx[n++]=c;idx[n++]=b2;idx[n++]=b2;idx[n++]=c;idx[n++]=d}
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(pos,3)); geo.setAttribute("uv",new THREE.BufferAttribute(uv,2));
  geo.setIndex(new THREE.BufferAttribute(idx,1)); geo.computeVertexNormals(); geo.computeBoundingSphere();
  ctxGroup.add(new THREE.Mesh(geo,ctxMat)); needsRender=true;
  // photo for the surroundings, waits until the near area is loaded
  setTimeout(async()=>{
    const cv=await renderOrtho(CG.x0,CG.x0+CG.W*CG.cell,CG.y1-CG.H*CG.cell,CG.y1,12,null,true);
    if(!cv)return;
    const t=new THREE.CanvasTexture(cv); t.anisotropy=renderer.capabilities.getMaxAnisotropy();
    ctxShared.orthoMap.value=t; ctxShared.ctxOrtho.value=1; needsRender=true;
  },4000);
});

// ---------- Orthophoto tiles (basemap.at) ----------
const ORIGIN=20037508.342789244;
const tileUrl=(z,x,y)=>`https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`;
let active=0; const queue=[];
function fetchTile(url){
  return new Promise(res=>{
    const run=async()=>{active++;
      try{const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw 0; res(await createImageBitmap(await r.blob()))}
      catch(e){res(null)} finally{active--; if(queue.length)queue.shift()()}};
    if(active<8)run(); else queue.push(run);
  });
}
function orthoUrls(mx0,mx1,my0,my1,z){
  const tileM=2*ORIGIN/2**z, out=[];
  const tx0=Math.floor((mx0+ORIGIN)/tileM), tx1=Math.floor((mx1+ORIGIN)/tileM), ty0=Math.floor((ORIGIN-my1)/tileM), ty1=Math.floor((ORIGIN-my0)/tileM);
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)out.push(tileUrl(z,tx,ty));
  return out;
}
const MBT=(window.MMM_CONFIG||{}).mapboxToken||"";
const EOX_MAXZ=MBT?18:15, eoxUrl=(z,x,y)=>`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`;
// Mapbox Satellite via Static Tiles API: one 512 px tile at z-1 covers four 256 px tiles at z
const mbTiles=new Map();
function mbQuad(z,x,y){
  const k=`${z-1}/${x>>1}/${y>>1}`;
  if(!mbTiles.has(k)){mbTiles.set(k,fetchTile(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/${k}?access_token=${MBT}`));
    if(mbTiles.size>400)mbTiles.delete(mbTiles.keys().next().value)}
  return mbTiles.get(k).then(bm=>bm?{bm,sx:(x&1)*256,sy:(y&1)*256}:null);
}
async function renderOrtho(mx0,mx1,my0,my1,z,onProgress,transparent){
  const tileM=2*ORIGIN/2**z, res=tileM/256;
  const w=Math.ceil((mx1-mx0)/res), h=Math.ceil((my1-my0)/res);
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const ctx=cv.getContext("2d");
  const tx0=Math.floor((mx0+ORIGIN)/tileM), tx1=Math.floor((mx1+ORIGIN)/tileM);
  const ty0=Math.floor((ORIGIN-my1)/tileM), ty1=Math.floor((ORIGIN-my0)/tileM);
  const jobs=[]; let done=0, ok=0; const total=(tx1-tx0+1)*(ty1-ty0+1);
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){
    const dx=(tx*tileM-ORIGIN-mx0)/res, dy=(my1-(ORIGIN-ty*tileM))/res;
    jobs.push(fetchTile(tileUrl(z,tx,ty)).then(async bm=>{
      if(bm){ok++;ctx.drawImage(bm,dx,dy,256,256);bm.close&&bm.close()}
      else if(z<=EOX_MAXZ){ // outside Austria: Mapbox Satellite with token, else Sentinel-2 cloudless (10 m)
        const q=MBT&&z>=2?await mbQuad(z,tx,ty):null;
        if(q){ok++;ctx.drawImage(q.bm,q.sx,q.sy,256,256,dx,dy,256,256)}
        else if(z<=15){const e=await fetchTile(eoxUrl(z,tx,ty)); if(e){ok++;ctx.drawImage(e,dx,dy,256,256);e.close&&e.close()}}
      }
      done++; onProgress&&onProgress(done/total);
    }));
  }
  await Promise.all(jobs);
  return ok>0?cv:null;
}
// fine hillshades (50 cm laser scan) from Land Tirol WMS: terrain -> red, surface -> green
const WMS="https://gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WMSServer";
let wmsActive=0; const wmsQueue=[];
const wmsUrl=(layer,mx0,mx1,my0,my1,w,h)=>`${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=&crs=EPSG:3857&bbox=${mx0},${my0},${mx1},${my1}&width=${w}&height=${h}&format=image/jpeg`;
const SHADE_LAYERS=["Image_Schummerung_Gelaendemodell","Image_Schummerung_Oberflaechenmodell"];
const clampWH=(w,h)=>[Math.min(w,4096,MAXTEX),Math.min(h,4096,MAXTEX)];
function shadeUrls(mx0,mx1,my0,my1,w,h){[w,h]=clampWH(w,h);return SHADE_LAYERS.map(l=>wmsUrl(l,mx0,mx1,my0,my1,w,h))}
function wmsImage(layer,mx0,mx1,my0,my1,w,h){
  const url=wmsUrl(layer,mx0,mx1,my0,my1,w,h);
  return new Promise(res=>{
    const run=async()=>{wmsActive++;
      try{const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw 0; const b=await r.blob(); if(!/^image/.test(b.type))throw 0; res(await createImageBitmap(b))}
      catch(e){res(null)} finally{wmsActive--; if(wmsQueue.length)wmsQueue.shift()()}};
    if(wmsActive<4)run(); else wmsQueue.push(run);
  });
}
async function renderShade(mx0,mx1,my0,my1,w,h){
  [w,h]=clampWH(w,h);
  const [a,b]=await Promise.all(SHADE_LAYERS.map(l=>wmsImage(l,mx0,mx1,my0,my1,w,h)));
  if(!a||!b)return null;
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const ctx=cv.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(a,0,0,w,h); const A=ctx.getImageData(0,0,w,h);
  ctx.drawImage(b,0,0,w,h); const B=ctx.getImageData(0,0,w,h).data, D=A.data;
  for(let i=0;i<D.length;i+=4){const a=D[i],b=B[i];D[i+1]=b;D[i+2]=(a===b&&(a>=253||a<=2))?255:0;D[i+3]=255}
  ctx.putImageData(A,0,0); a.close&&a.close(); b.close&&b.close();
  return cv;
}
(async()=>{
  const w=Math.min(4096,MAXTEX), h=Math.round(w*H/W);
  const cv=await renderShade(G.x0,G.x0+W*G.cell,G.y1-H*G.cell,G.y1,w,h);
  if(!cv)return;
  const t=new THREE.CanvasTexture(cv); t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  shared.globalShade.value=t; shared.shadeReady.value=1; needsRender=true; scheduleLOD();
})();
// overview texture for the whole area (z15, ~3.2 m per pixel)
(async()=>{
  const gx0=G.x0, gx1=G.x0+W*G.cell, gy1=G.y1, gy0=G.y1-H*G.cell;
  let z=15; while(z>12&&((gx1-gx0)/(2*ORIGIN/2**z/256)>MAXTEX))z--;
  const cv=await renderOrtho(gx0,gx1,gy0,gy1,z,p=>{statusEl.textContent=`Luftbild lädt … ${Math.round(p*100)} %`});
  if(!cv){statusEl.textContent="Luftbild nicht erreichbar, Relief wird angezeigt";return}
  const t=new THREE.CanvasTexture(cv); t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  shared.globalMap.value=t; shared.orthoReady.value=1; needsRender=true;
  statusEl.textContent="Luftbild: basemap.at";
  scheduleLOD();
})();

// detail textures per chunk depending on camera distance
const BUDGET=small?16e6:64e6; // texture pixels for detail chunks (photo + hillshade)
const box=new THREE.Box3();
function chunkDist(c){box.copy(c.mesh.geometry.boundingBox);box.min.y*=state.exag;box.max.y*=state.exag;return box.distanceToPoint(camera.position)}
let lodTimer=null;
function scheduleLOD(){clearTimeout(lodTimer);lodTimer=setTimeout(updateLOD,350)}
function chunkPixels(c,z){const res=2*ORIGIN/2**z/256;return 2*Math.ceil((c.mx1-c.mx0)/res)*Math.ceil((c.my1-c.my0)/res)}
function updateLOD(){
  const list=chunks.map(c=>({c,d:chunkDist(c)})).sort((a,b)=>a.d-b.d);
  if(!shared.orthoReady.value&&!shared.shadeReady.value){updateTrees(list);updatePatches();return}
  let used=0;
  for(const {c,d} of list){
    let z=d<14?17:d<45?16:0;
    while(z&&(used+chunkPixels(c,z)>BUDGET||Math.max(Math.ceil((c.mx1-c.mx0)/(2*ORIGIN/2**z/256)),Math.ceil((c.my1-c.my0)/(2*ORIGIN/2**z/256)))>MAXTEX))z=z>16?16:0;
    if(z)used+=chunkPixels(c,z);
    c.want=z;
  }
  updateTrees(list); updatePatches();
  for(const c of chunks){
    if(c.want===c.z||c.loading===c.want)continue;
    if(c.want===0){drop(c);continue}
    loadChunk(c,c.want);
  }
}
function drop(c){
  const u=c.uniforms, a=u.localMap.value, b=u.localShade.value;
  u.useLocal.value=0; u.useLocalShade.value=0; u.localMap.value=blank; u.localShade.value=blank; c.z=0;
  if(a!==blank)a.dispose(); if(b!==blank)b.dispose(); needsRender=true;
}
async function loadChunk(c,z){
  c.loading=z;
  const res=2*ORIGIN/2**z/256, w=Math.ceil((c.mx1-c.mx0)/res), h=Math.ceil((c.my1-c.my0)/res);
  const [cv,sh]=await Promise.all([renderOrtho(c.mx0,c.mx1,c.my0,c.my1,z),renderShade(c.mx0,c.mx1,c.my0,c.my1,w,h)]);
  if((!cv&&!sh)||c.want!==z){if(c.loading===z)c.loading=0;return}
  const u=c.uniforms, a=u.localMap.value, b=u.localShade.value, an=renderer.capabilities.getMaxAnisotropy();
  if(cv){const t=new THREE.CanvasTexture(cv);t.anisotropy=an;u.localMap.value=t;u.useLocal.value=1}else{u.localMap.value=blank;u.useLocal.value=0}
  if(sh){const t=new THREE.CanvasTexture(sh);t.anisotropy=an;u.localShade.value=t;u.useLocalShade.value=1}else{u.localShade.value=blank;u.useLocalShade.value=0}
  c.z=z; c.loading=0;
  if(a!==blank)a.dispose(); if(b!==blank)b.dispose(); needsRender=true;
}

// ---------- Marker (bottle with elevation) ----------
const pinEl=$("pin"), pinLabel=$("pinLabel");
let lastMarker=null;
function placeMarker(gx,gy){
  lastMarker=[gx,gy]; pinLabel.textContent=fmt(Math.round(heightGrid(gx,gy)))+" m"; pinEl.hidden=false; needsRender=true;
}
const gridToWorld=(gx,gy,lift=0)=>new THREE.Vector3((gx-W/2)*sc,heightGrid(gx,gy)/U*state.exag+lift,(gy-H/2)*sc);

// ---------- Views ----------
function lookAt(gx,gy,dist,mode){
  const t=gridToWorld(gx,gy); controls.target.copy(t);
  if(mode==="2d")camera.position.set(t.x,t.y+dist,t.z+0.001);
  else camera.position.set(t.x+dist*0.12,t.y+dist*0.55,t.z+dist*0.83);
  controls.update(); needsRender=true; scheduleLOD();
}
let route=null;
function routeFrame(){
  if(!route)return null;
  const ins=route.pts.filter(q=>q.inside); if(!ins.length)return null;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; ins.forEach(q=>{x0=Math.min(x0,q.gx);x1=Math.max(x1,q.gx);y0=Math.min(y0,q.gy);y1=Math.max(y1,q.gy)});
  return {gx:(x0+x1)/2,gy:(y0+y1)/2,dist:Math.max(6,Math.max(x1-x0,y1-y0)*sc*1.7)};
}
function fitRoute(mode){const f=routeFrame(); if(f)lookAt(f.gx,f.gy,f.dist,mode); else lookAt(W/2,H/2,90,mode)}
const targetGrid=()=>[controls.target.x/sc+W/2,controls.target.z/sc+H/2];
$("view3d").onclick=()=>{const [x,y]=targetGrid();lookAt(x,y,Math.max(4,camera.position.distanceTo(controls.target)),"3d")};
$("view2d").onclick=()=>{const [x,y]=targetGrid();lookAt(x,y,Math.max(4,camera.position.distanceTo(controls.target)),"2d")};
$("fit").onclick=()=>fitRoute("3d");
$("exag").oninput=e=>{
  state.exag=+e.target.value; $("exagOut").textContent=fmt(state.exag,1)+"×"; shared.exag.value=state.exag; scheduleOverlay();
  terrain.scale.y=state.exag; treeGroup.scale.y=state.exag; ctxGroup.scale.y=state.exag; ctxShared.exag.value=state.exag; buildRouteLine();
  if(lastMarker)placeMarker(lastMarker[0],lastMarker[1]);
  needsRender=true;
};

// ---------- OpenStreetMap: names, pistes, lifts and paths with SAC grade ----------
const OVERPASS=["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const SAC={hiking:1,mountain_hiking:2,demanding_mountain_hiking:3,alpine_hiking:4,demanding_alpine_hiking:5,difficult_alpine_hiking:6};
const SAC_COL=["#888","#d9a400","#d7301f","#9b1c12","#2f6fd8","#1f3f9a","#111111"];
const PISTE_COL={novice:"#2a7de1",easy:"#2a7de1",intermediate:"#d7301f",advanced:"#111111",expert:"#111111",freeride:"#f08c00",extreme:"#f08c00"};
const PISTE_NAME={novice:"blaue Piste",easy:"blaue Piste",intermediate:"rote Piste",advanced:"schwarze Piste",expert:"schwarze Piste",freeride:"Skiroute",extreme:"Skiroute"};
const LIFT_NAME={cable_car:"Seilbahn",gondola:"Gondelbahn",chair_lift:"Sessellift",drag_lift:"Schlepplift","t-bar":"Schlepplift","j-bar":"Schlepplift",platter:"Tellerlift",rope_tow:"Seillift",magic_carpet:"Förderband",mixed_lift:"Kombibahn",funicular:"Standseilbahn"};
var osmWays=[];
async function overpass(q,key,oldKeys){
  let cache=null;
  try{cache=await caches.open("mmm-osm"); const hit=await cache.match(key); if(hit)return await hit.json()}catch(e){}
  for(let round=0;round<3;round++){
    for(const host of OVERPASS){
      try{const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),45000);
        const r=await fetch(host+"?data="+encodeURIComponent(q),{signal:ctl.signal}); const tx=await r.text(); clearTimeout(to);
        if(r.ok&&tx.trim().startsWith("{")){if(cache)try{await cache.put(key,new Response(tx,{headers:{"Content-Type":"application/json"}}))}catch(e){} return JSON.parse(tx)}
      }catch(e){}
    }
    await new Promise(r=>setTimeout(r,2000*(round+1)));
  }
  // servers busy: fall back to an older saved answer if there is one
  if(cache)for(const k of oldKeys||[]){try{const hit=await cache.match(k); if(hit)return await hit.json()}catch(e){}}
  return null;
}
async function loadOsm(){
  const [w,s]=MMMGeo.mercToLonLat(G.x0,G.y1-H*G.cell), [e,n]=MMMGeo.mercToLonLat(G.x0+W*G.cell,G.y1);
  const bb=`${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const q1=`[out:json][timeout:90];(node["natural"~"^(peak|saddle)$"]["name"](${bb});node["tourism"~"^(alpine_hut|wilderness_hut)$"]["name"](${bb});node["aerialway"="station"]["name"](${bb});way["piste:type"~"^(downhill|skitour)$"](${bb});way["aerialway"~"^(cable_car|gondola|chair_lift|drag_lift|t-bar|j-bar|platter|rope_tow|magic_carpet|mixed_lift)$"](${bb});way["railway"="funicular"](${bb});way["highway"~"^(path|footway|bridleway|steps)$"]["sac_scale"](${bb}););out geom;`;
  const q2=`[out:json][timeout:90];way["highway"="track"](${bb});out geom;`;
  const base="https://mmm.local/osm/"+bb;
  const [j1,j2]=await Promise.all([overpass(q1,base+"/main4",[base+"/v3",base+"/v2"]),overpass(q2,base+"/tracks4",[])]);
  if(!j1&&!j2){console.warn("OpenStreetMap nicht erreichbar");statusEl.textContent="Wege und Pisten gerade nicht erreichbar, neuer Versuch in 30 s";setTimeout(loadOsm,30000);return}
  if(!j2)setTimeout(loadOsm,60000);
  const seen=new Set(), json={elements:[]};
  [j1,j2].forEach(j=>j&&j.elements.forEach(el=>{const k=el.type+el.id; if(!seen.has(k)){seen.add(k);json.elements.push(el)}}));
  statusEl.textContent=shared.orthoReady.value?"Luftbild: basemap.at":statusEl.textContent;
  const labels=[], ways=[];
  const inside=(gx,gy)=>gx>=0&&gy>=0&&gx<=W-1&&gy<=H-1;
  for(const el of json.elements){
    const tg=el.tags||{};
    if(el.type==="node"){
      const t=tg.natural==="peak"?"peak":tg.natural==="saddle"?"saddle":tg.aerialway==="station"?"lift":"hut";
      const h=parseInt(tg.ele,10);
      if(REG||t==="hut")labels.push({t,name:tg.name,lat:el.lat,lon:el.lon,h:isFinite(h)?h:undefined});
      continue;
    }
    if(!el.geometry||el.geometry.length<2)continue;
    const pts=el.geometry.map(g=>[lonToX(g.lon),latToY(g.lat)]);
    if(!pts.some(p=>inside(p[0],p[1])))continue;
    let kind,color,dashed=false,label,grade=0,air=false,track=false;
    if(tg.highway==="track"){kind="path";track=true;color="#b88a4a";label=(tg.name?tg.name+" · ":"")+"Forstweg"+(tg.tracktype?" ("+tg.tracktype.replace("grade","Klasse ")+")":"");grade=SAC[tg.sac_scale]||0}
    else if(tg.sac_scale){grade=SAC[tg.sac_scale]||2;kind="path";color=SAC_COL[grade];dashed=true;label=(tg.name?tg.name+" · ":"")+SAC_NAME[grade]}
    else if(tg["piste:type"]==="downhill"){if(tg.area==="yes")continue;kind="piste";const d=tg["piste:difficulty"]||"intermediate";color=PISTE_COL[d]||"#d7301f";label=(tg["piste:name"]||tg.name?(tg["piste:name"]||tg.name)+" · ":"")+(PISTE_NAME[d]||"Piste")}
    else if(tg["piste:type"]==="skitour"){kind="piste";color="#7b2d8e";dashed=true;label=(tg.name?tg.name+" · ":"")+"Skitourenroute"}
    else if(tg.aerialway||tg.railway==="funicular"){kind="lift";color="#1b2420";air=!!tg.aerialway;label=(tg.name?tg.name+" · ":"")+(LIFT_NAME[tg.aerialway||"funicular"]||"Lift")}
    else continue;
    let bx0=1e9,bx1=-1e9,by0=1e9,by1=-1e9; pts.forEach(p=>{bx0=Math.min(bx0,p[0]);bx1=Math.max(bx1,p[0]);by0=Math.min(by0,p[1]);by1=Math.max(by1,p[1])});
    ways.push({kind,color,dashed,label,grade,air,track,pts,bx0,bx1,by0,by1});
    if(kind==="path"&&!track&&grade){
      let len=0; for(let i=1;i<pts.length;i++)len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
      if(len*CELL>250){let acc=0,half=len/2;
        for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
          if(acc+d>=half){const f=(half-acc)/d,gx=pts[i-1][0]+(pts[i][0]-pts[i-1][0])*f,gy=pts[i-1][1]+(pts[i][1]-pts[i-1][1])*f;
            if(inside(gx,gy))labels.push({t:"grade",name:"T"+grade,gx,gy,prio:-3000+grade,color:SAC_COL[grade]});break}
          acc+=d}}
    }
  }
  osmWays=ways; addLabels(labels); buildOverlay();
}
let overlayMeshes=[], overlayTimer=null;
function scheduleOverlay(){clearTimeout(overlayTimer);overlayTimer=setTimeout(buildOverlay,500)}
// highest corner of the rendered triangle under a point, so draped lines never sink into the coarser mesh
function meshTop(gx,gy){
  const pd=patchCorners(gx,gy); if(pd!==null)return pd;
  const ci=Math.min(CX-1,Math.max(0,Math.floor(gx/CW))), cj=Math.min(CY-1,Math.max(0,Math.floor(gy/CH)));
  const ax=ci*CW, ay=cj*CH, bx=Math.min(W-1,(ci+1)*CW), by=Math.min(H-1,(cj+1)*CH);
  const x0=Math.min(bx,ax+Math.floor((gx-ax)/STEP)*STEP), y0=Math.min(by,ay+Math.floor((gy-ay)/STEP)*STEP), x1=Math.min(bx,x0+STEP), y1=Math.min(by,y0+STEP);
  const e=(x,y)=>E(Math.max(0,Math.min(H-1,y))*W+Math.max(0,Math.min(W-1,x)));
  return Math.max(e(x0,y0),e(x1,y0),e(x0,y1),e(x1,y1));
}
function patchCorners(gx,gy){
  if(!patches||!patches.size)return null;
  const mx=G.x0+(gx+0.5)*G.cell, my=G.y1-(gy+0.5)*G.cell;
  const p=patches.get(Math.floor((mx+ORIGIN)/TILEM)+"/"+Math.floor((ORIGIN-my)/TILEM));
  if(!p||!p.dem||!p.mesh)return null;
  const fx=(mx-p.mx0)/(p.mx1-p.mx0)*(PN-1), fy=(p.my1-my)/(p.my1-p.my0)*(PN-1);
  const x0=Math.max(0,Math.min(PN-1,Math.floor(fx/PSTEP)*PSTEP)), y0=Math.max(0,Math.min(PN-1,Math.floor(fy/PSTEP)*PSTEP)), x1=Math.min(PN-1,x0+PSTEP), y1=Math.min(PN-1,y0+PSTEP), D=p.dem;
  return Math.max(D[y0*PN+x0],D[y0*PN+x1],D[y1*PN+x0],D[y1*PN+x1]);
}
function buildOverlay(){
  overlayMeshes.forEach(m=>{scene.remove(m);m.geometry.dispose();m.material.dispose()}); overlayMeshes=[];
  if(!osmWays.length){needsRender=true;return}
  const groups={shadow:{p:[],c:[]},track:{p:[],c:[]},casing:{p:[],c:[]},solid:{p:[],c:[]},dashed:{p:[],c:[]}}, col=new THREE.Color(), white=new THREE.Color("#ffffff");
  const step=Math.max(0.5,6/CELL), lift=0.025;
  const inside=(gx,gy)=>gx>=0&&gy>=0&&gx<=W-1&&gy<=H-1;
  const P=(gx,gy,up)=>[(gx-W/2)*sc,meshTop(gx,gy)/U*state.exag+up,(gy-H/2)*sc];
  for(const w of osmWays){
    if(w.kind==="path"&&!state.paths)continue; if(w.kind!=="path"&&!state.pistes)continue;
    col.set(w.color); const g=w.track?groups.track:w.dashed?groups.dashed:groups.solid, cas=!w.dashed&&!w.track, shadow=w.track;
    for(let i=0;i<w.pts.length-1;i++){
      const [ax,ay]=w.pts[i],[bx,by]=w.pts[i+1]; if(!inside(ax,ay)||!inside(bx,by))continue;
      const n=w.air?1:Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/step)), up=w.air?0.07:lift;
      let prev=P(ax,ay,up);
      for(let s=1;s<=n;s++){const f=s/n, cur=P(ax+(bx-ax)*f,ay+(by-ay)*f,up);
        g.p.push(...prev,...cur); g.c.push(col.r,col.g,col.b,col.r,col.g,col.b);
        // outlines sit a hair lower so the coloured line always wins the depth test
        const lo=[prev[0],prev[1]-0.012,prev[2],cur[0],cur[1]-0.012,cur[2]];
        if(cas){groups.casing.p.push(...lo);groups.casing.c.push(1,1,1,1,1,1)}
        if(shadow){groups.shadow.p.push(...lo);groups.shadow.c.push(1,1,1,1,1,1)}
        prev=cur}
    }
  }
  const res=new THREE.Vector2(mapEl.clientWidth,mapEl.clientHeight);
  [["track",4,false,2,1],["solid",3,false,4,1],["dashed",3,true,5,1]].forEach(([k,lw,dashed,order,op])=>{
    const g=groups[k]; if(!g.p.length)return;
    const geo=new THREE.LineSegmentsGeometry(); geo.setPositions(g.p); geo.setColors(g.c);
    const mat=new THREE.LineMaterial({vertexColors:true,linewidth:lw,resolution:res,dashed,dashSize:0.06,gapSize:0.04,dashScale:1,depthTest:true,transparent:op<1,opacity:op});

    if(dashed)mat.defines.USE_DASH="";
    const m=new THREE.LineSegments2(geo,mat); if(dashed)m.computeLineDistances(); m.renderOrder=order; scene.add(m); overlayMeshes.push(m);
  });
  needsRender=true;
}

// ---------- Labels (OpenStreetMap names), decluttered on screen ----------
const labelsEl=$("labels");
const RANK={place:4000,peak:0,hut:-200,lift:-400,saddle:-800};
const labelNodes=[], labelNames=new Set();
function addLabels(list){
  for(const L of list){
    const key=L.t+"|"+L.name; if(labelNames.has(key))continue; labelNames.add(key);
    const el=document.createElement("div"); el.className="lbl "+L.t;
    const h=L.h?`<span class="h">${fmt(L.h)} m</span>`:"";
    el.innerHTML=L.t==="grade"?`<span>${L.name}</span>`:`<span>${L.name}</span>${L.t==="place"?"":h}`;
    if(L.color)el.style.setProperty("--gc",L.color);
    labelsEl.appendChild(el);
    labelNodes.push({el,gx:L.gx!==undefined?L.gx:lonToX(L.lon),gy:L.gy!==undefined?L.gy:latToY(L.lat),prio:L.prio!==undefined?L.prio:(L.h||1500)+(RANK[L.t]||0),w:L.name.length*6.6+14,kind:L.t});
  }
  labelNodes.sort((a,b)=>b.prio-a.prio); needsRender=true;
}
addLabels(META.labels);
const v3=new THREE.Vector3();
function project(gx,gy,el,lift){
  const w=mapEl.clientWidth,h=mapEl.clientHeight;
  v3.copy(gridToWorld(gx,gy,lift)).project(camera);
  const vis=v3.z<1&&v3.x>-1.1&&v3.x<1.1&&v3.y>-1.1&&v3.y<1.1;
  el.style.display=vis?"":"none";
  const off=el.classList.contains("grade")?"translate(-50%,-50%)":el.classList.contains("rdot")?"translate(-50%,-50%)":"translate(-50%,-100%)";
  if(vis)el.style.transform=`translate(${(v3.x+1)/2*w}px,${(1-v3.y)/2*h}px) ${off}`;
  return vis?[(v3.x+1)/2*w,(1-v3.y)/2*h]:null;
}
function occluded(wp){
  const o=camera.position, n=48;
  for(let i=2;i<n-1;i++){const f=i/n, x=o.x+(wp.x-o.x)*f, y=o.y+(wp.y-o.y)*f, z=o.z+(wp.z-o.z)*f, g=groundY(x,z);
    if(g!==null&&g>y+0.03)return true}
  return false;
}
function placeLabels(){
  const boxes=[], far=camera.position.distanceTo(controls.target)*3+40;
  for(const o of labelNodes){
    const on=o.kind==="grade"?state.paths:state.labels;
    o.el.hidden=!on; if(!on)continue;
    const wp=gridToWorld(o.gx,o.gy,0.05);
    if(wp.distanceTo(camera.position)>far){o.el.style.display="none";continue}
    if(occluded(wp)){o.el.style.display="none";continue}
    const p=project(o.gx,o.gy,o.el,0.05); if(!p)continue;
    const b=[p[0]-o.w/2,p[1]-34,p[0]+o.w/2,p[1]];
    if(boxes.some(q=>b[0]<q[2]&&b[2]>q[0]&&b[1]<q[3]&&b[3]>q[1])){o.el.style.display="none";continue}
    boxes.push(b);
  }
}
function updateLabels(){
  if(lastMarker&&!pinEl.hidden)project(lastMarker[0],lastMarker[1],pinEl,0);
  placeLabels();
  const show=state.route&&route&&route.ends;
  $("rStart").hidden=!show; $("rEnd").hidden=!show;
  if(show){project(route.ends[0].gx,route.ends[0].gy,$("rStart"),0.05);project(route.ends[1].gx,route.ends[1].gy,$("rEnd"),0.05)}
}

// ---------- Globe: drag to turn and tilt, tap to face north ----------
const globe=$("globe"), gctx=globe.getContext("2d"), gv=new THREE.Vector3(), gq=new THREE.Quaternion();
function drawGlobe(){
  const dpr=Math.min(2,window.devicePixelRatio||1), S=globe.clientWidth||68, px=Math.round(S*dpr);
  if(globe.width!==px){globe.width=px;globe.height=px}
  const c=gctx, r=px/2-2*dpr, cx=px/2, cy=px/2;
  c.clearRect(0,0,px,px);
  const g=c.createRadialGradient(cx-r*.35,cy-r*.4,r*.08,cx,cy,r);
  g.addColorStop(0,"#f4f8fb"); g.addColorStop(.7,"#b9cfdf"); g.addColorStop(1,"#7f9db6");
  c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.fillStyle=g; c.fill();
  gq.copy(camera.quaternion).invert();
  const P=(lat,lon)=>{gv.set(Math.cos(lat)*Math.sin(lon),Math.sin(lat),-Math.cos(lat)*Math.cos(lon)).applyQuaternion(gq);return [cx+gv.x*r,cy-gv.y*r,gv.z]};
  const line=(pts)=>{for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(a[2]<0||b[2]<0)continue;c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke()}};
  c.lineWidth=1*dpr; c.strokeStyle="rgba(27,36,32,.38)";
  for(let lo=0;lo<12;lo++){const pts=[];for(let la=-90;la<=90;la+=10)pts.push(P(la*Math.PI/180,lo*Math.PI/6));line(pts)}
  for(let la=-60;la<=60;la+=30){const pts=[];for(let lo=0;lo<=360;lo+=10)pts.push(P(la*Math.PI/180,lo*Math.PI/180));line(pts)}
  c.strokeStyle="rgba(27,36,32,.75)"; c.lineWidth=1.6*dpr;
  {const pts=[];for(let lo=0;lo<=360;lo+=6)pts.push(P(0,lo*Math.PI/180));line(pts)}
  c.strokeStyle="#d7301f"; c.lineWidth=2*dpr;
  {const pts=[];for(let la=0;la<=90;la+=6)pts.push(P(la*Math.PI/180,0));line(pts)}
  const n=P(0,0); let nx=n[0]-cx, ny=n[1]-cy; const nl=Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
  const bx=cx+nx*(r-6*dpr), by=cy+ny*(r-6*dpr);
  c.fillStyle="#d7301f"; c.beginPath(); c.arc(bx,by,6*dpr,0,Math.PI*2); c.fill();
  c.fillStyle="#fff"; c.font=`700 ${8*dpr}px Barlow, sans-serif`; c.textAlign="center"; c.textBaseline="middle"; c.fillText("N",bx,by+0.5*dpr);
  c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.strokeStyle="rgba(27,36,32,.5)"; c.lineWidth=1*dpr; c.stroke();
}
const sph=new THREE.Spherical(), off=new THREE.Vector3();
function orbit(dTheta,dPhi,abs){
  off.copy(camera.position).sub(controls.target); sph.setFromVector3(off);
  if(abs)sph.theta=dTheta; else sph.theta+=dTheta;
  sph.phi=Math.max(0.02,Math.min(controls.maxPolarAngle,sph.phi+dPhi));
  off.setFromSpherical(sph); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target);
  controls.update(); needsRender=true; scheduleLOD();
}
let gd=null;
globe.addEventListener("pointerdown",e=>{gd={x:e.clientX,y:e.clientY,moved:false};globe.setPointerCapture(e.pointerId);e.preventDefault()});
globe.addEventListener("pointermove",e=>{if(!gd)return;const dx=e.clientX-gd.x,dy=e.clientY-gd.y;if(Math.abs(dx)+Math.abs(dy)>1)gd.moved=true;gd.x=e.clientX;gd.y=e.clientY;orbit(-dx*0.014,-dy*0.012)});
globe.addEventListener("pointerup",()=>{if(gd&&!gd.moved)togglePad();gd=null});
const padEl=$("pad");
function togglePad(force){const open=force!==undefined?force:padEl.hidden;padEl.hidden=!open;globe.setAttribute("aria-expanded",open)}
let holdTimer=null;
const DIRS={left:[0.03,0],right:[-0.03,0],up:[0,-0.018],down:[0,0.018]};
padEl.querySelectorAll("[data-dir]").forEach(btn=>{
  const d=DIRS[btn.dataset.dir];
  const stop=()=>{clearInterval(holdTimer);holdTimer=null};
  btn.addEventListener("pointerdown",e=>{e.preventDefault();stop();orbit(d[0],d[1]);holdTimer=setInterval(()=>orbit(d[0],d[1]),30)});
  ["pointerup","pointerleave","pointercancel"].forEach(ev=>btn.addEventListener(ev,stop));
  btn.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){orbit(d[0]*4,d[1]*4);e.preventDefault()}});
});
$("north").onclick=()=>orbit(0,0,true);
globe.addEventListener("pointercancel",()=>{gd=null});
globe.addEventListener("keydown",e=>{const m={ArrowLeft:[0.15,0],ArrowRight:[-0.15,0],ArrowUp:[0,-0.08],ArrowDown:[0,0.08]}[e.key];if(m){orbit(m[0],m[1]);e.preventDefault()}else if(e.key==="Enter"||e.key===" "){togglePad();e.preventDefault()}});

// ---------- Tap ----------
const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
let down=null;
renderer.domElement.addEventListener("pointerdown",e=>{down={x:e.clientX,y:e.clientY,t:performance.now()}});
renderer.domElement.addEventListener("pointerup",e=>{
  if(!down)return; const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y), dt=performance.now()-down.t; down=null;
  if(moved>6||dt>450)return;
  const r=renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(ndc,camera);
  const hp=rayTerrain(ray.ray.origin,ray.ray.direction); if(!hp)return;
  const gx=hp.x/sc+W/2, gy=hp.z/sc+H/2;
  lastMarker=[gx,gy]; placeMarker(gx,gy); showPoint(gx,gy);
});
const SAC_NAME=["","T1 Wanderweg","T2 Bergweg","T3 anspruchsvoller Bergweg","T4 Alpinwanderung","T5 anspruchsvolle Alpinwanderung","T6 schwierige Alpinwanderung"];
function nearestWay(gx,gy){
  let best=null, bd=22/CELL; // ~22 m
  for(const w of osmWays){ if((w.kind==="path"&&!state.paths)||(w.kind!=="path"&&!state.pistes))continue;
    if(gx<w.bx0-bd||gx>w.bx1+bd||gy<w.by0-bd||gy>w.by1+bd)continue;
    const p=w.pts;
    for(let i=0;i<p.length-1;i++){const ax=p[i][0],ay=p[i][1],bx=p[i+1][0],by=p[i+1][1],dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;
      const tt=l?Math.max(0,Math.min(1,((gx-ax)*dx+(gy-ay)*dy)/l)):0, d=Math.hypot(gx-ax-dx*tt,gy-ay-dy*tt);
      if(d<bd){bd=d;best=w}}
  }
  return best;
}
function slopePill(s){const c=slopeClass(s);if(c<0)return `<span class="pill" style="background:var(--chip);color:var(--muted)">unter 30°</span>`;
  const names=["30–35°","35–40°","40–45°","über 45°"],bg=["var(--s30)","var(--s35)","var(--s40)","var(--s45)"];
  return `<span class="pill" style="background:${bg[c]};color:${c>=2?"#fff":"#1b2420"}">${names[c]}</span>`}
function showPoint(gx,gy){
  const k=idxAt(gx,gy), e=heightGrid(gx,gy), ps=patchSlope(gx,gy), s=ps!==null?ps:slopeAt(k);
  $("pointInfo").innerHTML=`<div class="point"><span class="big">${fmt(Math.round(e))} m</span><span class="big">${fmt(Math.round(s))}°</span>${slopePill(s)}</div>
  ${state.winter&&winterKey?`<div class="point"><span class="sub">Winter-Modell: ${snowText(data[k*4+2]/255)}</span></div>`:""}
  <div class="point"><span class="sub">Exposition ${ASPECTS[aspect[k]]}</span><span class="sub">${fmt(yToLat(gy),5)} N, ${fmt(xToLon(gx),5)} O</span></div>`;
  const sgv=snowgridAt(gx,gy);
  if(sgv!==null){const d=document.createElement("div");d.className="point";d.innerHTML=`<span class="sub">SNOWGRID: ${fmt(Math.round(sgv))} cm (Mittel der 1-km-Zelle)</span>`;$("pointInfo").appendChild(d)}
  const w=osmWays.length?nearestWay(gx,gy):null;
  if(w){const d=document.createElement("div");d.className="point";d.innerHTML=`<span class="sub" style="color:var(--ink)"><b>${escapeHtml(w.label)}</b></span>`;$("pointInfo").appendChild(d)}
}

// ---------- Routes ----------
let routeLines=[];
function buildRouteLine(){
  routeLines.forEach(l=>{scene.remove(l);l.geometry.dispose();l.material.dispose()}); routeLines=[];
  if(!route||!state.route){needsRender=true;return}
  const p=[]; route.samples.forEach(s=>{p.push((s.gx-W/2)*sc, s.e/U*state.exag+0.09, (s.gy-H/2)*sc)});
  const res=new THREE.Vector2(mapEl.clientWidth,mapEl.clientHeight);
  [[0xffffff,7],[0x1d4ed8,4]].forEach(([color,lw],i)=>{
    const g=new THREE.LineGeometry(); g.setPositions(p);
    const m=new THREE.LineMaterial({color,linewidth:lw,resolution:res,depthTest:true,depthWrite:i>0});
    const l=new THREE.Line2(g,m); l.computeLineDistances(); l.renderOrder=1+i; scene.add(l); routeLines.push(l);
  });
  needsRender=true;
}
function haversine(a,b){const R6=6371000,toR=Math.PI/180;const dLat=(b.lat-a.lat)*toR,dLon=(b.lon-a.lon)*toR;
  const s=Math.sin(dLat/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLon/2)**2;return 2*R6*Math.asin(Math.sqrt(s))}
function setRoute(lonlat,name,tag){
  const pts=lonlat.map(([lon,lat])=>{const gx=lonToX(lon),gy=latToY(lat);return {lon,lat,gx,gy,inside:gx>=1&&gy>=1&&gx<W-2&&gy<H-2}});
  const inside=pts.filter(p=>p.inside);
  if(inside.length<2){
    route=null; buildRouteLine();
    $("routeInfo").innerHTML=`<p class="warn">Diese Spur liegt außerhalb des Kartenausschnitts. Die Testregion reicht von Innsbruck bis zum Nordkettenkamm, etwa von der Frau Hitt bis östlich vom Hafelekar.</p>`;
    return;
  }
  const samples=[]; let dist=0;
  for(let i=0;i<inside.length;i++){
    if(i>0){const a=inside[i-1],b=inside[i],d=haversine(a,b),nSub=Math.max(1,Math.ceil(d/10));
      for(let s=1;s<=nSub;s++){const t=s/nSub;samples.push({d:dist+d*t,gx:a.gx+(b.gx-a.gx)*t,gy:a.gy+(b.gy-a.gy)*t})}
      dist+=d;
    } else samples.push({d:0,gx:inside[0].gx,gy:inside[0].gy});
  }
  samples.forEach(s=>{s.e=elevAt(s.gx,s.gy); s.s=slopeAt(idxAt(s.gx,s.gy))});
  let up=0,downH=0,prev=null;
  for(let i=0;i<samples.length;i++){
    let sum=0,c=0;for(let j=Math.max(0,i-3);j<=Math.min(samples.length-1,i+3);j++){sum+=samples[j].e;c++}
    const e=sum/c; if(prev!==null){const d=e-prev; if(d>0)up+=d; else downH-=d} prev=e;
  }
  let maxE=-1e9,maxS=0,steep=0;
  for(let i=0;i<samples.length;i++){const s=samples[i];maxE=Math.max(maxE,s.e);maxS=Math.max(maxS,s.s);
    if(i>0&&s.s>=30)steep+=s.d-samples[i-1].d}
  route={name,tag,pts,samples,ends:[samples[0],samples[samples.length-1]],stats:{dist,up,down:downH,maxE,maxS,steep},partial:inside.length<pts.length};
  buildRouteLine(); renderRouteInfo();
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderRouteInfo(){
  const r=route,st=r.stats;
  const pct=st.dist>0?st.steep/st.dist*100:0;const share=pct===0?"0 %":pct<1?"unter 1 %":fmt(Math.round(pct))+" %";
  $("routeInfo").innerHTML=`
   <div class="route-head"><div class="name">${escapeHtml(r.name)}<div class="tag">${escapeHtml(r.tag)}</div></div>
   <button class="btn" id="clearRoute">Entfernen</button></div>
   ${r.partial?'<p class="warn">Teile der Spur liegen außerhalb des Kartenausschnitts und werden nicht ausgewertet.</p>':""}
   <div class="stats">
     <div class="stat"><b>${fmt(st.dist/1000,1)} km</b><span>Distanz</span></div>
     <div class="stat"><b>${fmt(Math.round(st.up/10)*10)} Hm</b><span>Aufstieg</span></div>
     <div class="stat"><b>${fmt(Math.round(st.down/10)*10)} Hm</b><span>Abstieg</span></div>
     <div class="stat"><b>${fmt(Math.round(st.maxE))} m</b><span>Höchster Punkt</span></div>
     <div class="stat"><b>${fmt(Math.round(st.maxS))}°</b><span>Steilster Hang</span></div>
     <div class="stat"><b>${share}</b><span>Strecke ab 30°</span></div>
   </div>
   <div class="profile" id="profile"></div>
   <div class="readout" id="readout">Fahre über das Profil, um die Stelle auf der Karte zu sehen.</div>`;
  $("clearRoute").onclick=()=>{route=null;buildRouteLine();$("routeInfo").innerHTML='<p class="hint">Lade eine GPX-Datei, um Profil und Hangneigung entlang der Spur zu sehen.</p>'};
  drawProfile();
}
function niceStep(range,target){const raw=range/target,p=Math.pow(10,Math.floor(Math.log10(raw)));const m=raw/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p}
function drawProfile(){
  const box=$("profile"); if(!box||!route)return;
  const S=route.samples, Wd=Math.max(260,box.clientWidth||320), Hd=150, ml=42, mr=8, mt=8, mb=34, strip=7;
  const dMax=S[S.length-1].d||1; let eMin=1e9,eMax=-1e9; S.forEach(s=>{eMin=Math.min(eMin,s.e);eMax=Math.max(eMax,s.e)});
  const ys=niceStep(eMax-eMin||100,4); eMin=Math.floor(eMin/ys)*ys; eMax=Math.ceil(eMax/ys)*ys;
  const ph=Hd-mt-mb, pw=Wd-ml-mr;
  const X=d=>ml+d/dMax*pw, Y=e=>mt+ph-(e-eMin)/(eMax-eMin)*ph;
  let line="",area=`M${X(0)},${mt+ph}`;
  S.forEach((s,i)=>{const p=`${X(s.d).toFixed(1)},${Y(s.e).toFixed(1)}`;line+=(i?"L":"M")+p;area+="L"+p});
  area+=`L${X(dMax)},${mt+ph}Z`;
  let grid="";for(let e=eMin;e<=eMax+0.1;e+=ys){grid+=`<line x1="${ml}" x2="${Wd-mr}" y1="${Y(e)}" y2="${Y(e)}" stroke="var(--line)"/><text x="${ml-6}" y="${Y(e)+4}" text-anchor="end">${fmt(e)}</text>`}
  const xs=niceStep(dMax/1000,4);let xt="";for(let k=0;k<=dMax/1000+1e-6;k+=xs){xt+=`<text x="${X(k*1000)}" y="${Hd-4}" text-anchor="middle">${fmt(k,xs<1?1:0)} km</text>`}
  let rects="",run=null;const sy=mt+ph+4;const cols=["var(--s30)","var(--s35)","var(--s40)","var(--s45)"];
  const seg=(r,dEnd)=>`<rect x="${X(r.d).toFixed(1)}" y="${sy}" width="${Math.max(0.5,X(dEnd)-X(r.d)).toFixed(1)}" height="${strip}" fill="${r.c<0?"var(--chip)":cols[r.c]}"/>`;
  S.forEach(s=>{const c=slopeClass(s.s);if(!run||run.c!==c){if(run)rects+=seg(run,s.d);run={c,d:s.d}}});
  if(run)rects+=seg(run,dMax);
  box.innerHTML=`<svg viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="Höhenprofil der Spur">
    ${grid}<path d="${area}" fill="var(--accent)" fill-opacity=".14"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${rects}${xt}<line id="cur" x1="0" x2="0" y1="${mt}" y2="${sy+strip}" stroke="var(--ink)" stroke-width="1" visibility="hidden"/>
    <circle id="curDot" r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/></svg>`;
  const svg=box.querySelector("svg");
  const move=e=>{
    const r=svg.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width*Wd;
    const d=Math.min(dMax,Math.max(0,(x-ml)/pw*dMax));
    let lo=0,hi=S.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(S[m].d<d)lo=m;else hi=m}
    const s=(d-S[lo].d)<(S[hi].d-d)?S[lo]:S[hi];
    const cur=svg.querySelector("#cur"),dot=svg.querySelector("#curDot");
    cur.setAttribute("x1",X(s.d));cur.setAttribute("x2",X(s.d));cur.setAttribute("visibility","visible");
    dot.setAttribute("cx",X(s.d));dot.setAttribute("cy",Y(s.e));dot.setAttribute("visibility","visible");
    $("readout").textContent=`${fmt(s.d/1000,2)} km · ${fmt(Math.round(s.e))} m · Hang ${fmt(Math.round(s.s))}°`;
    lastMarker=[s.gx,s.gy]; placeMarker(s.gx,s.gy);
  };
  svg.addEventListener("pointermove",move); svg.addEventListener("pointerdown",move);
}
function parseGPX(text,fname){
  const doc=new DOMParser().parseFromString(text,"application/xml");
  if(doc.querySelector("parsererror"))throw new Error("Die Datei ist kein gültiges GPX (XML-Fehler).");
  let nodes=[...doc.getElementsByTagName("trkpt")]; if(!nodes.length)nodes=[...doc.getElementsByTagName("rtept")];
  if(nodes.length<2)throw new Error("In der Datei wurden keine Trackpunkte gefunden.");
  const ll=nodes.map(n=>[+n.getAttribute("lon"),+n.getAttribute("lat")]).filter(p=>isFinite(p[0])&&isFinite(p[1]));
  const nm=doc.querySelector("trk > name, rte > name, metadata > name");
  return {ll,name:(nm&&nm.textContent.trim())||fname.replace(/\.gpx$/i,"")};
}
async function loadFile(file){
  try{const {ll,name}=parseGPX(await file.text(),file.name);
    setRoute(ll,name,`${fmt(ll.length)} Punkte aus ${file.name}`); if(route){fitRoute("3d");setSheet(true)}
  }catch(err){$("routeInfo").innerHTML=`<p class="warn">${escapeHtml(err.message)} Prüfe, ob du eine .gpx-Datei gewählt hast.</p>`}
}
$("gpx").addEventListener("change",e=>{const f=e.target.files[0]; if(f)loadFile(f); e.target.value=""});
let dragDepth=0;
mapEl.addEventListener("dragenter",e=>{e.preventDefault();dragDepth++;$("drop").hidden=false});
mapEl.addEventListener("dragover",e=>e.preventDefault());
mapEl.addEventListener("dragleave",()=>{if(--dragDepth<=0){dragDepth=0;$("drop").hidden=true}});
mapEl.addEventListener("drop",e=>{e.preventDefault();dragDepth=0;$("drop").hidden=true;const f=e.dataTransfer.files[0];if(f)loadFile(f)});

// ---------- SNOWGRID: modelled snow depth from GeoSphere Austria (1 km, daily) ----------
const SG_API="https://dataset.api.hub.geosphere.at/v1/grid/historical/snowgrid_cl-v2-1d-1km";
let sgMeta=null, sgParam=null, sgDate=null, sgPts=null, sgUnit="m", sgLoading=false;
const sgStatus=m=>{$("sgStatus").textContent=m};
async function sgInit(){
  if(sgMeta)return true;
  try{
    const r=await fetch(SG_API+"/metadata"); if(!r.ok)throw new Error("HTTP "+r.status);
    sgMeta=await r.json();
    const ps=sgMeta.parameters||[];
    const p=ps.find(p=>/snow.?depth|schneeh|^hs$|^sd$|^snow_depth/i.test((p.name||"")+" "+(p.long_name||"")+" "+(p.desc||"")))||ps[0];
    sgParam=p.name; sgUnit=p.unit||"m";
    const end=(sgMeta.end_time||sgMeta.end||"").slice(0,10)||new Date(Date.now()-864e5).toISOString().slice(0,10);
    $("sgDate").max=end; $("sgDate").min=(sgMeta.start_time||"1961-01-01").slice(0,10); if(!$("sgDate").value)$("sgDate").value=end;
    return true;
  }catch(e){console.warn("SNOWGRID",e);sgStatus("SNOWGRID gerade nicht erreichbar ("+e.message+").");sgMeta=null;return false}
}
async function loadSnowgrid(){
  if(sgLoading)return; sgLoading=true; sgStatus("SNOWGRID wird geladen …");
  try{
    if(!await sgInit())return;
    const d=$("sgDate").value;
    const [w,s]=MMMGeo.mercToLonLat(G.x0,G.y1-H*G.cell), [e,n]=MMMGeo.mercToLonLat(G.x0+W*G.cell,G.y1), m=0.02;
    const bb=`${(s-m).toFixed(3)},${(w-m).toFixed(3)},${(n+m).toFixed(3)},${(e+m).toFixed(3)}`;
    const url=`${SG_API}?parameters=${encodeURIComponent(sgParam)}&start=${d}T00:00&end=${d}T00:00&bbox=${bb}&output_format=geojson`;
    let json=null, cache=null;
    try{cache=await caches.open("mmm-snowgrid"); const hit=await cache.match(url); if(hit)json=await hit.json()}catch(e){}
    if(!json){const r=await fetch(url); if(!r.ok)throw new Error("HTTP "+r.status); const tx=await r.text(); json=JSON.parse(tx);
      if(cache)try{await cache.put(url,new Response(tx,{headers:{"Content-Type":"application/json"}}))}catch(e){}}
    const f2m=v=>/^m$/i.test(sgUnit)?v*100:/mm/i.test(sgUnit)?v/10:v;  // to cm
    sgPts=[];
    for(const f of json.features||[]){
      const pr=(f.properties&&f.properties.parameters&&(f.properties.parameters[sgParam]||Object.values(f.properties.parameters)[0]))||null;
      const v=pr&&Array.isArray(pr.data)?pr.data[0]:null; if(v===null||v===undefined||!isFinite(v))continue;
      if(pr.unit)sgUnit=pr.unit;
      const [lo,la]=f.geometry.coordinates; sgPts.push({gx:lonToX(lo),gy:latToY(la),cm:Math.max(0,f2m(+v))});
    }
    if(!sgPts.length){sgStatus("Für diesen Bereich und Tag liefert SNOWGRID keine Werte.");return}
    // spread the 1 km points over the area (inverse distance weighting within ~1.6 km)
    const TW=Math.ceil(W/8), TH=Math.ceil(H/8), buf=new Uint8Array(TW*TH*4), R2=(1600/CELL)**2, bin=new Map(), bs=1600/CELL;
    sgPts.forEach(p=>{const k=Math.floor(p.gx/bs)+","+Math.floor(p.gy/bs);(bin.get(k)||bin.set(k,[]).get(k)).push(p)});
    for(let j=0;j<TH;j++)for(let i=0;i<TW;i++){
      const gx=(i+0.5)*8, gy=(j+0.5)*8, bx=Math.floor(gx/bs), by=Math.floor(gy/bs); let sw=0,sv=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=bin.get((bx+dx)+","+(by+dy)); if(!a)continue;
        for(const p of a){const d2=(p.gx-gx)**2+(p.gy-gy)**2; if(d2>R2)continue; const wt=1/(d2+1); sw+=wt; sv+=wt*p.cm}}
      const k=(j*TW+i)*4; if(sw>0){buf[k]=Math.min(255,Math.round(sv/sw/2));buf[k+3]=255}
    }
    const tex=new THREE.DataTexture(buf,TW,TH,THREE.RGBAFormat); tex.magFilter=tex.minFilter=THREE.LinearFilter; tex.generateMipmaps=false; tex.needsUpdate=true;
    const old=shared.sgMap.value; shared.sgMap.value=tex; if(old&&old.image&&old.image.width>1)old.dispose();
    const vals=sgPts.map(p=>p.cm).sort((a,b)=>a-b);
    sgStatus(`Stand ${new Date(d).toLocaleDateString("de-AT")}: ${fmt(vals[0])} bis ${fmt(vals[vals.length-1])} cm im Bereich, Mittel je 1 km² Rasterzelle.`);
    needsRender=true; if(lastMarker)showPoint(lastMarker[0],lastMarker[1]);
  }catch(e){console.warn("SNOWGRID",e);sgStatus("SNOWGRID konnte nicht geladen werden ("+e.message+").")}
  finally{sgLoading=false}
}
function snowgridAt(gx,gy){
  if(!sgPts||!state.snowgrid)return null; let best=null,bd=1e18;
  for(const p of sgPts){const d=(p.gx-gx)**2+(p.gy-gy)**2; if(d<bd){bd=d;best=p}}
  return best&&bd<(900/CELL)**2?best.cm:null;
}
$("sgDate").addEventListener("change",()=>{if(state.snowgrid)loadSnowgrid()});

// ---------- Controls ----------
function applyUniforms(){
  shared.mode.value=state.base==="ortho"?0:1;
  shared.showSlope.value=state.slope?1:0; shared.showContour.value=state.contour?1:0; shared.showAspect.value=state.aspect?1:0;
  $("legendAspect").hidden=!state.aspect;
  shared.showSG.value=state.snowgrid&&sgPts?1:0; $("sgSec").hidden=!state.snowgrid;
  shared.winter.value=state.winter&&winterKey?1:0;
  $("legend").hidden=!state.slope; $("winterSec").hidden=!state.winter;
  if(lastMarker)showPoint(lastMarker[0],lastMarker[1]);
  needsRender=true;
}
function setBase(b){state.base=b;$("bmOrtho").setAttribute("aria-pressed",b==="ortho");$("bmRelief").setAttribute("aria-pressed",b==="relief");applyUniforms();if(b==="ortho")scheduleLOD()}
$("bmOrtho").onclick=()=>setBase("ortho");
$("bmRelief").onclick=()=>setBase("relief");
[["lySlope","slope"],["lyAspect","aspect"],["lyTrees","trees"],["lyContour","contour"],["lyRoute","route"],["lyLabels","labels"],["lyWinter","winter"],["lyPistes","pistes"],["lyPaths","paths"],["lySnowgrid","snowgrid"]].forEach(([id,key])=>{
  $(id).onclick=async()=>{
    state[key]=!state[key];$(id).setAttribute("aria-pressed",state[key]);
    if(key==="winter"&&state.winter)await computeWinter();
    if(key==="route")buildRouteLine();
    if(key==="trees")updateLOD();
    if(key==="pistes"||key==="paths"){buildOverlay();$("legendPaths").hidden=!state.paths}
    if(key==="snowgrid"&&state.snowgrid&&!sgPts)await loadSnowgrid();
    applyUniforms();
  };
});
function setLineOut(){$("lineNOut").textContent=fmt(state.lineN)+" m";$("lineSOut").textContent=fmt(state.lineS)+" m"}
$("snowLvl").onchange=async e=>{state.snow=+e.target.value;const P=PRESETS[state.snow];state.lineN=P.n;state.lineS=P.s;$("lineN").value=P.n;$("lineS").value=P.s;setLineOut();await computeWinter();applyUniforms()};
let lineTimer=null;
["lineN","lineS"].forEach(id=>{$(id).oninput=e=>{state[id]=+e.target.value;setLineOut();clearTimeout(lineTimer);lineTimer=setTimeout(async()=>{await computeWinter(true);applyUniforms()},220)}});
setLineOut();
$("wind").onchange=async e=>{state.wind=e.target.value;await computeWinter();applyUniforms()};

// ---------- Offline storage and app install ----------
const OFFLINE_CACHE="mmm-offline-v1";
function offlineUrls(maxZ){
  const urls=new Set();
  ["./","index.html","js/app.js?v="+APPV,"js/geo.js?v="+APPV,"js/region.js?v="+APPV,"data/nordkette-meta.js?v="+APPV,"manifest.webmanifest","icon.svg","icon-192.png","icon-512.png"].forEach(u=>urls.add(new URL(u,location.href).href));
  if(REG){urls.add(location.href);REG.urls.forEach(u=>urls.add(u))}
  else ["data/nordkette-dem.txt?v="+APPV,"data/nordkette-veg.txt?v="+APPV,"data/nordkette-trees.txt?v="+APPV,"data/context-dem.txt?v="+APPV].forEach(u=>urls.add(new URL(u,location.href).href));
  [...document.querySelectorAll("script[src],link[rel=stylesheet]")].forEach(e=>urls.add(e.src||e.href));
  const ex0=G.x0, ex1=G.x0+W*G.cell, ey1=G.y1, ey0=G.y1-H*G.cell;
  orthoUrls(ex0,ex1,ey0,ey1,15).forEach(u=>urls.add(u));
  if(CG)orthoUrls(CG.x0,CG.x0+CG.W*CG.cell,CG.y1-CG.H*CG.cell,CG.y1,12).forEach(u=>urls.add(u));
  urls.delete(undefined);
  {const w=Math.min(4096,MAXTEX);shadeUrls(ex0,ex1,ey0,ey1,w,Math.round(w*H/W)).forEach(u=>urls.add(u))}
  for(let z=16;z<=maxZ;z++)for(const c of chunks){
    orthoUrls(c.mx0,c.mx1,c.my0,c.my1,z).forEach(u=>urls.add(u));
    const res=2*ORIGIN/2**z/256; shadeUrls(c.mx0,c.mx1,c.my0,c.my1,Math.ceil((c.mx1-c.mx0)/res),Math.ceil((c.my1-c.my0)/res)).forEach(u=>urls.add(u));
  }
  return [...urls];
}
async function saveOffline(maxZ){
  const st=$("offlineStatus");
  if(!("caches" in window)){st.textContent="Dieser Browser kann keine Karten offline speichern.";return}
  try{navigator.storage&&navigator.storage.persist&&await navigator.storage.persist()}catch(e){}
  const cache=await caches.open(OFFLINE_CACHE), urls=offlineUrls(maxZ);
  let done=0, fail=0, bytes=0, i=0;
  $("saveStd").disabled=$("saveMax").disabled=true;
  const worker=async()=>{while(i<urls.length){const u=urls[i++];
    try{if(!(await cache.match(u))){const r=await fetch(u,{mode:"cors"}); if(!r.ok)throw 0; const b=await r.clone().blob(); bytes+=b.size; await cache.put(u,r)}}catch(e){fail++}
    done++; if(done%10===0||done===urls.length)st.textContent=`Speichere … ${Math.round(done/urls.length*100)} % (${fmt(bytes/1e6)} MB neu)`}};
  await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  $("saveStd").disabled=$("saveMax").disabled=false;
  let est="";try{const e=await navigator.storage.estimate();est=` Belegt insgesamt: ${fmt(e.usage/1e6)} MB.`}catch(e){}
  st.textContent=fail?`Gespeichert, aber ${fail} von ${urls.length} Dateien fehlen. Bei Empfang nochmal tippen.${est}`:`Dieser Bereich ist offline verfügbar.${est}`;
}
$("saveStd").onclick=()=>saveOffline(16);
$("saveMax").onclick=()=>saveOffline(17);
$("clearOffline").onclick=async()=>{try{await caches.delete(OFFLINE_CACHE);await caches.delete("mmm-runtime-v1")}catch(e){} $("offlineStatus").textContent="Offline-Daten gelöscht."};
let installEvt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(!installEvt)return;installEvt.prompt();try{await installEvt.userChoice}catch(e){} installEvt=null;$("installBtn").hidden=true};
if("serviceWorker" in navigator){navigator.serviceWorker.register("sw.js").catch(e=>console.warn("SW",e))}

// ---------- Collapsible panel ----------
const sheetBody=$("sheetBody"), sheetToggle=$("sheetToggle");
function setSheet(open){
  sheetBody.hidden=!open; sheetToggle.setAttribute("aria-expanded",open);
  sheetToggle.setAttribute("aria-label",open?"Ebenen und Einstellungen zuklappen":"Ebenen und Einstellungen aufklappen");
  if(open&&route)drawProfile();
}
sheetToggle.onclick=e=>{e.stopPropagation();setSheet(sheetBody.hidden)};
$("sheetBar").addEventListener("click",e=>{if(e.target.closest("label,input,button"))return;setSheet(sheetBody.hidden)});

// ---------- Places: search and loading another area of Tirol ----------
function goTo(lon,lat,name){saveState();const [sl,sb]=snap(lon,lat);location.href="./?at="+sl+","+sb+"&t="+lon.toFixed(5)+","+lat.toFixed(5)+(name?"&n="+encodeURIComponent(name):"")}
// region centres sit on a ~2.3 km grid
const snap=(lon,lat)=>[+(Math.round(lon/0.03)*0.03).toFixed(2),+(Math.round(lat/0.02)*0.02).toFixed(2)];
const inArea=(lon,lat)=>(window.MMM_CONFIG||{}).mapboxToken?(lon>5.0&&lon<16.9&&lat>43.5&&lat<48.5):(lon>9.0&&lon<14.0&&lat>46.0&&lat<48.2);
const prefetched=new Map();
function prefetch(lon,lat,onBytes){const k=lon+","+lat; if(!prefetched.has(k))prefetched.set(k,window.MMM_prefetchRegion(lon,lat,onBytes).catch(e=>({ok:false,err:e.message}))); return prefetched.get(k)}
let searchTimer=null, searchSeq=0;
async function runSearch(q){
  const out=$("searchResults"), my=++searchSeq;
  if(q.trim().length<2){out.innerHTML="";return}
  out.innerHTML='<p class="hint">Suche …</p>';
  try{
    const vb=(window.MMM_CONFIG||{}).mapboxToken?"5.0,48.4,16.9,43.6":"10.05,47.80,12.98,46.62";
    const r=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=de&bounded=1&viewbox="+vb+"&q="+encodeURIComponent(q));
    const list=await r.json(); if(my!==searchSeq)return;
    if(!list.length){out.innerHTML='<p class="hint">Nichts gefunden in Tirol. Versuch es mit einem Gipfel, Ort oder einer Hütte.</p>';return}
    out.innerHTML="";
    list.forEach(p=>{const b=document.createElement("button");b.className="result";
      const nm=p.name||p.display_name.split(",")[0], rest=p.display_name.split(",").slice(1,3).join(",").trim();
      b.innerHTML=`<b>${escapeHtml(nm)}</b><span>${escapeHtml(rest)}</span>`;
      b.onclick=()=>goTo(+p.lon,+p.lat,nm); out.appendChild(b)});
  }catch(e){out.innerHTML='<p class="hint">Suche gerade nicht erreichbar. Prüfe die Verbindung.</p>'}
}
// Nominatim usage policy forbids search-as-you-type, so we only search on Enter
$("search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();runSearch(e.target.value)}});
$("search").addEventListener("search",e=>runSearch(e.target.value));
$("searchBtn").onclick=e=>{e.stopPropagation();setSheet(true);$("search").focus()};
$("goNordkette").hidden=!REG; $("goNordkette").onclick=()=>{location.href="./"};
// offer to load the area in the middle of the screen once it is far from the loaded area
// panning towards the edge loads the next area automatically: data is fetched in the background,
// then the page switches over and keeps the camera where it was
const hereBtn=$("loadHere");
let autoTimer=null, prefetching=null, preTimer=null;
function checkHere(){
  const [gx,gy]=targetGrid();
  const out=gx<W*0.15||gx>W*0.85||gy<H*0.15||gy>H*0.85;
  // start downloading quietly well before the edge
  if(gx<W*0.32||gx>W*0.68||gy<H*0.32||gy>H*0.68){const lon=xToLon(gx),lat=yToLat(gy); if(inArea(lon,lat)){const [sl,sb]=snap(lon,lat); clearTimeout(preTimer); preTimer=setTimeout(()=>prefetch(sl,sb),600)}}
  clearTimeout(autoTimer);
  if(!out){if(!prefetching)hereBtn.hidden=true;return}
  if(!prefetching){hereBtn.hidden=false;hereBtn.textContent="Neuer Bereich wird gleich geladen …"}
  autoTimer=setTimeout(autoLoad,900);
}
async function autoLoad(){
  const [gx,gy]=targetGrid(), tlon=+xToLon(gx).toFixed(5), tlat=+yToLat(gy).toFixed(5), [lon,lat]=snap(tlon,tlat);
  hereBtn.hidden=false;
  if(!inArea(tlon,tlat)){hereBtn.textContent="Außerhalb des Kartengebiets";return}
  hereBtn.textContent="Lade neuen Bereich …";
  const key=lon+","+lat; prefetching=key; const t0=performance.now();
  let res={ok:false,err:"unbekannter Fehler"};
  if(prefetched.has(key)){const r=await prefetched.get(key); if(!r||!r.ok)prefetched.delete(key)}
  try{res=await prefetch(lon,lat,n=>{if(prefetching===key)hereBtn.textContent=`Lade neuen Bereich … ${fmt(n/1e6,1)} MB`})}catch(e){res.err=e.message}
  if(prefetching!==key)return;
  prefetching=null;
  if(!res.ok){hereBtn.textContent="Laden fehlgeschlagen: "+res.err+". Antippen zum Wiederholen";console.warn("Bereich",res.err,performance.now()-t0);return}
  hereBtn.textContent="Wechsle in den neuen Bereich …";
  const [gx2,gy2]=targetGrid(); if(Math.hypot(gx2-gx,gy2-gy)*CELL>2000){checkHere();return}
  navigateKeepView(lon,lat,tlon,tlat);
}
function navigateKeepView(lon,lat,tlon,tlat){
  saveState();
  const s=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  location.href=`./?at=${lon},${lat}&t=${tlon},${tlat}&cam=${s.radius.toFixed(3)},${s.theta.toFixed(4)},${s.phi.toFixed(4)}`;
}
hereBtn.onclick=()=>{clearTimeout(autoTimer);autoLoad()};
// put buttons, selects and sliders in line with restored settings
function syncUI(){
  const chips={lySlope:"slope",lyAspect:"aspect",lyTrees:"trees",lyContour:"contour",lyLabels:"labels",lyWinter:"winter",lyPistes:"pistes",lyPaths:"paths"};
  for(const id in chips)$(id).setAttribute("aria-pressed",state[chips[id]]);
  $("bmOrtho").setAttribute("aria-pressed",state.base==="ortho"); $("bmRelief").setAttribute("aria-pressed",state.base==="relief");
  $("snowLvl").value=state.snow; $("wind").value=state.wind; $("lineN").value=state.lineN; $("lineS").value=state.lineS; setLineOut();
  $("exag").value=state.exag; $("exagOut").textContent=fmt(state.exag,1)+"×"; shared.exag.value=state.exag;
  $("legendPaths").hidden=!state.paths;
}

// ---------- Start ----------
await tick("Karte wird gezeichnet …");
$("routeInfo").innerHTML='<p class="hint">Lade eine GPX-Datei, um Profil und Hangneigung entlang der Spur zu sehen.</p>';
function resize(){
  const w=mapEl.clientWidth,h=mapEl.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  routeLines.forEach(l=>l.material.resolution.set(w,h)); overlayMeshes.forEach(m=>m.material.resolution.set(w,h)); needsRender=true; if(route)drawProfile();
}
new ResizeObserver(resize).observe(mapEl); resize();
syncUI();
if(REG){
  const tq=(new URLSearchParams(location.search).get("t")||"").split(",").map(Number);
  const [lo,la]=tq.length===2&&tq.every(isFinite)?tq:META.center, gx=lonToX(lo), gy=latToY(la);
  const cam=(new URLSearchParams(location.search).get("cam")||"").split(",").map(Number);
  if(cam.length===3&&cam.every(isFinite)){
    const tg=gridToWorld(gx,gy); controls.target.copy(tg);
    camera.position.copy(tg).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(cam[0],cam[2],cam[1])));
    camera.lookAt(tg); needsRender=true; scheduleLOD();
  } else { lookAt(gx,gy+180,30,"3d"); placeMarker(gx,gy) }
  if(META.name){$("subtitle").textContent=META.name+" · Laserscan-Gelände Tirol"}else $("subtitle").textContent="Tirol · Laserscan-Gelände";
}else{const L=META.labels.find(l=>l.name==="Hafelekarspitze")||META.labels[0]; lookAt(lonToX(L.lon),latToY(L.lat)+260,32,"3d")}
if(state.winter)await computeWinter();
applyUniforms();
loadEl.hidden=true;
setTimeout(loadOsm,1500);
controls.addEventListener("change",()=>{needsRender=true;scheduleLOD();checkHere()});
(function loop(){
  controls.update();
  if(needsRender){needsRender=false;shared.camPos.value.copy(camera.position);renderer.render(scene,camera);updateLabels();drawGlobe()}
  requestAnimationFrame(loop);
})();
})().catch(err=>{const l=document.getElementById("loading");if(l){l.hidden=false;l.textContent="Fehler beim Laden: "+err.message}console.error(err)});
