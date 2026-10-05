const puppeteer=require('puppeteer'); const fs=require('fs');
const MOCK=fs.readFileSync('mock/supabase-fake.js','utf8');
const B='http://127.0.0.1:8099';
const CFG='assets/js/config.js', ORIG=fs.readFileSync(CFG,'utf8');
process.on('exit',()=>{ try{ fs.writeFileSync(CFG,ORIG); }catch(e){} });
let pass=0,fail=0;
const ok=(c,l,x)=>{if(c){pass++;console.log('  OK   '+l);}else{fail++;console.log('  FALHA '+l+(x!==undefined?' -> '+x:''));}};
(async()=>{
const br=await puppeteer.launch({args:['--no-sandbox']});
const p=await br.newPage();
const viol=[], errs=[];
p.on('console',m=>{const t=m.text(); if(/Content Security Policy|Refused to/i.test(t)) viol.push(t.slice(0,150));});
p.on('pageerror',e=>errs.push(e.message.slice(0,110)));

console.log('=== CSP: APP ===');
await p.goto(B+'/index.html',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,2500));
ok(await p.evaluate(()=>document.querySelector('#main')?.innerHTML.length>500),'app renderiza sob CSP');
ok(await p.evaluate(()=>typeof Tema==='object' && typeof Stories==='object'),'scripts embutidos executam');
ok(await p.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('Inter')),'fonte externa carrega');
await p.evaluate(()=>Tema.definir('dark')); await new Promise(r=>setTimeout(r,300));
ok(await p.evaluate(()=>getComputedStyle(document.body).backgroundColor)==='rgb(15, 23, 32)','tema escuro aplica');
await p.evaluate(()=>document.querySelector('#storiesStrip .story').click());
await new Promise(r=>setTimeout(r,600));
ok(await p.$('.stv')!==null,'stories abrem');
await p.keyboard.press('Escape');

console.log('\n=== CSP: LOGIN + SDK ===');
/* agora sim com credenciais, para o SDK ser buscado de verdade */
fs.writeFileSync(CFG, ORIG.replace("'COLE_AQUI_SUA_PROJECT_URL'","'https://demo.supabase.co'")
                          .replace("'COLE_AQUI_SUA_ANON_KEY'","'chave-de-teste'"));
const p2=await br.newPage();
await p2.setRequestInterception(true);
p2.on('request',r=>{ r.url().includes('esm.sh')
  ? r.respond({status:200,contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:MOCK})
  : r.continue(); });
p2.on('console',m=>{const t=m.text(); if(/Content Security Policy|Refused to/i.test(t)) viol.push('[login] '+t.slice(0,150));});
await p2.goto(B+'/login.html',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1500));
ok(await p2.$('#telaLogin')!==null,'login renderiza sob CSP');
ok(await p2.evaluate(()=>typeof window.__mockDb)==='object','modulo do SDK carrega (esm.sh liberado)');

console.log('\n=== VIOLACOES ===');
ok(viol.length===0,'nenhuma violacao de CSP', viol.slice(0,3).join('\n        '));
ok(errs.length===0,'nenhum erro de JS', errs.slice(0,2).join(' | '));
console.log('\n'+pass+' passaram, '+fail+' falharam');
await br.close(); process.exit(fail?1:0);
})();
