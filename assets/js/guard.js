/* =============================================================================
   ObraStock — Guarda de rota das telas internas
   =============================================================================
   Incluir no <head> de toda página protegida:
       <script type="module" src="assets/js/guard.js"></script>

   Comportamento:
     · Credenciais configuradas  -> exige sessão válida. Sem sessão, vai para o
       login antes de qualquer conteúdo aparecer.
     · Credenciais NÃO configuradas -> libera em "modo protótipo" com faixa de
       aviso. Nesse estado não existe backend algum: os dados são locais e não
       há o que proteger. Assim que config.js for preenchido, a guarda passa a
       valer automaticamente.
============================================================================= */

import { CONFIGURADO, APP_VERSAO } from './config.js';
import { exigirSessao, observarSessao, liberarTela, perfil, sair,
         aplicarPermissoes, rotuloPapel, somenteLeitura,
         atualizarPerfil } from './auth.js';

/* --------------------------------------------------------------------------
   SEM CREDENCIAIS
   Antes isto abria um "modo protótipo": o sistema funcionava, gravando no
   localStorage do navegador. Em produção isso é pior do que não abrir — o
   usuário registraria a saída de material, veria tudo certo na tela, e o
   dado morreria naquele aparelho.
   Agora a tela fica bloqueada com um aviso dirigido a quem instala.
-------------------------------------------------------------------------- */
function telaSemConfiguracao(){
  const d = document.createElement('div');
  /* O guard mantem o <html> com visibility:hidden ate os dados chegarem, e
     visibility e herdada. Sem reverter aqui, este aviso ficaria invisivel e
     o usuario veria uma tela branca sem explicacao nenhuma. */
  d.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:#0f2742;color:#fff;' +
    'visibility:visible;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:14px;padding:28px;text-align:center;font:400 14px Inter,system-ui,sans-serif';
  d.innerHTML =
    '<i class="fa-solid fa-plug-circle-xmark" style="font-size:34px;opacity:.5"></i>' +
    '<b style="font-size:17px">Sistema não configurado</b>' +
    '<span style="max-width:400px;line-height:1.5;opacity:.85">' +
    'A ligação com o banco de dados não foi preenchida nesta instalação. ' +
    'Nenhum dado pode ser gravado até que isso seja corrigido.</span>' +
    '<span style="max-width:400px;line-height:1.5;opacity:.6;font-size:12.5px">' +
    'Para quem administra: preencha SUPABASE_URL e SUPABASE_ANON em ' +
    'assets/js/config.js e publique novamente.</span>';
  document.body.appendChild(d);
}

/* --------------------------------------------------------------------------
   RODAPÉ DA SIDEBAR — nome, papel e sair
-------------------------------------------------------------------------- */
function montarIdentidade(){
  const p = perfil();
  if (!p) return;

  const nome = document.getElementById('sbUser');
  const ver  = document.getElementById('sbVersion');
  if (nome) nome.textContent = p.nome || 'Usuário';
  if (ver)  ver.textContent  = rotuloPapel(p.papel) + ' · ' + APP_VERSAO;

  // botão Sair, logo abaixo da identidade
  const rodape = document.querySelector('.sb-foot');
  if (rodape && !document.getElementById('btnSair')){
    const b = document.createElement('button');
    b.id = 'btnSair';
    b.type = 'button';
    b.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Sair';
    b.style.cssText =
      'margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;' +
      'padding:9px;border-radius:10px;cursor:pointer;font:600 12.5px Inter,system-ui,sans-serif;' +
      'background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.16)';
    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,.18)');
    b.addEventListener('mouseleave', () => b.style.background = 'rgba(255,255,255,.08)');
    b.addEventListener('click', confirmarSaida);
    rodape.appendChild(b);
  }

  if (somenteLeitura()) selo();
}

/** Selo discreto para quem só pode consultar. */
function selo(){
  if (document.getElementById('seloLeitura')) return;
  const s = document.createElement('div');
  s.id = 'seloLeitura';
  s.textContent = 'Somente leitura';
  s.style.cssText =
    'position:fixed;top:10px;right:12px;z-index:9997;background:#e8f1fd;color:#12497f;' +
    'border:1px solid #c5dcfa;border-radius:99px;padding:5px 12px;' +
    'font:700 11px Inter,system-ui,sans-serif;letter-spacing:.3px';
  document.body.appendChild(s);
}

/* --------------------------------------------------------------------------
   INDICADOR DE GRAVAÇÃO
   Escritas são otimistas: a tela atualiza na hora e o envio acontece atrás.
   Este ponto discreto mostra que ainda há algo subindo — importante antes de
   fechar o notebook achando que já salvou.
-------------------------------------------------------------------------- */
function indicadorSync(){
  const el = document.createElement('div');
  el.id = 'syncStatus';
  el.style.cssText =
    'position:fixed;bottom:14px;right:14px;z-index:9996;display:none;gap:8px;' +
    'align-items:center;background:#0f2742;color:#fff;border-radius:99px;' +
    'padding:7px 14px;font:600 12px Inter,system-ui,sans-serif;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.2)';
  el.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i><span>Salvando…</span>';
  document.body.appendChild(el);
  window.ObraStockSync = n => { el.style.display = n > 0 ? 'flex' : 'none'; };
}

