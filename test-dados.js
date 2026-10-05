/* Etapa 4 — valida a camada de dados contra um Supabase falso em memória. */
const puppeteer = require('puppeteer');
const fs = require('fs');
const MOCK = fs.readFileSync('mock/supabase-fake.js', 'utf8');
const B = 'http://127.0.0.1:8080';
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  OK   ' + l); }
  else { fail++; console.log('  FALHA ' + l + (x !== undefined ? ' -> ' + x : '')); } };

/* Em vez de interceptar config.js (o navegador reaproveitava o módulo entre
   as duas páginas), escrevemos credenciais de teste no arquivo real e
   restauramos no fim. Mais perto do que acontece em produção. */
const CFG_PATH = 'assets/js/config.js';
const CFG_ORIG = fs.readFileSync(CFG_PATH, 'utf8');
fs.writeFileSync(CFG_PATH, CFG_ORIG
  .replace("'COLE_AQUI_SUA_PROJECT_URL'", "'https://demo.supabase.co'")
  .replace("'COLE_AQUI_SUA_ANON_KEY'", "'chave-de-teste'"));
const restaurar = () => { try { fs.writeFileSync(CFG_PATH, CFG_ORIG); } catch(e){} };
process.on('exit', restaurar);
process.on('SIGINT', () => { restaurar(); process.exit(1); });

async function novaPagina(browser){
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setCacheEnabled(false);
  await p.setRequestInterception(true);
  p.on('request', req => {
    const u = req.url();
    if (u.endsWith('/sw.js'))                            // SW serviria do cache
      req.respond({ status:404, contentType:'text/plain', body:'' });
    else if (u.includes('esm.sh'))                       // SDK real -> o falso
      req.respond({ status:200, contentType:'application/javascript', headers:{'Access-Control-Allow-Origin':'*'}, body: MOCK });
    else req.continue();
  });
  p.on('pageerror', e => console.log('    [pageerror] ' + e.message.slice(0, 110)));
  return p;
}

