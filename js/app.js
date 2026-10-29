// Malte Mountain Map – 3D terrain with basemap.at orthophoto, slope, contours, winter model, GPX.
(async function(){
"use strict";
const META=window.MMM_META;
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
await tick("Gelände wird geladen …");
const resp=await fetch("data/nordkette-dem.txt?v="+APPV);
if(!resp.ok)throw new Error("Geländedaten nicht erreichbar ("+resp.status+")");
let buf;{const bin=atob((await resp.text()).trim());buf=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i)}
let raw=buf;
if(buf[0]===0x1f&&buf[1]===0x8b){
  raw=window.DecompressionStream?new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()):window.pako.ungzip(buf);
}
const pred=new Int16Array(raw.buffer,raw.byteOffset,N);
const dm=new Uint16Array(N); // decimetres
for(let y=0;y<H;y++){const o=y*W;
  for(let x=0;x<W;x++){const k=o+x;
    if(y===0)dm[k]=x===0?pred[k]:dm[k-1]+pred[k];
    else if(x===0)dm[k]=dm[k-W]+pred[k];
    else dm[k]=pred[k]+dm[k-1]+dm[k-W]-dm[k-W-1];
  }}
buf=raw=null;
const E=k=>dm[k]*0.1;
async function loadB64Gz(url){
  const r=await fetch(url); if(!r.ok)throw new Error("Daten nicht erreichbar ("+r.status+")");
  const bin=atob((await r.text()).trim()); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);
  if(b[0]===0x1f&&b[1]===0x8b)return window.DecompressionStream?new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()):window.pako.ungzip(b);
  return b;
}
const treesPromise=META.trees?loadB64Gz("data/nordkette-trees.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);
const vegPromise=META.veg?loadB64Gz("data/nordkette-veg.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);

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
  {n:1500,s:1900,bonus:-0.30,form:0.75,wind:18,sun:0.50,steepLo:34,steepHi:50,lo:0.35,hi:0.98,bury:0.85,crown:0.20,ctx:0.75},
  {n:1000,s:1400,bonus:-0.08,form:0.55,wind:22,sun:0.40,steepLo:40,steepHi:56,lo:0.28,hi:0.84,bury:0.60,crown:0.42,ctx:0.9},
  {n:650, s:950, bonus:0.28, form:0.40,wind:30,sun:0.30,steepLo:46,steepHi:62,lo:0.18,hi:0.62,bury:0.35,crown:0.65,ctx:1}];
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
  shared.lineN.value=state.lineN; shared.lineS.value=state.lineS; shared.steepLo.value=P.steepLo-10; shared.steepHi.value=P.steepHi-12; shared.ctxAmt.value=P.ctx; needsRender=true;
  if(!quiet)loadEl.hidden=true;
}
const snowText=v=>v<0.12?"kaum Schnee, Fels oder abgeblasen":v<0.45?"lückige Schneedecke":v<0.85?"geschlossene Schneedecke":"durchgehend Schnee, Mulde oder Triebschnee";

// ---------- State ----------
const state={base:"ortho",slope:false,aspect:false,trees:true,contour:false,route:true,labels:true,winter:true,wind:"NW",snow:2,lineN:650,lineS:950,exag:1};
let needsRender=true;

// ---------- three.js ----------
await tick("3D-Modell wird aufgebaut …");
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.setClearColor(0x000000,0);
mapEl.insertBefore(renderer.domElement,mapEl.firstChild);
const MAXTEX=renderer.capabilities.maxTextureSize;
const scene=new THREE.Scene();
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
  const C={target:new THREE.Vector3(),maxPolarAngle:1.4,minDistance:0.25,maxDistance:200,_l:[],
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
      else{mode="pan";const g=groundAt(p.x,p.y);grabH=g?g.y:C.target.y;grabPt=onPlane(p.x,p.y,grabH)}}
    else if(ptr.size>=2){mode="two";two=gest();lock=null;const g=groundAt(two.mx,two.my);two.h=g?g.y:C.target.y;two.sx=two.mx;two.sy=two.my;two.sd=two.d;two.sa=two.ang}
  }
  function move(){
    if(mode==="pan"){const p=[...ptr.values()][0],q=onPlane(p.x,p.y,grabH);
      if(q&&grabPt){const dv=grabPt.clone().sub(q);dv.y=0;translate(dv);const now=performance.now();vel.lerp(dv,0.5);lastMove=now;finish()}}
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
    if(glide){translate(vel);vel.multiplyScalar(0.9);if(vel.length()<0.0005)glide=false;ch=true}
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
  globalMap:{value:blank}, dataMap:{value:dataTex}, vegMap:{value:blank0()}, aspectMap:{value:aspectTex}, showAspect:{value:0}, globalShade:{value:blank0()}, orthoReady:{value:0}, shadeReady:{value:0}, bury:{value:0.35}, crownSnow:{value:0.65},
  mode:{value:0}, showSlope:{value:0}, showContour:{value:0}, winter:{value:0},
  camPos:{value:new THREE.Vector3()}, haze:{value:new THREE.Color(0xd3e0ea)},
  lineN:{value:650}, lineS:{value:950}, steepLo:{value:36}, steepHi:{value:50}, ctxAmt:{value:1},
  fogNear:{value:30}, fogFar:{value:260}
};
const VERT=`
attribute vec2 uvLocal;
varying vec2 vUv; varying vec2 vUv2; varying float vElev; varying vec3 vWorld;
void main(){
  vUv=uv; vUv2=uvLocal; vElev=position.y*100.0;
  vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const FRAG=`
