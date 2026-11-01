// Builds areas of the map in advance (headless Chromium, same code as the app) and writes
// <out>/index.json plus one <lon>,<lat>.bin per area. Keeps areas already in <out>.
// node tools/prebuild.mjs <out> <budgetMB> <minutes>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {chromium} from "playwright";
import {execFileSync} from "node:child_process";

const [out="regions-out", budgetMB="420", minutes="300"]=process.argv.slice(2);
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const BUDGET=+budgetMB*1e6, DEADLINE=Date.now()+(+minutes)*60e3;
fs.mkdirSync(out,{recursive:true});

// [name, lon, lat, extra] : Tirol first, then a few other well-known touring areas
const SPOTS=[
  ["Nordkette",11.38,47.30],["Axamer Lizum / Kalkkögel",11.30,47.19],["Kühtai",11.02,47.21],
  ["Sellrain / Lüsens",11.13,47.13],["Stubaier Gletscher",11.13,47.00],["Franz-Senn-Hütte / Oberbergtal",11.17,47.09],
  ["Glungezer",11.53,47.22],["Wattener Lizum",11.64,47.17],["Hintertux",11.68,47.09],["Mayrhofen",11.86,47.17],
  ["Ginzling / Zillergrund",11.80,47.07],["Gerlos",12.03,47.22],["Sölden",11.01,46.97],["Obergurgl",11.03,46.87],
  ["Vent",10.91,46.86],["Pitztal / Mittelberg",10.88,46.95],["Kaunertal Gletscher",10.72,46.87],
  ["St. Anton am Arlberg",10.27,47.13],["Lech / Zürs",10.14,47.21],["Ischgl",10.29,47.01],["Galtür / Silvretta",10.19,46.97],
  ["Kals am Großglockner",12.64,47.00],
  ["Davos",9.83,46.80,1],["Pontresina / Bernina",9.95,46.45,1],["Zermatt",7.75,46.02,1],["Chamonix",6.87,45.92,1],
];
const SLON=0.08, SLAT=0.04;                       // grid of area centres (areas are 10 x 7.5 km, so they overlap)
const key=(lon,lat)=>lon.toFixed(2)+","+lat.toFixed(2);
const cell=(lon,lat)=>[+(Math.round(lon/SLON)*SLON).toFixed(2), +(Math.round(lat/SLAT)*SLAT).toFixed(2)];
const km=(a,b)=>Math.hypot((a[0]-b[0])*111.32*Math.cos(a[1]*Math.PI/180),(a[1]-b[1])*111.32);