(async () => {
  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });

  console.log('=== A. LOGIN REAL ===');
  const p = await novaPagina(browser);
  await p.goto(B + '/login.html', { waitUntil:'networkidle2' });
  await new Promise(r => setTimeout(r, 900));
  ok(!(await p.$eval('#btnEntrar', e => e.disabled)), 'formulario habilitado com credenciais');

  await p.type('#email', 'ana@teste.com');
  await p.type('#senha', 'errada');
  await p.click('#btnEntrar');
  await new Promise(r => setTimeout(r, 700));
  let m = await p.$eval('#msgLogin', e => e.textContent.trim());
  ok(/incorret|inválid/i.test(m), 'senha errada: mensagem traduzida', m);
  ok(!/email|e-mail não/i.test(m) || !/não cadastrado/i.test(m),
     'nao revela se o e-mail existe', m);

  await p.$eval('#senha', e => e.value = '');
  await p.type('#senha', 'senha123');
  await p.click('#btnEntrar');
  await p.waitForNavigation({ waitUntil:'networkidle2', timeout:15000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 2500));
  ok(p.url().includes('index.html'), 'login correto entra no sistema', p.url());

  console.log('\n=== B. DADOS VINDOS DO BANCO ===');
  const vis = await p.evaluate(() => getComputedStyle(document.documentElement).visibility);
  ok(vis === 'visible', 'tela liberada apos carregar dados', vis);
  const nome = await p.$eval('#sbUser', e => e.textContent.trim());
  ok(nome === 'Ana Souza', 'nome do perfil real na barra lateral', nome);
  const cargo = await p.$eval('#sbVersion', e => e.textContent.trim());
  ok(/Administrador/i.test(cargo), 'papel exibido', cargo);
  ok(await p.$('#btnSair') !== null, 'botao Sair presente');

  const mats = await p.evaluate(() => DB.materiais.all().length);
  ok(mats === 1, 'materiais vieram do banco (1), nao o seed de 42', mats);
  const desc = await p.evaluate(() => DB.materiais.all()[0].descricao);
  ok(desc === 'Cimento CP-II 50kg', 'conversao snake->camel correta', desc);
  const cfg = await p.evaluate(() => DB.config.get().empresa);
  ok(cfg === 'Construtora Teste Ltda', 'config veio da tabela empresas', cfg);
  const semSeed = await p.evaluate(() => DB.obras.all().length);
  ok(semSeed === 1, 'nao semeou obras ficticias por cima', semSeed);

  console.log('\n=== C. ESCRITA: ENTRADA ===');
  let r = await p.evaluate(async () => {
    Mov.criar({ tipo:'entrada', materialId:'m1', materialDesc:'Cimento CP-II 50kg',
                unidade:'SC', quantidade:100, valorUnitario:40, obraId:null });
    await new Promise(r => setTimeout(r, 400));
    return { saldo: Stock.saldo('m1'), linhas: __mockDb.movimentacoes.length,
             col: Object.keys(__mockDb.movimentacoes[0]||{}).join(',') };
  });
  ok(r.saldo === 100, 'saldo local = 100 apos entrada', r.saldo);
  ok(r.linhas === 1, 'gravou 1 linha no banco', r.linhas);
  ok(/material_id/.test(r.col) && !/materialId/.test(r.col),
     'enviou colunas em snake_case', r.col.slice(0, 70));
  const vt = await p.evaluate(() => __mockDb.movimentacoes[0].valor_total);
  ok(Number(vt) === 4000, 'valor_total calculado pelo banco voltou', vt);

  console.log('\n=== D. ESCRITA: SAIDA E REGRA DE SALDO ===');
  r = await p.evaluate(async () => {
    Mov.criar({ tipo:'saida', materialId:'m1', materialDesc:'Cimento CP-II 50kg',
                unidade:'SC', quantidade:30, valorUnitario:40, obraId:'o1', destino:'Residencial Colina' });
    await new Promise(r => setTimeout(r, 400));
    return { saldo: Stock.saldo('m1'), linhas: __mockDb.movimentacoes.length };
  });
  ok(r.saldo === 70, 'saldo = 70 apos saida de 30', r.saldo);
  ok(r.linhas === 2, 'saida gravada', r.linhas);

  // saída acima do saldo: o banco recusa (P0001) e o espelho precisa voltar
  r = await p.evaluate(async () => {
    Mov.criar({ tipo:'saida', materialId:'m1', materialDesc:'Cimento CP-II 50kg',
                unidade:'SC', quantidade:9999, valorUnitario:40, obraId:'o1' });
    const logo = Stock.saldo('m1');
    await new Promise(r => setTimeout(r, 600));
    return { logo, depois: Stock.saldo('m1'), linhas: __mockDb.movimentacoes.length,
             toast: document.querySelector('.toasts')?.textContent || '' };
  });
  ok(r.depois === 70, 'ROLLBACK: saldo volta a 70 quando o banco recusa', r.depois);
  ok(r.linhas === 2, 'nada foi gravado no banco', r.linhas);
  ok(/insuficiente|Disponível/i.test(r.toast), 'usuario avisado da recusa', r.toast.trim().slice(0, 70));

  console.log('\n=== E. ENTREGA DIRETA NAO SOMA AO GALPAO ===');
  r = await p.evaluate(async () => {
    Mov.criar({ tipo:'entrada_direta', materialId:'m1', materialDesc:'Cimento CP-II 50kg',
                unidade:'SC', quantidade:500, valorUnitario:40, obraId:'o1' });
    await new Promise(r => setTimeout(r, 400));
    return { saldo: Stock.saldo('m1'), direto: Stock.diretos()['m1'] || 0 };
  });
  ok(r.saldo === 70, 'galpao continua 70 apos entrega direta de 500', r.saldo);
  ok(r.direto === 500, 'registrada como entrega direta', r.direto);

  console.log('\n=== F. DEVOLUCAO ACIMA DO ENVIADO ===');
  r = await p.evaluate(async () => {
    Mov.criar({ tipo:'devolucao', materialId:'m1', materialDesc:'Cimento CP-II 50kg',
                unidade:'SC', quantidade:999, valorUnitario:40, obraId:'o1' });
    await new Promise(r => setTimeout(r, 600));
    return { saldo: Stock.saldo('m1'), toast: document.querySelector('.toasts')?.textContent || '' };
  });
  ok(r.saldo === 70, 'devolucao impossivel revertida', r.saldo);
  ok(/obra/i.test(r.toast), 'mensagem explica o limite da obra', r.toast.trim().slice(-60));

  console.log('\n=== G. CADASTRO E EDICAO ===');
  r = await p.evaluate(async () => {
    DB.materiais.add({ codigo:'MAT-900', descricao:'Areia média', categoria:'Elétrica',
                       unidade:'M3', estoqueMinimo:5, estoqueIdeal:20, custoMedio:0, ativo:true });
    await new Promise(r => setTimeout(r, 400));
    const novo = __mockDb.materiais.find(x => x.codigo === 'MAT-900');
    return { existe: !!novo, id: novo?.id, emp: novo?.empresa_id,
             minimo: novo?.estoque_minimo, total: DB.materiais.all().length };
  });
  ok(r.existe, 'material novo chegou ao banco');
  ok(/^[0-9a-f-]{36}$/.test(r.id || ''), 'id uuid gerado no cliente', r.id);
  ok(r.emp === '11111111-1111-4111-8111-111111111111', 'empresa_id preenchido sozinho', r.emp);
  ok(Number(r.minimo) === 5, 'estoqueMinimo -> estoque_minimo', r.minimo);

  r = await p.evaluate(async () => {
    const mt = DB.materiais.all().find(x => x.codigo === 'MAT-900');
    DB.materiais.upd(mt.id, { estoqueMinimo: 12 });
    await new Promise(r => setTimeout(r, 400));
    return Number(__mockDb.materiais.find(x => x.codigo === 'MAT-900').estoque_minimo);
  });
  ok(r === 12, 'edicao persistida no banco', r);

  console.log('\n=== H. ROLLBACK DE EDICAO ===');
  r = await p.evaluate(async () => {
    const mt = DB.materiais.all().find(x => x.codigo === 'MAT-900');
    __mockFalhar('falha simulada de rede');
    DB.materiais.upd(mt.id, { descricao: 'NAO DEVE FICAR' });
    await new Promise(r => setTimeout(r, 600));
    return DB.materiais.get(mt.id).descricao;
  });
  ok(r === 'Areia média', 'edicao recusada volta ao valor anterior', r);

  console.log('\n=== I. CONFIGURACOES -> empresas + perfis ===');
  r = await p.evaluate(async () => {
    DB.config.set({ empresa:'Nova Razao Ltda', galpao:'Galpão Norte', usuario:'Ana S. Lima' });
    await new Promise(r => setTimeout(r, 500));
    return { nome: __mockDb.empresas[0].nome, galpao: __mockDb.empresas[0].galpao,
             perfil: __mockDb.perfis[0].nome };
  });
  ok(r.nome === 'Nova Razao Ltda', 'razao social gravada em empresas', r.nome);
  ok(r.galpao === 'Galpão Norte', 'galpao gravado em empresas', r.galpao);
  ok(r.perfil === 'Ana S. Lima', 'nome do usuario gravado em perfis', r.perfil);

  console.log('\n=== J. PERSISTENCIA APOS RECARREGAR ===');
  await p.reload({ waitUntil:'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  r = await p.evaluate(() => ({ saldo: Stock.saldo('m1'), mats: DB.materiais.all().length,
                                emp: DB.config.get().empresa }));
  ok(r.saldo === 70, 'saldo recarregado do banco', r.saldo);
  ok(r.mats === 2, 'materiais recarregados', r.mats);
  ok(r.emp === 'Nova Razao Ltda', 'config recarregada', r.emp);
  await p.screenshot({ path:'pv/app-supabase.png' });

  console.log('\n=== K. TEMA SINCRONIZADO COM O PERFIL ===');
  r = await p.evaluate(async () => {
    Tema.definir('dark');
    await new Promise(r => setTimeout(r, 500));
    return { perfil: __mockDb.perfis[0].tema, html: document.documentElement.dataset.theme };
  });
  ok(r.html === 'dark', 'tema aplicado na tela', r.html);
  ok(r.perfil === 'dark', 'tema gravado em perfis.tema', r.perfil);

  console.log('\n=== L. SAIR ===');
  await p.evaluate(() => document.querySelector('#btnSair').click());
  await new Promise(r => setTimeout(r, 600));
  const temModal = await p.evaluate(() => /Sair do sistema/i.test(document.body.textContent));
  ok(temModal, 'pede confirmacao antes de sair');

  console.log('\n===================================');
  console.log(pass + ' passaram, ' + fail + ' falharam');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
