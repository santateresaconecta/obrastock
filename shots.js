const puppeteer=require('puppeteer');
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox']});
  const p=await b.newPage();
  // A4 a 96dpi = 794x1123
  await p.setViewport({width:794,height:1123,deviceScaleFactor:1.4});
  await p.goto('file:///home/user/proposta/proposta.html',{waitUntil:'networkidle0'});
  await p.emulateMediaType('print');
  await new Promise(r=>setTimeout(r,500));
  const h=await p.evaluate(()=>document.body.scrollHeight);
  const pages=Math.ceil(h/1123);
  console.log('altura total:',h,'~páginas:',pages);
  for(let i=0;i<pages;i++){
    await p.evaluate(y=>window.scrollTo(0,y), i*1123);
    await new Promise(r=>setTimeout(r,200));
    await p.screenshot({path:`/home/user/pv/p${String(i+1).padStart(2,'0')}.png`});
  }
  await b.close();
})();
