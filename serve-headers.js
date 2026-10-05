/* Servidor que aplica o _headers, como o Cloudflare Pages faz. Só para teste. */
const http=require('http'), fs=require('fs'), path=require('path');
const txt=fs.readFileSync('_headers','utf8');
const regras=[]; let atual=null;
txt.split('\n').forEach(l=>{
  if(!l.trim()||l.trim().startsWith('#')) return;
  if(!/^\s/.test(l)){ atual={padrao:l.trim(),h:{}}; regras.push(atual); }
  else if(atual){ const i=l.indexOf(':'); if(i>0) atual.h[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
});
const casa=(p,pad)=> pad.endsWith('/*') ? p.startsWith(pad.slice(0,-1)) : p===pad;
const TIPO={'.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.xml':'text/xml'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  const f=path.join(process.cwd(),p);
  if(!f.startsWith(process.cwd())||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
  const h={'Content-Type':TIPO[path.extname(f)]||'application/octet-stream'};
  regras.forEach(r=>{ if(casa(p,r.padrao)) Object.assign(h,r.h); });
  res.writeHead(200,h); res.end(fs.readFileSync(f));
}).listen(8099,'127.0.0.1',()=>console.log('headers server :8099'));
