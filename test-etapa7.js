/* =============================================================================
   ObraStock — suíte da etapa 7
   Acesso de desenvolvedor, gestão de usuários e cobrança.

   Rodar:  node test-etapa7.js
============================================================================= */

const fs = require('fs');
const path = require('path');

let ok = 0, falhas = [];
const T = (grupo, nome, cond, detalhe) => {
  if (cond) { ok++; console.log('  \x1b[32m✓\x1b[0m ' + nome); }
  else { falhas.push(grupo + ' · ' + nome + (detalhe ? ' → ' + detalhe : ''));
         console.log('  \x1b[31m✗\x1b[0m ' + nome + (detalhe ? '  \x1b[2m' + detalhe + '\x1b[0m' : '')); }
};
const grupo = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

const ler = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html   = ler('index.html');
const sql    = ler('supabase/dev-e-cobranca.sql');
const edge   = ler('supabase/functions/admin-usuarios/index.ts');
const gestao = ler('assets/js/gestao.js');
const config = ler('assets/js/config.js');
const guard  = ler('assets/js/guard.js');
const mock   = ler('mock/supabase-fake.js');

/* Remove comentários: uma palavra citada numa explicação não é código. */
const semComentarios = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const gestaoCodigo = semComentarios(gestao);

/* ---------------------------------------------------------------- A. BANCO */
grupo('A. Migração SQL');
T('A', 'tabela desenvolvedores existe',        /create table if not exists desenvolvedores/i.test(sql));
T('A', 'tabela contratos existe',              /create table if not exists contratos/i.test(sql));
T('A', 'tabela cobrancas existe',              /create table if not exists cobrancas/i.test(sql));
T('A', 'fn_eh_dev é security definer',         /create or replace function fn_eh_dev[\s\S]{0,400}?security definer/i.test(sql));
T('A', 'um contrato por empresa',              /empresa_id[\s\S]{0,120}?unique/i.test(sql) || /unique\s*\(\s*empresa_id\s*\)/i.test(sql));
T('A', 'cobrança única por competência',       /unique\s*\(\s*empresa_id\s*,\s*competencia\s*\)/i.test(sql));
T('A', 'valor mensal padrão 350',              /valor_mensal[^\n]*default\s*350/i.test(sql));
T('A', 'vencimento padrão dia 10',             /dia_vencimento[^\n]*default\s*10/i.test(sql));
T('A', 'gatilho tg_protege_perfil criado',     /create trigger tg_protege_perfil/i.test(sql));
T('A', 'gatilho barra troca de papel',         /papel[\s\S]{0,200}?raise exception/i.test(sql));
T('A', 'gatilho barra troca de empresa',       /empresa_id[\s\S]{0,200}?raise exception/i.test(sql));
T('A', 'service_role passa pelo gatilho',      /service_role/.test(sql) && /auth\.uid\(\)\s+is\s+null/i.test(sql));
T('A', 'fn_gerar_cobranca é idempotente',      /on conflict[\s\S]{0,160}?do nothing|do update/i.test(sql));
T('A', 'fn_limpar_empresas_vazias existe',     /create or replace function fn_limpar_empresas_vazias/i.test(sql));
T('A', 'limpeza protegida contra cliente',     /fn_limpar_empresas_vazias[\s\S]{0,900}?raise exception/i.test(sql));
T('A', 'anon não recebe grant',                !/grant[^\n;]*\bto\b[^\n;]*\banon\b/i.test(
        sql.split(/create table if not exists contratos/i)[1] || ''));
T('A', 'script é reexecutável',                (sql.match(/if not exists|or replace|drop .* if exists/gi) || []).length > 10);
T('A', 'dev enxerga todas as empresas',        /sel_empresa on empresas[\s\S]{0,120}?fn_eh_dev\(\)/.test(sql));
T('A', 'cliente segue restrito à própria empresa', /id = fn_empresa_id\(\) or fn_eh_dev\(\)/.test(sql));
T('A', 'avisa se o login do dev não existe',  /ainda não tem login no Auth/.test(sql));
T('A', 'RLS ligada nas três tabelas',          (sql.match(/enable row level security/gi) || []).length >= 3);