uniform sampler2D globalMap, localMap, dataMap, vegMap, globalShade, localShade, aspectMap;
uniform float showAspect, treesOn, isPatch, useFineSlope;
uniform sampler2D maskMap, fineSlope;
uniform float useLocal, useLocalShade, orthoReady, shadeReady, mode, showSlope, showContour, winter, fogNear, fogFar, bury, crownSnow;
uniform vec3 camPos, haze;
varying vec2 vUv; varying vec2 vUv2; varying float vElev; varying vec3 vWorld;
vec3 hyps(float e){
  vec3 c=mix(vec3(.84,.87,.80),vec3(.89,.90,.82),smoothstep(500.,1100.,e));
  c=mix(c,vec3(.93,.91,.85),smoothstep(1100.,1700.,e));
  c=mix(c,vec3(.89,.87,.84),smoothstep(1700.,2200.,e));
  return mix(c,vec3(.94,.94,.93),smoothstep(2200.,2700.,e));
}
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
  if(useLocalShade>0.5){ vec4 f=texture2D(localShade,vUv2); sg=f.r; so=f.g; fine=true; }
  else if(shadeReady>0.5){ vec4 f=texture2D(globalShade,vUv); sg=f.r; so=f.g; fine=true; }
  float light=0.42+0.72*sg;
  bool ortho = mode<0.5 && (orthoReady>0.5 || useLocal>0.5);
  float rock=smoothstep(38.,58.,slope)*step(1000.,vElev);
  vec3 col; float olum=0.5;
  if(ortho){
    col = useLocal>0.5 ? texture2D(localMap,vUv2).rgb : texture2D(globalMap,vUv).rgb;
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
  if(winter>0.5){
    float tr=smoothstep(0.06,0.4,tree), sr=smoothstep(0.06,0.4,shrub);
    float obj = fine ? clamp(abs(so-sg)*3.2-0.07,0.0,1.0) : 0.5;   // something stands above the ground
    float crownT=obj*tr*(1.0-0.85*treesOn);
    if(ortho) crownT=max(crownT, smoothstep(0.30,0.13,olum)*tr);
    float crownS=obj*sr*bury;
    vec3 crownC=mix(vec3(.08,.14,.10)*(0.55+0.95*so), snowCol(so)*0.97, crownSnow*smoothstep(0.48,0.85,so));
    vec3 shrubC=mix(vec3(.17,.23,.15)*(0.6+0.8*so), snowCol(so), 0.35);
    vec3 w=snowCol(sg);
    w=mix(w, shrubC, clamp(crownS,0.0,1.0)*0.85);
    w=mix(w, crownC, clamp(crownT*1.15,0.0,1.0)*0.93);
    vec3 under=col;
    if(ortho){ vec3 rk=clamp((under-0.45)*1.35+0.36,0.0,1.0); under=mix(under,rk,rock); }
    else under=mix(under, vec3(.38,.36,.35)*light, rock);
    float vis=smoothstep(0.12,0.88,clamp(snow+(sg-shade)*0.8,0.0,1.0));
    col=mix(under,w,vis);
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
const STEP=small?4:2;
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
  const mesh=new THREE.InstancedMesh(treeGeo,treeMat,cnt); mesh.frustumCulled=false;
  for(let j=0;j<cnt;j++){const i=bin.idx[j];
    const gx=treeData.x[i]/16, gy=treeData.y[i]/16, h=treeData.h[i]/4;
    _p.set((gx-W/2)*sc, elevAt(gx,gy)/U, (gy-H/2)*sc);
    _q.setFromAxisAngle(_up,(i*2.399)%6.283);
    const wdt=Math.max(1.6,h*0.38)/U; _s.set(wdt,h/U,wdt);
    mesh.setMatrixAt(j,_m.compose(_p,_q,_s));
  }
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
  // GK West coordinates of the tile on a coarse lattice, interpolated for every sample
  const L=9, lat=[];
  for(let j=0;j<L;j++)for(let i=0;i<L;i++)lat.push(MMMGeo.mercToGK(mx0+(mx1-mx0)*i/(L-1),my1-(my1-my0)*j/(L-1)));
  let e0=1e12,e1=-1e12,n0=1e12,n1=-1e12; lat.forEach(([e,n])=>{e0=Math.min(e0,e);e1=Math.max(e1,e);n0=Math.min(n0,n);n1=Math.max(n1,n)});
  e0=Math.floor(e0-4);n0=Math.floor(n0-4);e1=Math.ceil(e1+4);n1=Math.ceil(n1+4);
  const url=`${WCS}?service=WCS&version=1.0.0&request=GetCoverage&coverage=Gelaendemodell_50cm_M28&CRS=EPSG:31254&BBOX=${e0},${n0},${e1},${n1}&RESX=1&RESY=1&FORMAT=GeoTIFF&INTERPOLATION=bilinear`;
  const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw new Error("WCS "+r.status);
  const tif=MMMGeo.readTiff(await r.arrayBuffer());
  const rx=(e1-e0)/tif.w, ry=(n1-n0)/tif.h, dem=new Float32Array(PN*PN);
  for(let j=0;j<PN;j++){const v=j/(PN-1)*(L-1), lj=Math.min(L-2,Math.floor(v)), fv=v-lj;
    for(let i=0;i<PN;i++){const u=i/(PN-1)*(L-1), li=Math.min(L-2,Math.floor(u)), fu=u-li;
      const a=lat[lj*L+li],b=lat[lj*L+li+1],c=lat[(lj+1)*L+li],d=lat[(lj+1)*L+li+1];
      const E=(a[0]*(1-fu)+b[0]*fu)*(1-fv)+(c[0]*(1-fu)+d[0]*fu)*fv, Nn=(a[1]*(1-fu)+b[1]*fu)*(1-fv)+(c[1]*(1-fu)+d[1]*fu)*fv;
      const cx=(E-e0)/rx-0.5, cy=(n1-Nn)/ry-0.5, x=Math.min(tif.w-2,Math.max(0,Math.floor(cx))), y=Math.min(tif.h-2,Math.max(0,Math.floor(cy))), ax=cx-x, ay=cy-y, k=y*tif.w+x, T=tif.data;
      let h=T[k]*(1-ax)*(1-ay)+T[k+1]*ax*(1-ay)+T[k+tif.w]*(1-ax)*ay+T[k+tif.w+1]*ax*ay;
      if(!(h>-500&&h<5000))h=elevAt(gxOfMx(mx0+(mx1-mx0)*i/(PN-1)),gyOfMy(my1-(my1-my0)*j/(PN-1)));
      dem[j*PN+i]=h;
    }}
  return dem;
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
  g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
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
    terrain.add(p.mesh); rebuildMask();
    if(lastMarker)placeMarker(lastMarker[0],lastMarker[1]);
  }catch(e){console.warn("Detailkachel",p.key,e);p.failed=true}
  p.loading=false; patchBusy--; scheduleLOD();
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
const ctxShared={orthoMap:{value:blank0()},ctxOrtho:{value:0},exag:{value:state.exag},
  hole:{value:new THREE.Vector4((-W/2-0.5+1)*sc,(-H/2-0.5+1)*sc,(W/2-0.5-1)*sc,(H/2-0.5-1)*sc)}};
const ctxMat=new THREE.ShaderMaterial({
  uniforms:Object.assign({},ctxShared,{mode:shared.mode,winter:shared.winter,lineN:shared.lineN,lineS:shared.lineS,steepLo:shared.steepLo,steepHi:shared.steepHi,ctxAmt:shared.ctxAmt,camPos:shared.camPos,haze:shared.haze,fogNear:shared.fogNear,fogFar:shared.fogFar}),
  vertexShader:`
    uniform float exag; varying vec2 vUv; varying vec3 vN; varying float vElev; varying vec3 vWorld;
    void main(){ vUv=uv; vElev=position.y*100.0; vN=normalize(vec3(normal.x,normal.y/exag,normal.z));
      vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
  fragmentShader:`
    uniform sampler2D orthoMap; uniform float ctxOrtho, mode, winter, lineN, lineS, steepLo, steepHi, ctxAmt, fogNear, fogFar;
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
      gl_FragColor=vec4(col,1.0);
    }`
});
const ctxPromise=CG?loadB64Gz("data/context-dem.txt?v="+APPV).catch(e=>{console.warn(e);return null}):Promise.resolve(null);
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
async function renderOrtho(mx0,mx1,my0,my1,z,onProgress,transparent){
  const tileM=2*ORIGIN/2**z, res=tileM/256;
  const w=Math.ceil((mx1-mx0)/res), h=Math.ceil((my1-my0)/res);
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const ctx=cv.getContext("2d"); if(!transparent){ctx.fillStyle="#8c8f84"; ctx.fillRect(0,0,w,h)}
  const tx0=Math.floor((mx0+ORIGIN)/tileM), tx1=Math.floor((mx1+ORIGIN)/tileM);
  const ty0=Math.floor((ORIGIN-my1)/tileM), ty1=Math.floor((ORIGIN-my0)/tileM);
  const jobs=[]; let done=0, ok=0; const total=(tx1-tx0+1)*(ty1-ty0+1);
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){
    jobs.push(fetchTile(tileUrl(z,tx,ty)).then(bm=>{
      if(bm){ok++;ctx.drawImage(bm,(tx*tileM-ORIGIN-mx0)/res,(my1-(ORIGIN-ty*tileM))/res,256,256);bm.close&&bm.close()}
      done++; onProgress&&onProgress(done/total);
    }));
  }
  await Promise.all(jobs);
  return ok>=total*(transparent?0.2:0.6)?cv:null;
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
  for(let i=0;i<D.length;i+=4){D[i+1]=B[i];D[i+2]=0;D[i+3]=255}
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
  state.exag=+e.target.value; $("exagOut").textContent=fmt(state.exag,1)+"×";
  terrain.scale.y=state.exag; treeGroup.scale.y=state.exag; ctxGroup.scale.y=state.exag; ctxShared.exag.value=state.exag; buildRouteLine();
  if(lastMarker)placeMarker(lastMarker[0],lastMarker[1]);
  needsRender=true;
};

// ---------- Labels (OpenStreetMap names), decluttered on screen ----------
const labelsEl=$("labels");
const RANK={place:4000,peak:0,lift:-400,saddle:-800};
const labelNodes=META.labels.map(L=>{
  const el=document.createElement("div"); el.className="lbl "+L.t;
  const h=L.h?`<span class="h">${fmt(L.h)} m</span>`:"";
  el.innerHTML=`<span>${L.name}</span>${L.t==="place"?"":h}`;
  labelsEl.appendChild(el);
  return {el,gx:lonToX(L.lon),gy:latToY(L.lat),prio:(L.h||1500)+RANK[L.t],w:L.name.length*6.6+14};
}).sort((a,b)=>b.prio-a.prio);
const v3=new THREE.Vector3();
function project(gx,gy,el,lift){
  const w=mapEl.clientWidth,h=mapEl.clientHeight;
  v3.copy(gridToWorld(gx,gy,lift)).project(camera);
  const vis=v3.z<1&&v3.x>-1.1&&v3.x<1.1&&v3.y>-1.1&&v3.y<1.1;
  el.style.display=vis?"":"none";
  if(vis)el.style.transform=`translate(${(v3.x+1)/2*w}px,${(1-v3.y)/2*h}px) translate(-50%,${el.classList.contains("rdot")?"-50%":"-100%"})`;
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
    o.el.hidden=!state.labels; if(!state.labels)continue;
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
function slopePill(s){const c=slopeClass(s);if(c<0)return `<span class="pill" style="background:var(--chip);color:var(--muted)">unter 30°</span>`;
  const names=["30–35°","35–40°","40–45°","über 45°"],bg=["var(--s30)","var(--s35)","var(--s40)","var(--s45)"];
  return `<span class="pill" style="background:${bg[c]};color:${c>=2?"#fff":"#1b2420"}">${names[c]}</span>`}
function showPoint(gx,gy){
  const k=idxAt(gx,gy), e=heightGrid(gx,gy), ps=patchSlope(gx,gy), s=ps!==null?ps:slopeAt(k);
  $("pointInfo").innerHTML=`<div class="point"><span class="big">${fmt(Math.round(e))} m</span><span class="big">${fmt(Math.round(s))}°</span>${slopePill(s)}</div>
  ${state.winter&&winterKey?`<div class="point"><span class="sub">Winter-Modell: ${snowText(data[k*4+2]/255)}</span></div>`:""}
  <div class="point"><span class="sub">Exposition ${ASPECTS[aspect[k]]}</span><span class="sub">${fmt(yToLat(gy),5)} N, ${fmt(xToLon(gx),5)} O</span></div>`;
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

// ---------- Controls ----------
function applyUniforms(){
  shared.mode.value=state.base==="ortho"?0:1;
  shared.showSlope.value=state.slope?1:0; shared.showContour.value=state.contour?1:0; shared.showAspect.value=state.aspect?1:0;
  $("legendAspect").hidden=!state.aspect;
  shared.winter.value=state.winter&&winterKey?1:0;
  $("legend").hidden=!state.slope; $("winterSec").hidden=!state.winter;
  if(lastMarker)showPoint(lastMarker[0],lastMarker[1]);
  needsRender=true;
}
function setBase(b){state.base=b;$("bmOrtho").setAttribute("aria-pressed",b==="ortho");$("bmRelief").setAttribute("aria-pressed",b==="relief");applyUniforms();if(b==="ortho")scheduleLOD()}
$("bmOrtho").onclick=()=>setBase("ortho");
$("bmRelief").onclick=()=>setBase("relief");
[["lySlope","slope"],["lyAspect","aspect"],["lyTrees","trees"],["lyContour","contour"],["lyRoute","route"],["lyLabels","labels"],["lyWinter","winter"]].forEach(([id,key])=>{
  $(id).onclick=async()=>{
    state[key]=!state[key];$(id).setAttribute("aria-pressed",state[key]);
    if(key==="winter"&&state.winter)await computeWinter();
    if(key==="route")buildRouteLine();
    if(key==="trees")updateLOD();
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
  ["./","index.html","js/app.js?v="+APPV,"data/nordkette-meta.js?v="+APPV,"data/nordkette-dem.txt?v="+APPV,"data/nordkette-veg.txt?v="+APPV,"data/nordkette-trees.txt?v="+APPV,"data/context-dem.txt?v="+APPV,"manifest.webmanifest","icon.svg","icon-192.png","icon-512.png"].forEach(u=>urls.add(new URL(u,location.href).href));
  [...document.querySelectorAll("script[src],link[rel=stylesheet]")].forEach(e=>urls.add(e.src||e.href));
  const ex0=G.x0, ex1=G.x0+W*G.cell, ey1=G.y1, ey0=G.y1-H*G.cell;
  orthoUrls(ex0,ex1,ey0,ey1,15).forEach(u=>urls.add(u));
  if(CG)orthoUrls(CG.x0,CG.x0+CG.W*CG.cell,CG.y1-CG.H*CG.cell,CG.y1,12).forEach(u=>urls.add(u));
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
  st.textContent=fail?`Gespeichert, aber ${fail} von ${urls.length} Dateien fehlen. Bei Empfang nochmal tippen.${est}`:`Nordkette ist offline verfügbar.${est}`;
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

// ---------- Start ----------
await tick("Karte wird gezeichnet …");
$("routeInfo").innerHTML='<p class="hint">Lade eine GPX-Datei, um Profil und Hangneigung entlang der Spur zu sehen.</p>';
function resize(){
  const w=mapEl.clientWidth,h=mapEl.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  routeLines.forEach(l=>l.material.resolution.set(w,h)); needsRender=true; if(route)drawProfile();
}
new ResizeObserver(resize).observe(mapEl); resize();
{const L=META.labels.find(l=>l.name==="Hafelekarspitze")||META.labels[0]; lookAt(lonToX(L.lon),latToY(L.lat)+260,32,"3d")}
if(state.winter)await computeWinter();
applyUniforms();
loadEl.hidden=true;
controls.addEventListener("change",()=>{needsRender=true;scheduleLOD()});
(function loop(){
  controls.update();
  if(needsRender){needsRender=false;shared.camPos.value.copy(camera.position);renderer.render(scene,camera);updateLabels();drawGlobe()}
  requestAnimationFrame(loop);
})();
})().catch(err=>{const l=document.getElementById("loading");if(l){l.hidden=false;l.textContent="Fehler beim Laden: "+err.message}console.error(err)});
