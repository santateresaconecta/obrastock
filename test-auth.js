/* Testa a etapa 3: login, guarda de rota e modo protótipo. */
const puppeteer = require('puppeteer');
const B = 'http://127.0.0.1:8080';

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  OK   ' + l); }
                          else { fail++; console.log('  FALHA ' + l + (x !== undefined ? ' -> ' + x : '')); } };

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // ===================================================================
  console.log('=== A. LOGIN SEM CREDENCIAIS CONFIGURADAS ===');
  let page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.goto(B + '/login.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  ok(await page.$('#telaLogin') !== null, 'tela de login existe');
  const avisoVisivel = await page.evaluate(() =>
    !document.querySelector('#avisoSistema').classList.contains('oculto'));
  ok(avisoVisivel, 'mostra aviso de sistema nao configurado');
  const txtAviso = await page.$eval('#avisoTitulo', e => e.textContent);
  ok(/nao configurado|não configurado/i.test(txtAviso), 'aviso tem texto correto', txtAviso);
  ok(await page.$eval('#btnEntrar', e => e.disabled), 'botao Entrar desabilitado sem config');
  ok(await page.$eval('#email', e => e.disabled), 'campo e-mail desabilitado');

  // ===================================================================
  console.log('\n=== B. VALIDACAO DE FORMULARIO ===');
  // reabilita para testar a validação do cliente
  await page.evaluate(() => {
    document.querySelector('#btnEntrar').disabled = false;
    document.querySelector('#email').disabled = false;
    document.querySelector('#senha').disabled = false;
  });
  await page.click('#btnEntrar');
  await new Promise(r => setTimeout(r, 300));
  let m = await page.$eval('#msgLogin', e => e.textContent);
  ok(/Preencha/i.test(m), 'exige e-mail e senha', m.trim());

  await page.type('#email', 'nao-e-email');
  await page.type('#senha', '123456');
  await page.click('#btnEntrar');
  await new Promise(r => setTimeout(r, 300));
  m = await page.$eval('#msgLogin', e => e.textContent);
  ok(/válido/i.test(m), 'rejeita e-mail invalido', m.trim());

  // ===================================================================
  console.log('\n=== C. MOSTRAR/OCULTAR SENHA ===');
  ok(await page.$eval('#senha', e => e.type) === 'password', 'senha mascarada por padrao');
  await page.click('#verSenha');
  await new Promise(r => setTimeout(r, 200));
  ok(await page.$eval('#senha', e => e.type) === 'text', 'botao revela a senha');
  await page.click('#verSenha');
  ok(await page.$eval('#senha', e => e.type) === 'password', 'botao oculta de novo');

  // ===================================================================
  console.log('\n=== D. FLUXO DE RECUPERACAO ===');
  await page.click('#irEsqueci');
  await new Promise(r => setTimeout(r, 300));
  ok(await page.evaluate(() => !document.querySelector('#telaEsqueci').classList.contains('oculto')),
     'abre a tela de recuperar senha');
  ok(await page.evaluate(() => document.querySelector('#telaLogin').classList.contains('oculto')),
     'esconde a tela de login');
  const emailHerdado = await page.$eval('#emailRec', e => e.value);
  ok(emailHerdado === 'nao-e-email', 'leva o e-mail digitado para a recuperacao', emailHerdado);
  await page.click('#voltarLogin');
  await new Promise(r => setTimeout(r, 300));
  ok(await page.evaluate(() => !document.querySelector('#telaLogin').classList.contains('oculto')),
     'volta para o login');

  // ===================================================================
  console.log('\n=== E. MODO ESCURO NO LOGIN ===');
  const temaInicial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btnTema');
  await new Promise(r => setTimeout(r, 300));
  const temaDepois = await page.evaluate(() => document.documentElement.dataset.theme);
  ok(temaInicial !== temaDepois, 'alterna o tema', temaInicial + ' -> ' + temaDepois);
  const salvo = await page.evaluate(() => localStorage.getItem('obrastock:tema'));
  ok(salvo === temaDepois, 'persiste a preferencia', salvo);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(15, 23, 32)', 'fundo escuro aplicado de fato', bg);
  await page.screenshot({ path: 'pv/login-escuro.png' });
  await page.click('#btnTema');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'pv/login-claro.png' });

  // recarrega e confere que não pisca branco
  await page.reload({ waitUntil: 'networkidle2' });
  const temaAposReload = await page.evaluate(() => document.documentElement.dataset.theme);
  ok(temaAposReload === 'light', 'tema persiste apos recarregar', temaAposReload);

  ok(erros.length === 0, 'sem erros de JavaScript no login', erros.slice(0, 2).join(' | '));

  // ===================================================================
  console.log('\n=== F. APP EM MODO PROTOTIPO (sem credenciais) ===');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1280, height: 900 });
  const erros2 = [];
  p2.on('pageerror', e => erros2.push(e.message));
  await p2.goto(B + '/index.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1800));

  ok(p2.url().includes('index.html'), 'NAO redireciona para login sem credenciais', p2.url());
  const visivel = await p2.evaluate(() => getComputedStyle(document.documentElement).visibility);
  ok(visivel === 'visible', 'tela liberada (nao ficou invisivel)', visivel);
  const temFaixa = await p2.evaluate(() =>
    [...document.querySelectorAll('div')].some(d => /Modo protótipo/.test(d.textContent) && d.style.position === 'fixed'));
  ok(temFaixa, 'faixa de modo prototipo aparece');
  const temApp = await p2.evaluate(() => document.querySelector('#main')?.innerHTML.length > 500);
  ok(temApp, 'aplicacao continua funcionando normalmente');
  await p2.screenshot({ path: 'pv/app-prototipo.png' });
  ok(erros2.filter(e => !/manifest|sw\.js/i.test(e)).length === 0, 'sem erros de JS no app',
     erros2.slice(0, 2).join(' | '));

  // ===================================================================
  console.log('\n=== G. GUARDA ATIVA COM CREDENCIAIS PREENCHIDAS ===');
  // simula config.js preenchido interceptando o módulo
  // SW de carregamentos anteriores serviria config.js do cache e furaria a
  // interceptacao; usamos um contexto limpo para isolar.
  const ctx3 = await browser.createBrowserContext();
  const p3 = await ctx3.newPage();
  await p3.setCacheEnabled(false);
  await p3.setRequestInterception(true);
  p3.on('request', req => {
    if (req.url().endsWith('/assets/js/config.js')){
      req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: `
          export const SUPABASE_URL='https://demo.supabase.co';
          export const SUPABASE_ANON='chave-de-teste';
          export const APP_NOME='ObraStock'; export const APP_DESC='Gestão de Estoque';
          export const APP_VERSAO='v2.0.0';
          export const ROTA_APP='index.html'; export const ROTA_LOGIN='login.html';
          export const CONFIGURADO=true;`
      });
    } else if (req.url().includes('esm.sh')){
      req.abort();                       // simula CDN inacessível
    } else req.continue();
  });
  await p3.goto(B + '/index.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  ok(p3.url().includes('login.html'), 'app protegido redireciona para o login', p3.url());

  const ctx4 = await browser.createBrowserContext();
  const p4 = await ctx4.newPage();
  await p4.setCacheEnabled(false);
  await p4.setRequestInterception(true);
  p4.on('request', req => {
    if (req.url().endsWith('/assets/js/config.js')){
      req.respond({ status:200, contentType:'application/javascript', body:`
        export const SUPABASE_URL='https://demo.supabase.co';
        export const SUPABASE_ANON='chave-de-teste';
        export const APP_NOME='ObraStock'; export const APP_DESC='Gestão';
        export const APP_VERSAO='v2.0.0';
        export const ROTA_APP='index.html'; export const ROTA_LOGIN='login.html';
        export const CONFIGURADO=true;` });
    } else if (req.url().includes('esm.sh')){ req.abort(); }
    else req.continue();
  });
  await p4.goto(B + '/login.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  const avisoRede = await p4.evaluate(() => ({
    visivel: !document.querySelector('#avisoSistema').classList.contains('oculto'),
    titulo: document.querySelector('#avisoTitulo').textContent
  }));
  ok(avisoRede.visivel, 'login avisa quando o SDK nao carrega');
  ok(/nao foi possivel|não foi possível/i.test(avisoRede.titulo), 'mensagem de rede correta', avisoRede.titulo);
  await p4.screenshot({ path: 'pv/login-sem-rede.png' });

  // ===================================================================
  console.log('\n=== H. MOBILE ===');
  const p5 = await browser.newPage();
  await p5.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await p5.goto(B + '/login.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 900));
  const transborda = await p5.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!transborda, 'sem rolagem horizontal no celular');
  const altBtn = await p5.$eval('#btnEntrar', e => e.getBoundingClientRect().height);
  ok(altBtn >= 44, 'botao com area de toque adequada', altBtn + 'px');
  await p5.screenshot({ path: 'pv/login-mobile.png' });

  console.log('\n===================================');
  console.log(pass + ' passaram, ' + fail + ' falharam');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