/* ----------------------------------------------------------- B. EDGE FN */
grupo('B. Edge Function admin-usuarios');
T('B', 'usa service_role do ambiente',         /SUPABASE_SERVICE_ROLE_KEY/.test(edge));
T('B', 'a chave não está escrita no código',   !/eyJ[A-Za-z0-9_-]{20,}/.test(edge));
T('B', 'exige Authorization',                  /Authorization/.test(edge) && /401/.test(edge));
T('B', 'confere a tabela desenvolvedores',     /from\(['"]desenvolvedores['"]\)/.test(edge));
T('B', 'nega quem não é dev com 403',          /403/.test(edge));
T('B', 'trata CORS / preflight',               /OPTIONS/.test(edge) && /Access-Control-Allow-Origin/.test(edge));
T('B', 'valida o papel recebido',              /\['admin',\s*'estoquista',\s*'visualizador'\]/.test(edge));
T('B', 'cobre as 6 ações',
   ['listar','empresas','criar','atualizar','convite','remover']
     .every(a => new RegExp("case '" + a + "'").test(edge)));
T('B', 'não deixa login órfão se o perfil falhar', /deleteUser[\s\S]{0,120}?throw erroPerfil/.test(edge)
        || /erroPerfil[\s\S]{0,200}?deleteUser/.test(edge));
T('B', 'e-mail duplicado vira 409',            /409/.test(edge));
T('B', 'impede desativar a si mesmo',          /id === user\.id[\s\S]{0,120}?ativo === false/.test(edge));
T('B', 'impede remover a si mesmo',            /id === user\.id[\s\S]{0,120}?remover|não pode remover/i.test(edge));
T('B', 'senha provisória é aleatória',         /crypto\.randomUUID/.test(edge));
T('B', 'envia convite de senha',               /resetPasswordForEmail/.test(edge));
T('B', 'limpa empresa órfã após criar',        /fn_limpar_empresas_vazias/.test(edge));

/* ------------------------------------------------------------- C. CONFIG */
grupo('C. Configuração');
T('C', 'exporta a lista DEVS',                 /export const DEVS/.test(config));
T('C', 'exporta ehDevEmail',                   /export function ehDevEmail/.test(config));
T('C', 'comparação de e-mail ignora caixa',    /toLowerCase\(\)[\s\S]{0,40}toLowerCase\(\)/.test(config));
T('C', 'nome da Edge Function configurado',    /FN_USUARIOS\s*=\s*'admin-usuarios'/.test(config));
T('C', 'placeholders originais preservados',   /COLE_AQUI_/.test(config));
T('C', 'e-mail do dev configurado',            /DEVS = \['[^']+@[^']+\.[a-z]+'\]/.test(config)
                                                && !/SEU-EMAIL@EXEMPLO/.test(config));
T('C', 'mesmo e-mail no banco e na interface',
   (/DEVS = \['([^']+)'\]/.exec(config) || [])[1] ===
   (/values \('([^']+)', 'Desenvolvedor'\)/.exec(sql) || [])[1],
   'config=' + ((/DEVS = \['([^']+)'\]/.exec(config) || [])[1]) +
   ' sql=' + ((/values \('([^']+)', 'Desenvolvedor'\)/.exec(sql) || [])[1]));

/* ------------------------------------------------------------- D. GESTÃO */
grupo('D. assets/js/gestao.js');
T('D', 'service_role não aparece no código',   !/service_role/i.test(gestaoCodigo));
T('D', 'nenhuma chave JWT embutida',           !/eyJ[A-Za-z0-9_-]{20,}/.test(gestao));
T('D', 'chama a Edge Function por invoke',     /functions\.invoke\(FN_USUARIOS/.test(gestao));
T('D', 'extrai o motivo real do erro',         /error\.context/.test(gestao));
T('D', 'Usuarios expõe as 6 ações',
   ['listar','empresas','criar','atualizar','convite','remover'].every(a => new RegExp(a + ':').test(gestao)));
T('D', 'Cobranca lê contrato',                 /from\('contratos'\)/.test(gestao));
T('D', 'Cobranca chama fn_gerar_cobranca',     /fn_gerar_cobranca/.test(gestao));
T('D', 'valorEntregue mede devoluções',        /valorDevolvido/.test(gestao));
T('D', 'valorEntregue mede alertas',           /valorReposicao/.test(gestao));
T('D', 'valorEntregue não quebra sem dados',   /if \(!D \|\| !S\) return null/.test(gestao));
T('D', 'instala a ponte para o index.html',    /window\.ObraStockGestao/.test(gestao));

/* --------------------------------------------------------------- E. HTML */
grupo('E. Telas no index.html');
['contrato','usuarios','cobranca'].forEach(v => {
  T('E', 'Views.' + v + ' existe',             new RegExp('Views\\.' + v + '\\s*=\\s*function').test(html));
  T('E', 'Views.' + v + '_init existe',        new RegExp('Views\\.' + v + '_init').test(html));
});
T('E', 'menu "Meu plano" para o cliente',      /data-nav="contrato"/.test(html));
T('E', 'menus de dev marcados data-requer',    (html.match(/data-requer="dev"/g) || []).length >= 3);
T('E', 'itens de dev começam escondidos',      /class="sb hide" data-requer="dev"/.test(html));
T('E', 'usuarios bloqueia quem não é dev',     /Views\.usuarios = function\(\)\{[\s\S]{0,80}?ehDevUI\(\)\) return telaRestrita/.test(html));
T('E', 'cobranca bloqueia quem não é dev',     /Views\.cobranca = function\(\)\{[\s\S]{0,80}?ehDevUI\(\)\) return telaRestrita/.test(html));
T('E', 'tela restrita explica sem assustar',   /Esta área é do desenvolvedor/.test(html));
T('E', 'contrato funciona sem Supabase',       /CONTRATO_PADRAO/.test(html));
T('E', 'mostra o valor mensal',                /Sustentação mensal/.test(html));
T('E', 'mostra o que está incluído',           /O que está incluído/.test(html));
T('E', 'informa ausência de fidelidade',       /Sem fidelidade/.test(html));
T('E', 'relatório de valor entregue presente', /O que o sistema entregou/.test(html));
T('E', 'compara custo x volume controlado',    /Custo x volume controlado/.test(html));
T('E', 'seletor de mês no relatório',          /id="veMes"/.test(html));
T('E', 'escapa dados do usuário na lista',     /esc\(u\.nome/.test(html) && /esc\(u\.email/.test(html));
T('E', 'usa o Modal com footer/onMount',       /onMount: ov=>/.test(html));
T('E', 'botão salvar trava durante o envio',   /bt\.disabled = true/.test(html));
T('E', 'aplicarVisibilidadeDev exportada',     /window\.aplicarVisibilidadeDev/.test(html));

/* -------------------------------------------------------------- F. GUARD */
grupo('F. Integração no guard.js');
T('F', 'importa gestao.js',                    /import\('\.\/gestao\.js'\)/.test(guard));
T('F', 'instala a ponte antes do render',      guard.indexOf('instalarPonte()') < guard.indexOf('const pronto'));
T('F', 'falha de gestão não derruba o app',    /catch[\s\S]{0,120}?gestão indisponível/.test(guard));
T('F', 'reaplica visibilidade a cada render',  (guard.match(/aplicarVisibilidadeDev/g) || []).length >= 2);

/* ---------------------------------------------------- G. MOCK (execução) */
grupo('G. Mock — comportamento executável');
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window = global;

let criar;
try {
  const src = mock.replace(/export\s+(function|const|default)/g, '$1');
  const mod = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'globalThis', src + '\n;module.exports = createClient;')
    (mod, mod.exports, global.localStorage, global);
  criar = mod.exports;
} catch (e) { /* nome da fábrica pode variar */ }

if (typeof criar !== 'function') {
  T('G', 'mock carregou', false, 'não foi possível instanciar a fábrica');
} else {
  (async () => {
    const sb = criar();
    await sb.auth.signInWithPassword({ email: 'ana@teste.com', password: 'senha123' });

    const inv = (acao, extra) => sb.functions.invoke('admin-usuarios', { body: { acao, ...(extra || {}) } });

    const emp = await inv('empresas');
    T('G', 'lista empresas', Array.isArray(emp.data.empresas) && emp.data.empresas.length >= 1);

    const idEmpresa = emp.data.empresas[0].id;
    const antes = (await inv('listar')).data.usuarios.length;

    const c = await inv('criar', { nome: 'Pedro Lima', email: 'pedro@teste.com',
                                   papel: 'estoquista', empresaId: idEmpresa });
    T('G', 'cria usuário', c.data.ok === true, JSON.stringify(c.data));

    const depois = (await inv('listar')).data.usuarios;
    T('G', 'usuário aparece na lista', depois.length === antes + 1);
    T('G', 'papel gravado corretamente',
      (depois.find(u => u.email === 'pedro@teste.com') || {}).papel === 'estoquista');

    const dup = await inv('criar', { nome: 'Outro', email: 'pedro@teste.com',
                                     papel: 'admin', empresaId: idEmpresa });
    T('G', 'recusa e-mail duplicado', !!dup.data.erro, JSON.stringify(dup.data));

    const novoId = depois.find(u => u.email === 'pedro@teste.com').id;
    await inv('atualizar', { id: novoId, papel: 'admin', ativo: false });
    const ap = (await inv('listar')).data.usuarios.find(u => u.id === novoId);
    T('G', 'altera papel', ap.papel === 'admin');
    T('G', 'desativa usuário', ap.ativo === false);

    const auto = await inv('atualizar', { id: '22222222-2222-4222-8222-222222222222', ativo: false });
    T('G', 'impede desativar a si mesmo', !!auto.data.erro, JSON.stringify(auto.data));

    const autoRm = await inv('remover', { id: '22222222-2222-4222-8222-222222222222' });
    T('G', 'impede remover a si mesmo', !!autoRm.data.erro);

    await inv('remover', { id: novoId });
    T('G', 'remove usuário', (await inv('listar')).data.usuarios.length === antes);

    /* cobrança */
    const g1 = await sb.rpc('fn_gerar_cobranca', { p_empresa: idEmpresa });
    T('G', 'gera cobrança', g1.data && Number(g1.data.valor) === 350, JSON.stringify(g1));
    T('G', 'vencimento no dia do contrato', /-10$/.test(g1.data.vencimento), g1.data.vencimento);

    const g2 = await sb.rpc('fn_gerar_cobranca', { p_empresa: idEmpresa });
    T('G', 'não duplica no mesmo mês', g2.data.id === g1.data.id);

    const semCt = await sb.rpc('fn_gerar_cobranca', { p_empresa: 'empresa-inexistente' });
    T('G', 'empresa sem contrato dá P0006', semCt.error && semCt.error.code === 'P0006');

    /* acesso negado a quem não é dev */
    await sb.auth.signOut();
    const anon = await inv('listar');
    T('G', 'sem sessão a Edge Function nega', !!anon.data.erro);

    /* -------- fechamento -------- */
    console.log('\n' + '─'.repeat(58));
    if (falhas.length === 0) {
      console.log('\x1b[32m\x1b[1m  ' + ok + '/' + ok + ' — etapa 7 aprovada.\x1b[0m');
    } else {
      console.log('\x1b[31m\x1b[1m  ' + ok + ' passaram · ' + falhas.length + ' falharam\x1b[0m');
      falhas.forEach(f => console.log('    \x1b[31m·\x1b[0m ' + f));
      process.exitCode = 1;
    }
    console.log('─'.repeat(58) + '\n');
  })();
}
