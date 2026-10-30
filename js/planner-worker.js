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
  T={w,h,n,z,cs,slope,asp,ridge,forest,dens,ord,key:d.key};
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
// Ski tours: A* on a 20 m lattice with the direction of travel in the state, so every kick turn costs
// something. That gives fewer, longer zigzags, like a good skin track, instead of tight ladders.
function astarSki(p,I){
  const {w,h,n,z,cs,slope,dens}=T, ways=p.ways;
  const fac=new Float32Array(n);
  for(let k=0;k<n;k++){const wv=ways?ways[k]:0, t=dens[k];let f=t<35?0:t<65?(t-35)/30*1.2:1.2+(t-65)/35*4;
    if(wv===8)f-=0.4; else if(wv===7)f=Math.min(f,0.2)-0.1; fac[k]=1+Math.max(-0.4,f)}
  const nx=(w+1)>>1, ny=(h+1)>>1, NN=nx*ny, D=17;
  const D16=[[2,0],[4,2],[2,2],[2,4],[0,2],[-2,4],[-2,2],[-4,2],[-2,0],[-4,-2],[-2,-2],[-2,-4],[0,-2],[2,-4],[2,-2],[4,-2]];
  const ANG=D16.map(([x,y])=>Math.atan2(y,x));
  // turn cost by change of heading: kick turns (more than ~110°) are expensive
  const kick=1.6*(p.turn||1), TC=[];
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
onmessage=e=>{
  const d=e.data;
  try{
    if(d.prep){prep(d);postMessage({ready:true});return}
    if(!T)throw new Error("Gelände fehlt");
    const I=d.mode==="hike"?new Float32Array(T.n):hazard(d);
    const path=d.mode==="hike"?astar(d,I):astarSki(d,I);
    if(!path){postMessage({err:"Keine Verbindung gefunden."});return}
    const pts=path.map(k=>{const x=k%T.w,y=(k-x)/T.w;return [x*2+1,y*2+1,I[k],T.slope[k]]});
    postMessage({pts});
  }catch(err){postMessage({err:err.message||String(err)})}
};
