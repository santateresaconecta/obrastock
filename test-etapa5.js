/* Etapa 5 — modo escuro e stories de saldo baixo/zerado. */
const puppeteer = require('puppeteer');
const B = 'http://127.0.0.1:8080';
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  OK   ' + l); }
  else { fail++; console.log('  FALHA ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });
  const p = await browser.newPage();
  await p.setViewport({ width:1280, height:900 });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message.slice(0, 110)));
  await p.goto(B + '/index.html', { waitUntil:'networkidle2' });
  await esperar(2000);

  console.log('=== A. MODO ESCURO ===');
  ok(await p.evaluate(() => typeof Tema === 'object'), 'modulo Tema existe');
  await p.evaluate(() => Tema.definir('dark'));
  await esperar(350);
  let r = await p.evaluate(() => ({
    attr: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    texto: getComputedStyle(document.body).color,
    meta: document.querySelector('meta[name="theme-color"]').content,
    card: getComputedStyle(document.querySelector('.card')).backgroundColor,
    icone: document.querySelector('#btnTemaTop i').className
  }));
  ok(r.attr === 'dark', 'atributo data-theme aplicado', r.attr);
  ok(r.bodyBg === 'rgb(15, 23, 32)', 'fundo escuro de fato', r.bodyBg);
  ok(r.texto === 'rgb(231, 238, 247)', 'texto claro de fato', r.texto);
  ok(r.meta === '#0b1623', 'barra do navegador acompanha', r.meta);
  ok(r.card === 'rgb(22, 32, 44)', 'card usa a superficie escura', r.card);
  ok(/fa-sun/.test(r.icone), 'icone do botao vira sol', r.icone);

  // contraste do texto principal sobre o fundo (WCAG)
  const contraste = await p.evaluate(() => {
    const lum = c => { const [r,g,b] = c.match(/\d+/g).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
      return 0.2126*r + 0.7152*g + 0.0722*b; };
    const a = lum(getComputedStyle(document.body).color);
    const b = lum(getComputedStyle(document.body).backgroundColor);
    return Math.round(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)) * 10) / 10;
  });
  ok(contraste >= 4.5, 'contraste do texto atende AA (>=4.5)', contraste + ':1');

  await p.evaluate(() => Tema.definir('light'));
  await esperar(300);
  ok(await p.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(246, 248, 251)',
     'volta para o claro');

  await p.evaluate(() => Tema.alternar());
  await esperar(300);
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'botao alterna');
  ok(await p.evaluate(() => localStorage.getItem('obrastock:tema')) === 'dark', 'preferencia salva');

  // sem piscar branco ao recarregar: o tema já vale antes de pintar
  await p.reload({ waitUntil:'domcontentloaded' });
  const naHora = await p.evaluate(() => document.documentElement.dataset.theme);
  ok(naHora === 'dark', 'tema aplicado antes da primeira pintura', naHora);
  await esperar(1800);

  console.log('\n=== B. OPCOES NAS CONFIGURACOES ===');
  await p.evaluate(() => App.go('config'));
  await esperar(700);
  const ops = await p.evaluate(() => $$('.tema-op').map(b => b.dataset.tema));
  ok(ops.length === 3 && ops.join(',') === 'light,dark,auto', 'tres opcoes de tema', ops.join(','));
  ok(await p.evaluate(() => document.querySelector('.tema-op.on').dataset.tema) === 'dark',
     'opcao atual marcada');
  await p.evaluate(() => $$('.tema-op').find(b => b.dataset.tema === 'light').click());
  await esperar(300);
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'light',
     'clicar na opcao muda o tema');
  await p.screenshot({ path:'pv/tema-config.png' });
  await p.evaluate(() => Tema.definir('dark'));

  console.log('\n=== C. FAIXA DE STORIES ===');
  await p.evaluate(() => App.go('dashboard'));
  await esperar(800);
  const qtd = await p.evaluate(() => document.querySelectorAll('#storiesStrip .story').length);
  const alertas = await p.evaluate(() => Stock.alertas().length);
  ok(qtd > 0, 'faixa de stories renderizada', qtd);
  ok(qtd === alertas, 'um story por material em alerta', qtd + ' de ' + alertas);

  const ordem = await p.evaluate(() => Stories.itens().map(i => i.status));
  const pesos = { zerado:0, critico:1, baixo:2 };
  ok(ordem.every((s, i) => i === 0 || pesos[ordem[i-1]] <= pesos[s]),
     'ordenado por urgencia: zerado > critico > baixo', ordem.slice(0, 6).join(' '));

  const anel = await p.evaluate(() => {
    const z = Stories.itens().findIndex(i => i.status === 'zerado');
    const b = Stories.itens().findIndex(i => i.status === 'baixo');
    const el = document.querySelectorAll('#storiesStrip .story');
    return { zero: el[z]?.className, baixo: el[b]?.className };
  });
  ok(!/baixo/.test(anel.zero || 'x'), 'zerado usa o anel vermelho', anel.zero);
  ok(/baixo/.test(anel.baixo || ''), 'estoque baixo usa o anel ambar', anel.baixo);
  await p.screenshot({ path:'pv/stories-faixa.png' });

  console.log('\n=== D. VISUALIZADOR ===');
  await p.evaluate(() => document.querySelector('#storiesStrip .story').click());
  await esperar(600);
  ok(await p.$('.stv') !== null, 'abre em tela cheia');
  r = await p.evaluate(() => ({
    barras: document.querySelectorAll('.stv-bar').length,
    total: Stories.lista.length,
    pos: document.querySelector('#stvPos').textContent,
    desc: document.querySelector('.stv-desc').textContent,
    tag: document.querySelector('.stv-tag').textContent,
    nums: $$('.stv-num b').map(e => e.textContent)
  }));
  ok(r.barras === r.total, 'uma barra de progresso por material', r.barras);
  ok(r.pos === '1 de ' + r.total, 'indicador de posicao', r.pos);
  ok(r.desc.length > 3, 'mostra a descricao do material', r.desc);
  ok(/zerado|critico|crítico|baixo/i.test(r.tag), 'mostra a gravidade', r.tag);
  ok(r.nums.length === 3, 'mostra estoque, minimo e quanto comprar', r.nums.join(' | '));
  await p.screenshot({ path:'pv/stories-viewer.png' });

  // a barra do primeiro story precisa estar enchendo
  const l1 = await p.evaluate(() => document.querySelector('.stv-bar i').getBoundingClientRect().width);
  await esperar(1400);
  const l2 = await p.evaluate(() => document.querySelector('.stv-bar i').getBoundingClientRect().width);
  ok(l2 > l1, 'barra avanca sozinha', l1.toFixed(0) + 'px -> ' + l2.toFixed(0) + 'px');

  console.log('\n=== E. NAVEGACAO ===');
  await p.evaluate(() => document.querySelector('#stvNext').click());
  await esperar(400);
  ok(await p.evaluate(() => Stories.i) === 1, 'avanca para o proximo');
  await p.keyboard.press('ArrowRight');
  await esperar(400);
  ok(await p.evaluate(() => Stories.i) === 2, 'seta do teclado avanca');
  await p.keyboard.press('ArrowLeft');
  await esperar(400);
  ok(await p.evaluate(() => Stories.i) === 1, 'seta volta');

  // pausa ao segurar
  const antes = await p.evaluate(() => { Stories.pausar(); return Stories.pausado; });
  const w1 = await p.evaluate(() => document.querySelectorAll('.stv-bar i')[1].getBoundingClientRect().width);
  await esperar(1100);
  const w2 = await p.evaluate(() => document.querySelectorAll('.stv-bar i')[1].getBoundingClientRect().width);
  ok(antes === true && Math.abs(w2 - w1) < 2, 'segurar pausa a barra',
     w1.toFixed(0) + 'px -> ' + w2.toFixed(0) + 'px');
  await p.evaluate(() => Stories.retomar());
  await esperar(900);
  const w3 = await p.evaluate(() => document.querySelectorAll('.stv-bar i')[1].getBoundingClientRect().width);
  ok(w3 > w2, 'soltar continua de onde parou', w2.toFixed(0) + 'px -> ' + w3.toFixed(0) + 'px');

  console.log('\n=== F. ACOES E FECHAMENTO ===');
  ok(await p.$('#stvEntrada') !== null, 'botao de registrar entrada');
  await p.keyboard.press('Escape');
  await esperar(500);
  ok(await p.$('.stv') === null, 'Esc fecha');
  ok(await p.evaluate(() => document.body.style.overflow) === '', 'rolagem da pagina devolvida');

  const vistos = await p.evaluate(() => Object.keys(Stories.vistos()).length);
  ok(vistos >= 3, 'materiais vistos sao lembrados', vistos);
  const temVisto = await p.evaluate(() => document.querySelectorAll('#storiesStrip .story.visto').length);
  ok(temVisto >= 3, 'aneis ja vistos ficam cinza', temVisto);

  // abrir no ultimo e avançar deve fechar
  await p.evaluate(() => Stories.abrir(Stories.itens().length - 1));
  await esperar(400);
  await p.evaluate(() => Stories.ir(1));
  await esperar(400);
  ok(await p.$('.stv') === null, 'passar do ultimo fecha o visualizador');

  console.log('\n=== G. MOBILE ===');
  const m = await browser.newPage();
  await m.setViewport({ width:390, height:844, isMobile:true, hasTouch:true });
  await m.goto(B + '/index.html', { waitUntil:'networkidle2' });
  await esperar(2000);
  await m.evaluate(() => Tema.definir('dark'));
  await esperar(400);
  const semScroll = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(semScroll, 'sem rolagem horizontal na pagina');
  const faixaRola = await m.evaluate(() => {
    const s = document.querySelector('#storiesStrip');
    return s && s.scrollWidth > s.clientWidth;
  });
  ok(faixaRola, 'faixa de stories rola na horizontal');
  await m.screenshot({ path:'pv/stories-mobile.png' });
  await m.evaluate(() => document.querySelector('#storiesStrip .story').click());
  await esperar(600);
  const cobre = await m.evaluate(() => {
    const e = document.querySelector('.stv').getBoundingClientRect();
    return e.width >= window.innerWidth - 1 && e.height >= window.innerHeight - 1;
  });
  ok(cobre, 'visualizador ocupa a tela toda no celular');
  await m.screenshot({ path:'pv/stories-viewer-mobile.png' });

  ok(erros.length === 0, 'sem erros de JavaScript', erros.slice(0, 2).join(' | '));

  console.log('\n===================================');
  console.log(pass + ' passaram, ' + fail + ' falharam');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
