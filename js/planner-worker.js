// Tour planner: least-cost route between two points on the loaded terrain.
// Cost = walking effort (distance, height, steepness of the track) + avalanche terrain indicator.
// The indicator follows the idea of the reduction methods and Skitourenguru: depending on the danger level a
// larger area counts (the track, its surroundings, the whole slope, the slope including runout), and outside the
// core zone (critical aspects and elevations from the bulletin) the danger level is lowered by one.
"use strict";
let T=null; // terrain prepared once per area
function prep(d){
  const {dm,W,H,cellRow,veg,tcd}=d, w=W>>1, h=H>>1, n=w*h;
  const z=new Float32Array(n), cs=new Float32Array(h);
  for(let y=0;y<h;y++){cs[y]=cellRow[2*y]*2;
    for(let x=0;x<w;x++){const a=(2*y)*W+2*x;z[y*w+x]=(dm[a]+dm[a+1]+dm[a+W]+dm[a+W+1])*0.025}}
  const slope=new Float32Array(n), asp=new Uint8Array(n), ridge=new Uint8Array(n), forest=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x, xm=Math.max(0,x-1), xp=Math.min(w-1,x+1), ym=Math.max(0,y-1), yp=Math.min(h-1,y+1);
    const gx=(z[y*w+xp]-z[y*w+xm])/((xp-xm)*cs[y]), gy=(z[yp*w+x]-z[ym*w+x])/((yp-ym)*cs[y]);
    slope[k]=Math.atan(Math.hypot(gx,gy))*180/Math.PI;
    // downhill direction -> aspect class 0..7 (N, NE, ...); y grows southwards
    const a=(Math.atan2(-gx,gy)*180/Math.PI+360)%360; asp[k]=Math.round(a/45)%8;
    // crest: clearly higher than the surroundings within ~30 m
    let s=0,c=0; for(let j=-3;j<=3;j+=3)for(let i=-3;i<=3;i+=3){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h){s+=z[yy*w+xx];c++}}
    ridge[k]=z[k]-s/c>2.5?1:0;
    if(tcd)forest[k]=tcd[k*2]>=60?1:0; else if(veg)forest[k]=veg[k*2]>150?1:0;
  }
  // order by elevation, highest first (for the whole-slope pass)
  const ord=new Uint32Array(n); for(let k=0;k<n;k++)ord[k]=k;
  ord.sort((a,b)=>z[b]-z[a]);
  // tree cover density (0..100) for the ski cost: light forest is fine, dense forest is hard to ski
  const dens=new Uint8Array(n); if(tcd)for(let k=0;k<n;k++)dens[k]=tcd[k*2]; else if(veg)for(let k=0;k<n;k++)dens[k]=Math.round(veg[k*2]/255*80);
  // room for kick turns: distance (cells of ~10 m) to the nearest ground of 45° or more
  const free=new Uint8Array(n).fill(30);
  for(let k=0;k<n;k++)if(slope[k]>=45)free[k]=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x; if(x)free[k]=Math.min(free[k],free[k-1]+1); if(y)free[k]=Math.min(free[k],free[k-w]+1)}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const k=y*w+x; if(x<w-1)free[k]=Math.min(free[k],free[k+1]+1); if(y<h-1)free[k]=Math.min(free[k],free[k+w]+1)}
  T={w,h,n,z,cs,slope,asp,ridge,forest,dens,ord,free,key:d.key};
}
// max filter with radius r (cells), separable
function maxFilter(src,w,h,r){
  const tmp=new Float32Array(w*h), out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=0;for(let i=Math.max(0,x-r);i<=Math.min(w-1,x+r);i++)m=Math.max(m,src[y*w+i]);tmp[y*w+x]=m}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=0;for(let j=Math.max(0,y-r);j<=Math.min(h-1,y+r);j++)m=Math.max(m,tmp[j*w+x]);out[y*w+x]=m}
  return out;
}
// steepest slope above a cell (and runout below it): spread the maximum downhill to all lower neighbours,
// and keep it for `run` cells once the terrain flattens out
function wholeSlope(run){
  const {w,h,n,z,slope,ord}=T, up=new Float32Array(n), dist=new Uint16Array(n).fill(65535);
  for(let k=0;k<n;k++){if(slope[k]>=28){up[k]=slope[k];dist[k]=0}}
  for(let q=0;q<n;q++){const c=ord[q], x=c%w, y=(c-x)/w;
    if(up[c]<28||dist[c]>run)continue;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){if(!i&&!j)continue;const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const m=yy*w+xx; if(z[m]>=z[c])continue;
      const nd=slope[m]>=28?0:dist[c]+1; if(nd>run)continue;
      if(up[c]>up[m]){up[m]=up[c];dist[m]=Math.min(dist[m],nd)}else if(up[c]===up[m]&&nd<dist[m])dist[m]=nd}}
  for(let k=0;k<n;k++)up[k]=Math.max(up[k],slope[k]);
  return up;
}
function hazard(p){
  const {w,h,n,z,slope,asp,ridge,forest}=T;
  const near=maxFilter(slope,w,h,2), wr3=wholeSlope(8), wr4=wholeSlope(16);
  const I=new Float32Array(n);
  for(let k=0;k<n;k++){
    // core zone: critical aspects (with the two neighbours half) above the critical elevation, soft edges
    const a=asp[k]; let ca=p.core[a]?1:(p.core[(a+1)%8]||p.core[(a+7)%8])?0.5:0;
    if(!p.core.some(Boolean))ca=1; // no core zone given: whole area counts as core zone
    const ce=p.coreElev>0?Math.min(1,Math.max(0,(z[k]-p.coreElev+100)/200)):1;
    const dl=Math.max(0,p.dl-1+ca*ce);
    // area that counts grows with the danger level
    const s=dl<=1?slope[k]: dl<=2?slope[k]+(near[k]-slope[k])*(dl-1): dl<=3?near[k]+(wr3[k]-near[k])*(dl-2): wr3[k]+(wr4[k]-wr3[k])*(dl-3);
    const t=dl<=3?45-5*dl:30-2*(dl-3);
    let v=Math.max(0,Math.min(3,(s-t)/5+1)); if(s<t-5)v=0;
    if(forest[k])v*=0.4; if(ridge[k]&&dl<3)v*=0.6;
    I[k]=v;
  }
  return I;
}
function astar(p,I){
  const {w,h,n,z,cs,slope,dens}=T, ski=p.mode!=="hike", ways=p.ways, maxG=p.maxGrade||6;
  // extra cost factor per cell: forest density for ski tours, the path network for hikes
  const fac=new Float32Array(n);
  for(let k=0;k<n;k++){
    const wv=ways?ways[k]:0;
    if(ski){const t=dens[k];let f=t<35?0:t<65?(t-35)/30*1.2:1.2+(t-65)/35*4;
      if(wv===8)f-=0.4; else if(wv===7)f=Math.min(f,0.2)-0.1;   // marked ski tour routes, forest roads
      fac[k]=1+Math.max(-0.4,f)}
    else fac[k]=wv>=1&&wv<=6?(wv>maxG?25:0.25+0.12*Math.max(0,wv-2)):wv===7?0.3:6;
  }
  const start=p.s[1]*w+p.s[0], goal=p.g[1]*w+p.g[0];
  const g=new Float32Array(n).fill(Infinity), from=new Int32Array(n).fill(-1), closed=new Uint8Array(n);
  const heap=[], hk=[];
  const push=(k,f)=>{heap.push(k);hk.push(f);let i=heap.length-1;while(i>0){const pa=(i-1)>>1;if(hk[pa]<=hk[i])break;[heap[pa],heap[i]]=[heap[i],heap[pa]];[hk[pa],hk[i]]=[hk[i],hk[pa]];i=pa}};
  const pop=()=>{const top=heap[0],lk=heap.pop(),lf=hk.pop();if(heap.length){heap[0]=lk;hk[0]=lf;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<heap.length&&hk[l]<hk[m])m=l;if(r<heap.length&&hk[r]<hk[m])m=r;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];[hk[m],hk[i]]=[hk[i],hk[m]];i=m}}return top};
  const gx=p.g[0], gy=p.g[1], zg=z[goal];
  // heuristic scaled by the cheapest cell factor, so it stays admissible
  const hmin=ski?0.6:0.25;
  const hEst=k=>{const x=k%w,y=(k-x)/w;const d=Math.hypot(x-gx,y-gy)*cs[y];const dz=zg-z[k];return (d*0.015+(dz>0?dz*0.15:-dz*0.02))*hmin};
  const N16=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  g[start]=0; push(start,hEst(start)); let it=0;
  while(heap.length){
    const c=pop(); if(closed[c])continue; closed[c]=1; if(c===goal)break;
    if(++it%200000===0)postMessage({progress:it/n});
    const x=c%w, y=(c-x)/w;
    for(const [i,j] of N16){const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=w||yy>=h)continue;const m=yy*w+xx;if(closed[m])continue;
      const d=Math.hypot(i,j)*cs[y], dz=z[m]-z[c], ang=Math.atan(Math.abs(dz)/d)*57.2958;
      let base=d*0.015+(dz>0?dz*0.15:-dz*0.02);
      if(ski){ if(ang>28)base*=1+((ang-28)/4)**2; }      // too steep to skin up or ski comfortably: zigzag instead
      else if(fac[m]>=1&&ang>25)base*=1+((ang-25)/5)**2; // off the paths: avoid steep ground
      if(slope[m]>50)base*=8;                         // cliffs
      base*=(fac[c]+fac[m])*0.5;
      const hz=ski?(I[c]+I[m])*0.5:0, cost=base+d*0.015*p.weight*30*hz*hz;
      const ng=g[c]+cost; if(ng<g[m]){g[m]=ng;from[m]=c;push(m,ng+hEst(m))}}
  }
  if(from[goal]<0&&goal!==start)return null;
  const path=[]; for(let k=goal;k>=0;k=k===start?-1:from[k])path.push(k); path.reverse();
  return path;
}
// Ski tours: A* on a 20 m lattice with the direction of travel in the state. With corridor=true it finds
// where to go up (zigzag length already counted), skinTrack() then lays the actual zigzags into it.
const REACH=sl=>sl<=20?100:sl<=25?100-(sl-20)*8:sl<=30?60-(sl-25)*7:sl<=34?25-(sl-30)*3.7:10;
function astarSki(p,I){
  const {w,h,n,z,cs,slope,dens,free}=T, ways=p.ways;
  const fac=new Float32Array(n);
  // pistes (9), ski tour lines (8) and forest roads (7): no forest to fight through, a ready track to follow.
  // Pistes are some 30 to 60 m wide but mapped as a centre line: widened by one cell.
  const wy=ways?new Uint8Array(ways):null;
  if(wy)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x; if(ways[k]!==9)continue;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j; if(xx<0||yy<0||xx>=w||yy>=h)continue; const m=yy*w+xx; if(!wy[m])wy[m]=9}}
  // usable in winter: pistes, ski tour lines, forest roads and easy paths (T1 to T3). Summer paths are what
  // ski tourers follow through forest and mountain pine (reference track Nordkette: 60 to 90 % on paths
  // between 1200 and 1700 m). go: 2 on the way, 1 next to it (lines are mapped as centre lines)
  const use=v=>v>=7||(v>=1&&v<=3), go=new Uint8Array(n);
  if(wy){for(let k=0;k<n;k++)if(use(wy[k]))go[k]=2;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x; if(go[k]!==2)continue;
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j; if(xx<0||yy<0||xx>=w||yy>=h)continue; const m=yy*w+xx; if(!go[m])go[m]=1}}}
  for(let k=0;k<n;k++){const wv=wy?wy[k]:0, t=dens[k];let f=t<35?0:t<65?(t-35)/30*1.2:1.2+(t-65)/35*4;
    if(wv>=8)f=-0.45; else if(wv===7)f=-0.4; else if(go[k]===2)f=-0.35; else if(go[k]===1)f=Math.min(f,0)-0.15;
    fac[k]=1+Math.max(-0.45,f)}
  T.wy=wy; T.go=go;
  const nx=(w+1)>>1, ny=(h+1)>>1, NN=nx*ny, D=17;
  const D16=[[2,0],[4,2],[2,2],[2,4],[0,2],[-2,4],[-2,2],[-4,2],[-2,0],[-4,-2],[-2,-2],[-2,-4],[0,-2],[2,-4],[2,-2],[4,-2]];
  const ANG=D16.map(([x,y])=>Math.atan2(y,x));
  // turn cost by change of heading: kick turns (more than ~110°) are expensive
  const corr=!!p.corridor, TANS=Math.tan((p.skin||12)*Math.PI/180), TANW=Math.tan(20*Math.PI/180), BOOT=p.boot||45;
  const kick=(corr?0.25:1.6)*(p.turn||1), TC=[];
  for(let a=0;a<16;a++){TC.push([]);for(let b=0;b<16;b++){let d=Math.abs(ANG[a]-ANG[b]);if(d>Math.PI)d=2*Math.PI-d;const deg=d*57.2958;
    TC[a].push(deg<=30?0:deg<75?0.006*(deg-30):kick)}}
  const sx=Math.min(nx-1,Math.round(p.s[0]/2)), sy=Math.min(ny-1,Math.round(p.s[1]/2)), gx=Math.min(nx-1,Math.round(p.g[0]/2)), gy=Math.min(ny-1,Math.round(p.g[1]/2));
  const cell=(i,j)=>Math.min(h-1,2*j)*w+Math.min(w-1,2*i);
  const goalN=gy*nx+gx, zg=z[cell(gx,gy)], HW=p.hw||1.6;   // weighted A*: a little less than optimal, many times faster
  const g=new Float32Array(NN*D).fill(Infinity), from=new Int32Array(NN*D).fill(-1), closed=new Uint8Array(NN*D);
  let hk=new Float32Array(1<<16), hv=new Int32Array(1<<16), hn=0;
  const push=(v,f)=>{if(hn>=hk.length){const k2=new Float32Array(hk.length*2),v2=new Int32Array(hk.length*2);k2.set(hk);v2.set(hv);hk=k2;hv=v2}
    let i=hn++;while(i>0){const pa=(i-1)>>1;if(hk[pa]<=f)break;hk[i]=hk[pa];hv[i]=hv[pa];i=pa}hk[i]=f;hv[i]=v};
  const pop=()=>{const top=hv[0],lf=hk[--hn],lv=hv[hn];let i=0;for(;;){const l=2*i+1,r=l+1;let m=-1,mf=lf;if(l<hn&&hk[l]<mf){m=l;mf=hk[l]}if(r<hn&&hk[r]<mf){m=r;mf=hk[r]}if(m<0)break;hk[i]=hk[m];hv[i]=hv[m];i=m}hk[i]=lf;hv[i]=lv;return top};
  // cost of one step from lattice node (i,j) in direction dd, without the turn
  const stepCost=(i,j,dd)=>{const ii=i+D16[dd][0]/2, jj=j+D16[dd][1]/2;
    const c=cell(i,j), m=cell(ii,jj), mid=Math.min(h-1,Math.round((2*j+2*jj)/2))*w+Math.min(w-1,Math.round((2*i+2*ii)/2));
    const d=Math.hypot(D16[dd][0],D16[dd][1])*cs[Math.min(h-1,2*j)], dz=z[m]-z[c], ang=Math.atan(Math.abs(dz)/d)*57.2958;
    if(corr){
      // corridor: where to go up, not yet how. Climbing steeper than the skin track angle costs the length of
      // the zigzags it needs (dz / tan(skin angle)) plus kick turns; ground too steep to zigzag on is avoided.
      const sm=Math.max(slope[m],slope[mid]), onWay=(go[m]||go[mid])&&(go[c]||go[mid]);
      // climbing a steep slope is hard work even in zigzags: short legs, many kick turns, slipping skins.
      // Real tracks take the gentler ground next to it when there is some (from about 28°, strongly from 33°).
      const stp=dz>0?1+(Math.min(37,Math.max(27,sm))-27)**2/36:1;
      const wall=sm>37?1+((sm-37)/2.5)**2:1;
      if(sm>=BOOT&&dz>0){
        // too steep for skins: boot pack straight up, slow, hard and exposed, the steeper the worse.
        // Avalanche exposure counted by time like a skin track (dz/tan(skin angle)), not by the short
        // straight distance, otherwise a rock face next to a gully looks safer than the gully itself.
        let b=(d*0.015+dz*3.2)*stp*(1+((sm-BOOT)/3)**2); if(sm>50)b*=8;   // only where there is no reasonable way around
        b*=(fac[c]+fac[mid]+fac[m])/3;
        const hz=(I[c]+I[mid]+I[m])/3; return b+Math.max(d,dz/TANS)*0.015*p.weight*30*hz*hz*wall}
      // on pistes, ski tour lines and forest roads the track goes straight up to about 20°
      // kick turns: one per leg, legs get short on steep ground (same widths as the skin track below)
      const tanS=onWay?TANW:TANS, dEff=dz>0?Math.max(d,dz/tanS):d, kicks=dz>0&&dz/d>tanS?dz/(2*REACH(sm)*tanS)*0.15:0;
      // effort grows with steepness (stp), the avalanche term only with the wall factor as before
      let eff=wall*(onWay?1:stp);
      // zigzags need room: in a gully narrower than ~20 m between steep walls kick turns get very short and awkward
      if(dz>0&&dz/d>tanS){const fr=Math.min(free[m],free[mid]); if(fr<2)eff*=1+(2-fr)*0.6}
      // + a little for the ground covered, so the corridor runs up the slope and the zigzags are added later
      let b=(dEff*0.015+d*0.012+(dz>0?dz*0.15:-dz*0.12)+kicks)*eff;   // going down on skins only to climb again is avoided
      if(slope[m]>50||slope[mid]>50)b*=8;
      b*=(fac[c]+fac[mid]+fac[m])/3;
      const hz=(I[c]+I[mid]+I[m])/3; return b+dEff*0.015*p.weight*30*hz*hz*wall}
    let base=d*0.015+(dz>0?dz*0.15:-dz*0.02);
    // a skin track steeper than ~30° is not skinnable: kick turns instead. The factor applies to the avalanche
    // term too, otherwise the route would go straight up through steep terrain to keep the exposure short.
    const steep=ang>26?1+((ang-26)/3)**2+(ang>31?((ang-31)/1.5)**3:0):1;
    if(slope[m]>50||slope[mid]>50)base*=8;                    // cliffs
    base*=(fac[c]+fac[mid]+fac[m])/3;
    const hz=(I[c]+I[mid]+I[m])/3; return (base+d*0.015*p.weight*30*hz*hz)*steep};
  // exact remaining cost without turns (backwards Dijkstra from the goal) as heuristic: the search then stays in a narrow corridor
  const H2=new Float32Array(NN).fill(Infinity), dn=new Uint8Array(NN);
  {let qk=new Float32Array(1<<16), qv=new Int32Array(1<<16), qn=0;
    const qpush=(v,f)=>{if(qn>=qk.length){const k2=new Float32Array(qk.length*2),v2=new Int32Array(qk.length*2);k2.set(qk);v2.set(qv);qk=k2;qv=v2}
      let i=qn++;while(i>0){const pa=(i-1)>>1;if(qk[pa]<=f)break;qk[i]=qk[pa];qv[i]=qv[pa];i=pa}qk[i]=f;qv[i]=v};
    const qpop=()=>{const top=qv[0],lf=qk[--qn],lv=qv[qn];let i=0;for(;;){const l=2*i+1,r=l+1;let m=-1,mf=lf;if(l<qn&&qk[l]<mf){m=l;mf=qk[l]}if(r<qn&&qk[r]<mf){m=r;mf=qk[r]}if(m<0)break;qk[i]=qk[m];qv[i]=qv[m];i=m}qk[i]=lf;qv[i]=lv;return top};
    H2[goalN]=0; qpush(goalN,0); const sN=sy*nx+sx;
    while(qn){const u=qpop(); if(dn[u])continue; dn[u]=1; if(u===sN&&false)break;
      const i=u%nx, j=(u-i)/nx;
      for(let dd=0;dd<16;dd++){const ii=i-D16[dd][0]/2, jj=j-D16[dd][1]/2; if(ii<0||jj<0||ii>=nx||jj>=ny)continue;
        const v=jj*nx+ii; if(dn[v])continue; const nd=H2[u]+stepCost(ii,jj,dd); if(nd<H2[v]){H2[v]=nd;qpush(v,nd)}}}
  }
  const hEst=(i,j)=>H2[j*nx+i];
  const st=(sy*nx+sx)*D+16; if(!(H2[sy*nx+sx]<Infinity))return null; g[st]=0; push(st,hEst(sx,sy)); let it=0, best=-1;
  while(hn){
    const s=pop(); if(closed[s])continue; closed[s]=1;
    const node=(s/D)|0, din=s-node*D; if(node===goalN){best=s;break}
    if(++it%300000===0)postMessage({progress:it/(NN*4)});
    const i=node%nx, j=(node-i)/nx;
    for(let dd=0;dd<16;dd++){const ii=i+D16[dd][0]/2, jj=j+D16[dd][1]/2; if(ii<0||jj<0||ii>=nx||jj>=ny)continue;
      const ns=(jj*nx+ii)*D+dd; if(closed[ns])continue;
      const ng=g[s]+stepCost(i,j,dd)+(din<16?TC[din][dd]:0); if(ng<g[ns]){g[ns]=ng;from[ns]=s;push(ns,ng+hEst(ii,jj))}}
  }
  if(best<0)return null;
  const out=[]; for(let s=best;s>=0;s=from[s]){const node=(s/D)|0, i=node%nx, j=(node-i)/nx; out.push(cell(i,j)); if(s===st)break}
  return out.reverse();
}
// ---- Skin track: zigzags along the corridor, like a real track ----
// Where the corridor climbs steeper than the skin angle, legs climb at that constant angle across the room
// the terrain gives (open slope: long legs, gully between rocks: short legs), with a kick turn at each end.
// Skin angle 12°: median of the reference track data/tracks/2025-11-27_Innsbruck_Splitboardtour.gpx (11.7°).
function zAt(x,y){const {w,h,z}=T;x=Math.max(0,Math.min(w-1.001,x));y=Math.max(0,Math.min(h-1.001,y));
  const i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,k=j*w+i;return z[k]*(1-a)*(1-b)+z[k+1]*a*(1-b)+z[k+w]*(1-a)*b+z[k+w+1]*a*b}