// tiny static server for the repo
const MIME={".html":"text/html",".js":"text/javascript",".json":"application/json"};
const srv=http.createServer((q,r)=>{const p=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));
  if(!p.startsWith(ROOT)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.writeHead(404);r.end();return}
  r.writeHead(200,{"Content-Type":MIME[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(r)});
await new Promise(res=>srv.listen(8790,"127.0.0.1",res));

const browser=await chromium.launch();
let page=null;
async function fresh(){if(page)await page.close().catch(()=>{});page=await browser.newPage();
  page.on("console",m=>{if(m.type()==="error")console.log("  [page]",m.text().slice(0,200))});
  await page.goto("http://127.0.0.1:8790/tools/prebuild.html");await page.waitForFunction(()=>window.MMM_buildPack&&window.MMMSrc)}
await fresh();

// candidates: Tirol (Austria inside the Tirol box), plus the cells around the other spots
const cand=new Map();
for(let lat=46.64;lat<=47.76;lat+=SLAT)for(let lon=10.08;lon<=12.98;lon+=SLON){const [a,b]=cell(lon,lat);cand.set(key(a,b),[a,b])}
const inAT=await page.evaluate(ps=>ps.map(p=>MMMSrc.country(p[0],p[1])==="AT"),[...cand.values()]);
[...cand.keys()].forEach((k,i)=>{if(!inAT[i])cand.delete(k)});
for(const s of SPOTS.filter(s=>s[3]))for(let dy=-3;dy<=3;dy++)for(let dx=-2;dx<=2;dx++){const [a,b]=cell(s[1]+dx*SLON,s[2]+dy*SLAT);cand.set(key(a,b),[a,b])}
const first=[]; for(const s of SPOTS){const [a,b]=cell(s[1],s[2]);const k=key(a,b);cand.set(k,[a,b]);if(!first.includes(k))first.push(k)}
const score=p=>Math.min(...SPOTS.map(s=>km(p,[s[1],s[2]])*(s[3]?2.5:1)));
const order=[...first,...[...cand.keys()].filter(k=>!first.includes(k)).sort((x,y)=>score(cand.get(x))-score(cand.get(y)))];
console.log(`${order.length} Kandidaten`);

const idxFile=path.join(out,"index.json");
const idx=fs.existsSync(idxFile)?JSON.parse(fs.readFileSync(idxFile,"utf8")):{v:"b2",keys:[],sizes:{}};
idx.sizes=idx.sizes||{};
// areas listed in the index are kept: either the file is here, or it is already uploaded (REMOTE=1)
const REMOTE=process.env.REMOTE==="1";
idx.keys=idx.keys.filter(k=>REMOTE||fs.existsSync(path.join(out,k+".bin")));
const sizeOf=k=>fs.existsSync(path.join(out,k+".bin"))?fs.statSync(path.join(out,k+".bin")).size:(idx.sizes[k]||3.3e6);
let total=idx.keys.reduce((s,k)=>s+sizeOf(k),0);
console.log(`vorhanden: ${idx.keys.length} Gebiete, ${(total/1e6).toFixed(1)} MB`);
const save=()=>{idx.built=new Date().toISOString().slice(0,10);fs.writeFileSync(idxFile,JSON.stringify(idx))};

let n=0, fails=0, built=0;
for(const k of order){
  if(idx.keys.includes(k))continue;
  if(total>BUDGET*0.985||Date.now()>DEADLINE)break;
  const [lon,lat]=cand.get(k), t0=Date.now();
  try{
    // one area must not block the whole run: give up after 4 minutes and go on with the next
    let timer; const b64=await Promise.race([page.evaluate(async([lo,la])=>{const u=await MMM_buildPack(lo,la);
      return await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result.split(",")[1]);fr.readAsDataURL(new Blob([u]))})},[lon,lat]),
      new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error("Zeitüberschreitung (4 min)")),240e3)})]).finally(()=>clearTimeout(timer));
    const buf=Buffer.from(b64,"base64");
    if(total+buf.length>BUDGET){console.log(`${k}: passt nicht mehr ins Budget`);break}
    fs.writeFileSync(path.join(out,k+".bin"),buf); idx.keys.push(k); idx.sizes[k]=buf.length; total+=buf.length; save();
    const line=`${k}: ${(buf.length/1e6).toFixed(2)} MB in ${((Date.now()-t0)/1e3).toFixed(0)} s, gesamt ${(total/1e6).toFixed(0)} MB, ${idx.keys.length} Gebiete`;
    console.log(line); built++;
    // annotations are visible on the run page (and through the API) without opening the log
    if(built===1||built%15===0)console.log(`::notice title=Fortschritt::${line}`);
  }catch(e){fails++;const msg=String(e.message||e).slice(0,200);console.log(`${k}: Fehler ${msg}`);
    if(fails<=5)console.log(`::warning title=Fehler ${k}::${msg.replace(/\n/g," ")}`);
    if(!built&&fails>=6){console.log("::error::Die ersten Gebiete ließen sich nicht bauen, Abbruch");save();process.exit(1)}
    await fresh()}
  if(++n%8===0)await fresh();
  // upload what is done every 30 areas (UPLOAD is a shell command, see regions.yml), so a stopped run loses little
  if(process.env.UPLOAD&&built&&built%30===0){try{execFileSync("bash",["-c",process.env.UPLOAD],{stdio:"inherit"})}catch(e){console.log("Zwischen-Upload fehlgeschlagen")}}
}
save();
console.log(`fertig: ${idx.keys.length} Gebiete, ${(total/1e6).toFixed(1)} MB, ${fails} Fehler`);
console.log(`::notice title=Fertig::${idx.keys.length} Gebiete, ${(total/1e6).toFixed(1)} MB, ${fails} Fehler`);
await browser.close(); srv.close();
