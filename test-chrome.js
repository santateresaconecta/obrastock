/* Teste no Chrome real: valida o fluxo de devolução clicando de verdade na interface. */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  await page.goto('file:///home/user/index.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));

  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  OK   ' + l); } else { fail++; console.log('  FALHA ' + l + (x !== undefined ? ' -> ' + x : '')); } };

  // ---- reabertura do modal (o caso que o jsdom acusou) ----
  console.log('=== REABERTURA DE MODAL NO CHROME ===');
  let r = await page.evaluate(() => {
    const obra = DB.obras.all()[0];
    try {
      Forms.novaDevolucao(); Modal.close();
      Forms.novaDevolucao({ obraId: obra.id });
      const ov = Modal.stack[Modal.stack.length - 1];
      const achou = !!ov.querySelector('#dvCart');
      Modal.closeAll();
      return { ok: true, achou };
    } catch (e) { return { ok: false, msg: e.message }; }
  });
  ok(r.ok, 'abrir -> fechar -> reabrir sem erro', r.msg);
  ok(r.achou, 'elementos do formulario acessiveis apos reabrir');

  // ---- fluxo completo pela interface ----
  console.log('\n=== FLUXO REAL: 3 SACOS SAEM, 1 VOLTA ===');
  const setup = await page.evaluate(() => {
    localStorage.clear(); location.reload();
  });
  await new Promise(r2 => setTimeout(r2, 1200));

  const cenario = await page.evaluate(() => {
    /* obra 'planejada' nao recebeu nada no seed -> cenario limpo */
    const obra = DB.obras.all().find(o => o.status === 'planejada');
    const mat = DB.materiais.all().find(m => /cimento/i.test(m.descricao));
    const antes = Stock.saldo(mat.id);
    Mov.criar({ tipo: 'saida', data: todayISO(), materialId: mat.id, materialDesc: mat.descricao,
      unidade: mat.unidade, quantidade: 3, valorUnitario: 40, valorTotal: 120, obraId: obra.id,
      origem: 'Galpão', destino: obra.nome, responsavel: 'T', observacao: 'x' });
    return { obraId: obra.id, matId: mat.id, obraNome: obra.nome, desc: mat.descricao,
             antes, aposSaida: Stock.saldo(mat.id) };
  });
  ok(cenario.aposSaida === cenario.antes - 3, 'saida de 3 registrada', cenario.aposSaida);

  // abre o form pela UI e devolve 1
  await page.evaluate(o => Forms.novaDevolucao({ obraId: o }), cenario.obraId);
  await new Promise(r2 => setTimeout(r2, 350));
  ok(await page.$('#dvCart') !== null, 'modal de devolucao montado na tela');

  // seleciona material via botão "Adicionar material"
  await page.click('#dvAdd');
  await new Promise(r2 => setTimeout(r2, 350));
  const temPicker = await page.evaluate(() => document.querySelectorAll('[data-p]').length);
  ok(temPicker > 0, 'lista de materiais devolviveis aparece', temPicker);

  await page.evaluate(m => { const el = document.querySelector('[data-p="' + m + '"]'); el && el.click(); }, cenario.matId);
  await new Promise(r2 => setTimeout(r2, 350));

  // ajusta quantidade para 1 e tenta salvar sem motivo
  await page.evaluate(() => {
    const i = document.querySelector('[data-q="0"]');
    i.value = '1'; i.dispatchEvent(new Event('change'));
  });
  await new Promise(r2 => setTimeout(r2, 250));
  await page.click('#dvSalvar');
  await new Promise(r2 => setTimeout(r2, 300));
  const bloqueou = await page.evaluate(() => Modal.stack.length > 0);
  ok(bloqueou, 'bloqueia salvar sem informar o motivo');

  // preenche motivo e salva
  await page.type('#dvObs', 'Sobra da concretagem');
  await page.click('#dvSalvar');
  await new Promise(r2 => setTimeout(r2, 500));

  const fim = await page.evaluate(c => ({
    saldo: Stock.saldo(c.matId),
    pend: (Mov.pendentesObra(c.obraId).find(x => x.materialId === c.matId) || {}).pendente || 0,
    devs: DB.movimentacoes.all().filter(m => m.tipo === 'devolucao').length,
    fechou: Modal.stack.length === 0
  }), cenario);

  ok(fim.fechou, 'modal fecha apos confirmar');
  ok(fim.devs === 1, 'movimentacao de devolucao gravada', fim.devs);
  ok(fim.saldo === cenario.antes - 2, 'galpao recomposto: -3 +1 = -2', fim.saldo + ' (esperado ' + (cenario.antes - 2) + ')');
  ok(fim.pend === 2, 'restam 2 pendentes na obra', fim.pend);

  // ---- tentativa de devolver mais do que foi enviado ----
  console.log('\n=== TRAVA DE EXCESSO ===');
  const excesso = await page.evaluate(c => {
    const v = Mov.validarDevolucao(c.obraId, c.matId, 99);
    return { ok: v.ok, msg: v.msg };
  }, cenario);
  ok(!excesso.ok, 'recusa devolver 99 de 2 pendentes', excesso.msg);

  // ---- navegação por todas as telas ----
  console.log('\n=== TELAS APOS DEVOLUÇÃO ===');
  for (const v of ['dashboard', 'estoque', 'movimentacoes', 'obras', 'materiais', 'fornecedores', 'notas', 'relatorios', 'config']) {
    await page.evaluate(x => App.go(x), v);
    await new Promise(r2 => setTimeout(r2, 220));
    const vazio = await page.evaluate(() => document.querySelector('#main').innerHTML.length);
    ok(vazio > 200, 'tela ' + v + ' renderiza', vazio);
  }

  // filtro por tipo devolução
  const filtro = await page.evaluate(() => {
    App.go('movimentacoes');
    App.state.movFiltros.tipo = 'devolucao';
    App.state.movFiltros.periodo = '';
    renderMovs();
    return document.querySelector('#movLista').innerHTML.includes('Devolução');
  });
  ok(filtro, 'filtro por tipo Devolucao lista o registro');

  console.log('\n=== ERROS DE JAVASCRIPT ===');
  ok(erros.length === 0, 'nenhum erro no console', erros.slice(0, 3).join(' | '));

  console.log('\n===================================');
  console.log(pass + ' passaram, ' + fail + ' falharam');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