/** Falha ao carregar os dados: avisa em vez de mostrar o sistema vazio. */
function avisoDados(msg){
  const d = document.createElement('div');
  d.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(15,39,66,.96);color:#fff;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:14px;padding:28px;text-align:center;font:400 14px Inter,system-ui,sans-serif';
  d.innerHTML =
    '<i class="fa-solid fa-database" style="font-size:34px;opacity:.5"></i>' +
    '<b style="font-size:17px">Não foi possível carregar seus dados</b>' +
    '<span style="max-width:380px;line-height:1.5;opacity:.85">' + msg + '</span>' +
    '<button id="btnRecarregar" style="margin-top:6px;padding:11px 22px;border-radius:10px;' +
    'border:0;background:#1d6fe0;color:#fff;font:600 14px Inter,system-ui,sans-serif;' +
    'cursor:pointer">Tentar de novo</button>';
  document.body.appendChild(d);
  d.querySelector('#btnRecarregar').addEventListener('click', () => location.reload());
}

/* --------------------------------------------------------------------------
   TEMA ENTRE APARELHOS
   A preferência vive em localStorage (rápido, sem rede) e também em
   perfis.tema, para acompanhar o usuário do computador do escritório para o
   celular da obra. Na primeira entrada em um aparelho novo, vale o perfil.
-------------------------------------------------------------------------- */
function sincronizarTema(p){
  let local = null;
  try { local = localStorage.getItem('obrastock:tema'); } catch (e) {}

  if (!local && p.tema){
    try { localStorage.setItem('obrastock:tema', p.tema); } catch (e) {}
    if (window.Tema) window.Tema.aplicar(p.tema);
  }

  // o app chama isto quando o usuário troca o tema
  window.ObraStockSalvarTema = valor => {
    atualizarPerfil({ tema: valor }).catch(e => console.warn('[tema]', e));
  };
}

function confirmarSaida(){
  // usa o Modal do app quando disponível; senão, confirm nativo
  if (window.Modal && typeof window.Modal.confirm === 'function'){
    window.Modal.confirm(
      'Sair do sistema?',
      'Você precisará entrar novamente com e-mail e senha.',
      () => sair(),
      { yes: 'Sim, sair', danger: true, icon: 'fa-right-from-bracket' }
    );
  } else if (confirm('Sair do sistema?')){
    sair();
  }
}

/* --------------------------------------------------------------------------
   INÍCIO
-------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   LIMPEZA DA VERSÃO ANTERIOR
   Quem já usou o sistema antes tem materiais, obras e movimentações velhas
   guardadas no navegador. Não são mais lidas por nada, mas ficariam lá
   ocupando espaço e, pior, apareceriam para quem abrisse o armazenamento do
   navegador achando que ainda valem. Sai uma vez e nunca mais.
   O tema, as dicas e a sessão NÃO entram nesta lista: são preferências.
-------------------------------------------------------------------------- */
function limparDadosAntigos(){
  const velhas = ['materiais','obras','fornecedores','movimentacoes','notas',
                  'categorias','config','modo'];
  try {
    Object.keys(localStorage).forEach(k => {
      if (!k.startsWith('obrastock:')) return;
      const resto = k.slice('obrastock:'.length);
      if (velhas.includes(resto) || resto.startsWith('_meta:'))
        localStorage.removeItem(k);
    });
  } catch (e) { /* navegador sem armazenamento: nada a limpar */ }
}

(async function iniciar(){
  limparDadosAntigos();

  /* Avisa a rede de segurança do index.html que o guard assumiu.
     Sem isto ela mostraria o aviso de falha por cima de um app saudável. */
  window.__obrastockGuardOk = true;

  if (!CONFIGURADO){
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', telaSemConfiguracao);
    else telaSemConfiguracao();
    return;              // a tela NAO e liberada: nada de app sem banco
  }

  const p = await exigirSessao();
  if (!p) return;          // exigirSessao já redirecionou; a tela segue oculta

  try {
    const { iniciarDados, protegerSaida } = await import('./data.js');
    const adapter = await iniciarDados();
    protegerSaida(adapter);
    if (typeof window.ObraStockTrocarAdapter === 'function')
      window.ObraStockTrocarAdapter(adapter);
    indicadorSync();
  } catch (e) {
    console.error('[dados]', e);
    avisoDados(e.message || 'Não foi possível carregar os dados.');
  }

  liberarTela();
  observarSessao();

  sincronizarTema(p);

  /* Etapa 7: gestão de usuários e cobrança.
     A ponte precisa existir ANTES do primeiro render, senão as telas de
     desenvolvedor abrem vazias no F5. */
  try{
    const { instalarPonte } = await import('./gestao.js');
    instalarPonte();
  }catch(e){
    console.warn('[guard] gestão indisponível:', e.message);
  }

  /* Foto do material. Os <script> do index.html não são módulos, então o
     módulo é pendurado em window — mesma ponte usada por DB e Gestao.
     Se falhar, o cadastro de material continua funcionando sem foto: o
     formulário checa window.Fotos antes de mostrar o campo. */
  try{
    const fotos = await import('./fotos.js');
    window.Fotos = fotos;
    window.ObraStockEmpresaId = (p && p.empresa_id) || null;
  }catch(e){
    console.warn('[guard] fotos indisponíveis:', e.message);
  }

  const pronto = () => {
    montarIdentidade();
    aplicarPermissoes();
    if (typeof window.aplicarVisibilidadeDev === 'function') window.aplicarVisibilidadeDev();
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', pronto);
  else pronto();

  // reaplica permissões a cada re-render do app
  if (window.App && typeof window.App.render === 'function'){
    const original = window.App.render.bind(window.App);
    window.App.render = function(...args){
      const r = original(...args);
      aplicarPermissoes();
      if (typeof window.aplicarVisibilidadeDev === 'function') window.aplicarVisibilidadeDev();
      return r;
    };
  }
})();