const cellAt=(x,y)=>Math.min(T.h-1,Math.max(0,Math.round(y)))*T.w+Math.min(T.w-1,Math.max(0,Math.round(x)));
function gradAt(x,y){const c=T.cs[Math.min(T.h-1,Math.max(0,Math.round(y)))];
  return [(zAt(x+1,y)-zAt(x-1,y))/(2*c),(zAt(x,y+1)-zAt(x,y-1))/(2*c),c]}
// Where the corridor runs along a piste, ski tour line, forest road or easy path, lay the track exactly on it:
// the 20 m lattice cannot follow the tight hairpins of a path, and a corridor that cuts them looks steep,
// so the skin track would add zigzags of its own beside the path. Returns cells plus the set of snapped ones.
function snapToWays(axis){
  const {w,h,go}=T; if(!go||!go.some(v=>v))return {cells:axis,on:new Set()};
  // runs of corridor points (every ~20 to 40 m) on or next to a way; elsewhere the corridor stays as it is
  const C=axis, out=[], on=new Set(); let i=0;
  while(i<C.length){
    if(!go[C[i]]){out.push(C[i]);i++;continue}
    let j=i; while(j<C.length-1&&go[C[j+1]])j++;
    if(j-i<2){for(let q=i;q<=j;q++)out.push(C[q]); i=j+1; continue}          // short touch of a way: keep the corridor
    // shortest way along the mapped line between the two ends (cells on the line cheap, next to it dearer)
    const a=C[i], b=C[j], ax=a%w, ay=(a-ax)/w, bx=b%w, by=(b-bx)/w, pad=25;
    const x0=Math.max(0,Math.min(ax,bx)-pad), x1=Math.min(w-1,Math.max(ax,bx)+pad), y0=Math.max(0,Math.min(ay,by)-pad), y1=Math.min(h-1,Math.max(ay,by)+pad);
    const BW=x1-x0+1, BH=y1-y0+1, dist=new Float32Array(BW*BH).fill(Infinity), prev=new Int32Array(BW*BH).fill(-1), q=[];
    const L=(k)=>{const x=k%w,y=(k-x)/w;return (y-y0)*BW+(x-x0)};
    dist[L(a)]=0; q.push([0,a]);
    while(q.length){let mi=0;for(let r=1;r<q.length;r++)if(q[r][0]<q[mi][0])mi=r; const [dd,u]=q.splice(mi,1)[0]; if(dd>dist[L(u)])continue; if(u===b)break;
      const ux=u%w, uy=(u-ux)/w;
      for(let jy=-1;jy<=1;jy++)for(let jx=-1;jx<=1;jx++){if(!jx&&!jy)continue; const vx=ux+jx, vy=uy+jy; if(vx<x0||vx>x1||vy<y0||vy>y1)continue;
        const v=vy*w+vx; if(!go[v])continue; const nd=dd+Math.hypot(jx,jy)*(go[v]===2?1:2.5);
        if(nd<dist[L(v)]){dist[L(v)]=nd;prev[L(v)]=u;q.push([nd,v])}}}
    let lenC=0; for(let q=i+1;q<=j;q++){const p0=C[q-1],p1=C[q];lenC+=Math.hypot(p1%w-p0%w,(p1-p1%w)/w-(p0-p0%w)/w)}
    let seg=null;
    if(dist[L(b)]<Infinity&&dist[L(b)]<lenC*2+4){
      seg=[]; for(let u=b;u!==-1;u=u===a?-1:prev[L(u)])seg.push(u); seg.reverse();
      // no detours down the mountain: the way may not lose clearly more height than the corridor does
      const drop=cs=>{let d=0,lo=T.z[cs[0]];for(const k of cs){const z=T.z[k];if(z>lo)lo=z;else d=Math.max(d,lo-z)}return d};
      if(drop(seg)>drop(C.slice(i,j+1))+8)seg=null;
    }
    if(seg)for(const k of seg){on.add(out.length);out.push(k)}
    else for(let q2=i;q2<=j;q2++)out.push(C[q2]);
    i=j+1;
  }
  return {cells:out,on};
}
function skinTrack(axis,p,I){
  const {w,h,slope,dens}=T, skin=(p.skin||12)*Math.PI/180;
  const BOOT=p.boot||45, go=T.go;
  const ok=(x,y)=>{if(x<1||y<1||x>w-2||y>h-2)return false;const k=cellAt(x,y);return slope[k]<BOOT+1.5&&dens[k]<75};   // the corridor already weighed the avalanche terrain; inside it the track zigzags up even steep gullies (Karrinne)
  // smooth and resample the corridor every cell (~10 m)
  const snap=snapToWays(axis), onW=snap.on;
  let A=snap.cells.map(k=>[k%w,(k-k%w)/w]);
  // smooth the lattice steps, but not where the track lies on a way (keeps its hairpins)
  for(let r=0;r<3;r++)A=A.map((q,i)=>i===0||i===A.length-1||onW.has(i)?q:[(A[i-1][0]+2*q[0]+A[i+1][0])/4,(A[i-1][1]+2*q[1]+A[i+1][1])/4]);
  const R=[A[0]]; for(let i=1;i<A.length;i++){const a=R[R.length-1],b=A[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(d<1)continue; const n=Math.floor(d); for(let k=1;k<=n;k++)R.push([a[0]+(b[0]-a[0])*k/d,a[1]+(b[1]-a[1])*k/d])}
  const last=A[A.length-1]; if(Math.hypot(last[0]-R[R.length-1][0],last[1]-R[R.length-1][1])>0.3)R.push(last);
  const n=R.length, Z=R.map(q=>zAt(q[0],q[1])), S=[0];
  for(let i=1;i<n;i++)S.push(S[i-1]+Math.hypot(R[i][0]-R[i-1][0],R[i][1]-R[i-1][1])*T.cs[Math.round(R[i][1])]);
  // steep parts: climbing grade over ~40 m above the skin angle (+3°)
  const steep=new Uint8Array(n), lim=Math.tan(skin+3*Math.PI/180), limW=Math.tan(23*Math.PI/180);
  const onWay=i=>go&&go[cellAt(R[i][0],R[i][1])]>0;
  for(let i=0;i<n;i++){let j=i;while(j<n-1&&S[j]-S[i]<40)j++; let wc=0; for(let k=i;k<=j;k++)if(onWay(k))wc++;
    const L=wc>(j-i+1)/2?limW:lim;                        // mostly on a piste or forest road: straight up to ~20°
    if(j>i&&(Z[j]-Z[i])/(S[j]-S[i])>L)for(let k=i;k<=j;k++)steep[k]=1}
  const out=[R[0]], boot=new Set();
  const tang=i=>{const a=R[Math.max(0,i-2)],b=R[Math.min(n-1,i+2)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return [(b[0]-a[0])/l,(b[1]-a[1])/l]};
  const nearest=(P,from)=>{let bi=from,bd=1e9;for(let i=Math.max(0,from-15);i<Math.min(n,from+60);i++){const d=(R[i][0]-P[0])**2+(R[i][1]-P[1])**2;if(d<bd){bd=d;bi=i}}return bi};
  // free room across the corridor at axis index i: cells to the left (+) and right (-) of the axis
  // how far a leg reaches to each side, from the reference track (Nordkette, 27.11.2025): on moderate slopes
  // long legs, on steep ones short legs of 20 to 30 m with many kick turns
  const reach=REACH;
  const slopeNear=i=>{let m=0,c=0;for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){m+=slope[cellAt(R[i][0]+k,R[i][1]+j)];c++}return m/c};
  // gully floor: the least steep cell around (walls next to a narrow gully would make it look steeper)
  const slopeFloor=i=>{let m=90;for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++)m=Math.min(m,slope[cellAt(R[i][0]+k,R[i][1]+j)]);return m};
  const room=(i,sg)=>{const t=tang(i),nx=-t[1]*sg,ny=t[0]*sg,maxHW=reach(slopeNear(i))/T.cs[Math.round(R[i][1])];let r=0;
    while(r<maxHW&&ok(R[i][0]+nx*(r+0.5),R[i][1]+ny*(r+0.5)))r+=0.5; return r};
  let i=0, done=-1;
  while(i<n-1){
    if(!steep[i]||i===done){i++;out.push(R[i]);continue}
    let e=i; while(e<n-1&&steep[e+1])e++;                 // steep section i..e: zigzag from R[i] up to R[e]
    const zEnd=Z[e]; let P=R[i].slice(), k=i, legs=0;
    let side=room(i,1)>=room(i,-1)?1:-1;
    while(legs<300){
      // too steep for skins (from about 43°): boot pack straight up the corridor, no kick turns
      if(slopeFloor(k)>=BOOT){out.push(R[k]);while(k<e&&slopeFloor(k)>=BOOT-1){k++;out.push(R[k]);boot.add(out.length-1)}
        P=R[k].slice(); if(k>=e||zAt(P[0],P[1])>=zEnd-2)break; continue}
      const t=tang(k), nrm=[-t[1],t[0]];
      const lim2=Math.max(0.8,room(k,side)*0.85);          // stay a bit inside the free room
      let len=0, z0=zAt(P[0],P[1]), th=skin, moved=false;
      for(let st=0;st<200;st++){
        const [gx,gy,c]=gradAt(P[0],P[1]), gl=Math.hypot(gx,gy), Sl=Math.atan(gl);
        let hx,hy;
        if(Sl<=th+0.02){hx=t[0];hy=t[1]}                     // not steeper than the skin angle here: straight on
        else{const cb=Math.tan(th)/Math.tan(Sl), sb=Math.sqrt(1-cb*cb);   // leg at the skin angle: cos(angle to fall line)=tan(skin)/tan(slope)
          const upx=gx/gl, upy=gy/gl; let cx=-upy, cy=upx; if((cx*nrm[0]+cy*nrm[1])*side<0){cx=-cx;cy=-cy}
          hx=cb*upx+sb*cx; hy=cb*upy+sb*cy}
        const Q=[P[0]+hx*0.5,P[1]+hy*0.5];
        if(!ok(Q[0],Q[1]))break;
        P=Q; len+=0.5; moved=true; k=nearest(P,k);
        if(len%2===0)out.push(P.slice());                  // keep the leg's shape (it follows the terrain), a point every ~20 m
        const off=(P[0]-R[k][0])*nrm[0]+(P[1]-R[k][1])*nrm[1];
        if(off*side>=lim2)break;                            // other side of the corridor reached: kick turn
        if(zAt(P[0],P[1])>=zEnd-2||k>=e)break;
        if(len*c>150)break;                                  // very wide open slope: legs of at most ~150 m
      }
      if(moved)out.push(P.slice());
      legs++;
      if(zAt(P[0],P[1])>=zEnd-2||k>=e)break;
      if(!moved||zAt(P[0],P[1])-z0<0.3){                   // no room to zigzag: straight up the corridor on foot
        const k0=k; k=Math.min(e,k+3); for(let q=k0+1;q<=k;q++){out.push(R[q].slice());boot.add(out.length-1)} P=R[k].slice()}
      side=-side;
    }
    i=e; done=e; out.push(R[e]);
  }
  out.boot=boot; return out;
}
onmessage=e=>{
  const d=e.data;
  try{
    if(d.prep){prep(d);postMessage({ready:true});return}
    if(!T)throw new Error("Gelände fehlt");
    const I=d.mode==="hike"?new Float32Array(T.n):hazard(d);
    if(d.mode==="hike"){
      const path=astar(d,I); if(!path){postMessage({err:"Keine Verbindung gefunden."});return}
      postMessage({pts:path.map(k=>{const x=k%T.w,y=(k-x)/T.w;return [x*2+1,y*2+1,I[k],T.slope[k]]})}); return}
    // ski tour: corridor first, then the skin track with real zigzags inside it
    const axis=astarSki({...d,corridor:true},I);
    if(!axis){postMessage({err:"Keine Verbindung gefunden."});return}
    const track=skinTrack(axis,d,I);
    const pts=track.map(([x,y],i)=>{const k=cellAt(x,y);return [x*2+1,y*2+1,I[k],T.slope[k],track.boot.has(i)?1:0]});
    postMessage({pts});
  }catch(err){postMessage({err:err.message||String(err)})}
};
