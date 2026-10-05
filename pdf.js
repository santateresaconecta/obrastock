const puppeteer=require('puppeteer');
const pymupdfNote='concat feito no python';
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file:///home/user/proposta/proposta.html',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,600));

  const footer=`<div style="width:100%;font-size:7.5pt;color:#94a3b8;
      font-family:Helvetica,Arial,sans-serif;padding:0 15mm 8mm;display:flex;
      justify-content:space-between;border-top:1px solid #e2e8f0;padding-top:4px">
      <span>ObraStock — Proposta Comercial 001/2026</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>`;

  // 1) capa sem rodapé
  await p.pdf({path:'/home/user/_capa.pdf',format:'A4',printBackground:true,
    preferCSSPageSize:true,pageRanges:'1',margin:{top:'0',bottom:'0',left:'0',right:'0'}});

  // 2) miolo com rodapé
  await p.pdf({path:'/home/user/_miolo.pdf',format:'A4',printBackground:true,
    preferCSSPageSize:true,pageRanges:'2-',displayHeaderFooter:true,
    headerTemplate:'<div></div>',footerTemplate:footer,
    margin:{top:'0',bottom:'14mm',left:'0',right:'0'}});

  console.log(errs.length?('ERROS: '+errs.join(' | ')):'partes geradas sem erros');
  await b.close();
})();
