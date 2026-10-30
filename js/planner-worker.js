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
onmessage=e=>{
  const d=e.data;
  try{
    if(d.prep){prep(d);postMessage({ready:true});return}
    if(!T)throw new Error("Gelände fehlt");
    const I=d.mode==="hike"?new Float32Array(T.n):hazard(d);
    const path=astar(d,I);
    if(!path){postMessage({err:"Keine Verbindung gefunden."});return}
    const pts=path.map(k=>{const x=k%T.w,y=(k-x)/T.w;return [x*2+1,y*2+1,I[k],T.slope[k]]});
    postMessage({pts});
  }catch(err){postMessage({err:err.message||String(err)})}
};
