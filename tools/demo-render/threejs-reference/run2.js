const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const srv=http.createServer((q,res)=>{const f=path.join(__dirname,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end()}
res.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(f).pipe(res)}).listen(8766);
const jobs=JSON.parse(process.argv[2]);const frames=+process.argv[3]||0; // frames>0 => only sample N frames (preview)
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});const p=await b.newPage({viewport:{width:960,height:960}});
p.on('pageerror',e=>console.log('err',e.message));p.on('console',m=>{if(m.type()==='error')console.log('c:',m.text())});
await p.goto('http://localhost:8766/model.html');await p.waitForFunction('window.ready',null,{timeout:90000});
for(const j of jobs){const dir='m_'+j.name;fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir);
 let dur,fn;if(j.id){dur=await p.evaluate(id=>window.setup(id),j.id);fn='frameAt'}else{dur=await p.evaluate(j=>window.setupClip(j.clip,j.hi,j.yaw,j.pitch,j.ctr,j.rad),j);fn='clipAt'}
 const N=Math.round(dur*30);const idx=frames?Array.from({length:frames},(_,i)=>Math.floor(i*N/frames)):Array.from({length:N},(_,i)=>i);
 for(const i of idx){const t=fn==='frameAt'?i/N:i/30;const u=await p.evaluate(([fn,t])=>window[fn](t),[fn,t]);fs.writeFileSync(`${dir}/f${String(i).padStart(4,'0')}.png`,Buffer.from(u.split(',')[1],'base64'))}
 console.log(j.name,dur,idx.length)}
await b.close();srv.close()})();
