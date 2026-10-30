// Geodesy and GeoTIFF helpers for Malte Mountain Map.
// - Web Mercator <-> WGS84, WGS84 -> MGI / Austria GK West (EPSG:31254) incl. datum shift (EPSG:1618 parameters)
// - Minimal reader for uncompressed float32 GeoTIFFs as returned by the Land Tirol WCS
(function(root){
"use strict";
const R=6378137, D2R=Math.PI/180, AS2R=Math.PI/(180*3600);
const mercToLonLat=(x,y)=>[x/R/D2R,(2*Math.atan(Math.exp(y/R))-Math.PI/2)/D2R];
const lonLatToMerc=(lon,lat)=>[R*lon*D2R,R*Math.log(Math.tan(Math.PI/4+lat*D2R/2))];

// ellipsoids
const WGS={a:6378137,f:1/298.257223563}, BES={a:6377397.155,f:1/299.1528128};
[WGS,BES].forEach(e=>{e.e2=e.f*(2-e.f);e.b=e.a*(1-e.f)});
function geoToEcef(lon,lat,h,E){const p=lat*D2R,l=lon*D2R,s=Math.sin(p),N=E.a/Math.sqrt(1-E.e2*s*s);
  return [(N+h)*Math.cos(p)*Math.cos(l),(N+h)*Math.cos(p)*Math.sin(l),(N*(1-E.e2)+h)*s]}
function ecefToGeo(x,y,z,E){const lon=Math.atan2(y,x),p=Math.hypot(x,y);let lat=Math.atan2(z,p*(1-E.e2)),h=0;
  for(let i=0;i<6;i++){const s=Math.sin(lat),N=E.a/Math.sqrt(1-E.e2*s*s);h=p/Math.cos(lat)-N;lat=Math.atan2(z,p*(1-E.e2*N/(N+h)))}
  return [lon/D2R,lat/D2R,h]}
// MGI -> WGS84, position vector convention; we apply the inverse
const T=[577.326,90.129,463.919], RX=5.137*AS2R, RY=1.474*AS2R, RZ=5.297*AS2R, S=2.4232e-6;
function wgsToMgiEcef(x,y,z){
  const X=x-T[0],Y=y-T[1],Z=z-T[2], k=1/(1+S);
  // inverse of the small rotation matrix is its transpose
  return [k*(X+RZ*Y-RY*Z), k*(-RZ*X+Y+RX*Z), k*(RY*X-RX*Y+Z)];
}
// transverse mercator (Snyder), Bessel, GK West: lon0 10°20', k0 1, false northing -5 000 000
const LON0Z={28:(10+1/3)*D2R,31:(13+1/3)*D2R};
function meridian(phi,E){const e2=E.e2,e4=e2*e2,e6=e4*e2;
  return E.a*((1-e2/4-3*e4/64-5*e6/256)*phi-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*phi)+(15*e4/256+45*e6/1024)*Math.sin(4*phi)-(35*e6/3072)*Math.sin(6*phi))}
function tmForward(lon,lat,E,LON0){
  const phi=lat*D2R, lam=lon*D2R, e2=E.e2, ep2=e2/(1-e2);
  const s=Math.sin(phi),c=Math.cos(phi),t=Math.tan(phi);
  const N=E.a/Math.sqrt(1-e2*s*s), Tt=t*t, C=ep2*c*c, A=(lam-LON0)*c, M=meridian(phi,E);
  const x=N*(A+(1-Tt+C)*A**3/6+(5-18*Tt+Tt*Tt+72*C-58*ep2)*A**5/120);
  const y=M+N*t*(A*A/2+(5-Tt+9*C+4*C*C)*A**4/24+(61-58*Tt+Tt*Tt+600*C-330*ep2)*A**6/720);
  return [x,y-5000000];
}
function lonLatToGK(lon,lat,zone){
  const p=geoToEcef(lon,lat,0,WGS), q=wgsToMgiEcef(p[0],p[1],p[2]), g=ecefToGeo(q[0],q[1],q[2],BES);
  return tmForward(g[0],g[1],BES,LON0Z[zone||28]);
}
const mercToGK=(x,y,zone)=>{const ll=mercToLonLat(x,y);return lonLatToGK(ll[0],ll[1],zone)};

// ---- GeoTIFF (uncompressed float32, strips or tiles) ----
function readTiff(buf){
  const dv=new DataView(buf), le=dv.getUint16(0)===0x4949;
  const u16=o=>dv.getUint16(o,le), u32=o=>dv.getUint32(o,le);
  if(u16(2)!==42)throw new Error("Kein TIFF");
  const ifd=u32(4), n=u16(ifd), tags={};
  const SZ={1:1,2:1,3:2,4:4,5:8,11:4,12:8,16:8};
  for(let i=0;i<n;i++){
    const o=ifd+2+i*12, tag=u16(o), type=u16(o+2), cnt=u32(o+4), size=SZ[type]*cnt, vo=size<=4?o+8:u32(o+8);
    const vals=[];
    for(let j=0;j<Math.min(cnt,100000);j++){
      const p=vo+j*SZ[type];
      vals.push(type===3?u16(p):type===4||type===16?u32(p):type===12?dv.getFloat64(p,le):type===11?dv.getFloat32(p,le):type===5?u32(p)/u32(p+4):dv.getUint8(p));
    }
    tags[tag]=vals;
  }
  const w=tags[256][0], h=tags[257][0], bps=(tags[258]||[32])[0], fmt=(tags[339]||[1])[0], comp=(tags[259]||[1])[0];
  if(comp!==1)throw new Error("TIFF komprimiert ("+comp+")");
  if(bps!==32||fmt!==3)throw new Error("TIFF kein float32");
  const out=new Float32Array(w*h);
  const readF=(off,count,dst)=>{for(let i=0;i<count;i++)dst[i]=dv.getFloat32(off+i*4,le)};
  if(tags[324]){ // tiled
    const tw=tags[322][0], th=tags[323][0], offs=tags[324], across=Math.ceil(w/tw), tmp=new Float32Array(tw*th);
    offs.forEach((off,ti)=>{const tx=ti%across,ty=Math.floor(ti/across); readF(off,tw*th,tmp);
      for(let r=0;r<th;r++){const y=ty*th+r; if(y>=h)break; for(let c=0;c<tw;c++){const x=tx*tw+c; if(x<w)out[y*w+x]=tmp[r*tw+c]}}});
  } else {
    const offs=tags[273], rps=(tags[278]||[h])[0];
    offs.forEach((off,si)=>{const rows=Math.min(rps,h-si*rps); const sub=new Float32Array(rows*w); readF(off,rows*w,sub); out.set(sub,si*rps*w)});
  }
  const tie=tags[33922], scale=tags[33550];
  return {w,h,data:out,x0:tie?tie[3]:0,y0:tie?tie[4]:0,rx:scale?scale[0]:1,ry:scale?scale[1]:1};
}
root.MMMGeo={mercToLonLat,lonLatToMerc,lonLatToGK,mercToGK,readTiff};
})(typeof window!=="undefined"?window:globalThis);
