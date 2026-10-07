/* =============================================================================
   ObraStock — Autenticação, sessão e permissões
   =============================================================================
   Responsabilidades:
     · entrar / sair / redefinir senha
     · guarda de rota (nenhuma tela do app abre sem sessão)
     · carregar o perfil (nome, papel, empresa) e mantê-lo em cache
     · aplicar permissões de papel na interface

   Importante: a checagem de papel aqui é CONVENIÊNCIA — evita mostrar botão
   que vai falhar. A autoridade real é a RLS no banco, já testada.
============================================================================= */

import { getClient, traduzErro, erroCliente } from './supabase.js';
import { ROTA_APP, ROTA_LOGIN } from './config.js';

const CACHE_PERFIL = 'obrastock:perfil';

let _perfil = null;   // { id, nome, cargo, papel, tema, empresa_id, empresa }

/* ==========================================================================
   SESSÃO
   ========================================================================== */

export async function sessaoAtual(){
  const sb = await getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session || null;
}

/**
 * Guarda de rota das telas internas.
 * Sem sessão válida → manda para o login e NÃO libera a tela.
 * Devolve o perfil quando autenticado.
 */
export async function exigirSessao(){
  const sb = await getClient();

  if (!sb){
    // sem cliente não há como validar sessão: trata como não autenticado
    irParaLogin();
    return null;
  }

  const { data } = await sb.auth.getSession();
  if (!data?.session){
    irParaLogin();
    return null;
  }

  const perfil = await carregarPerfil();

  // usuário autenticado porém desativado pelo admin
  if (!perfil || perfil.ativo === false){
    await sair(true);
    return null;
  }

  return perfil;
}

/** Redireciona preservando para onde o usuário queria ir. */
function irParaLogin(){
  const destino = location.pathname.split('/').pop() || '';
  const query = (destino && destino !== ROTA_LOGIN)
    ? '?next=' + encodeURIComponent(destino + location.search)
    : '';
  location.replace(ROTA_LOGIN + query);
}

/* ==========================================================================
   ENTRAR / SAIR
   ========================================================================== */

export async function entrar(email, senha){
  const sb = await getClient();
  if (!sb) return { ok:false, msg: erroCliente()?.msg || 'Sistema indisponível.' };

  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email || '').trim().toLowerCase(),
    password: String(senha || '')
  });

  if (error) return { ok:false, msg: traduzErro(error) };

  // confere se existe perfil ativo antes de liberar
  const perfil = await carregarPerfil();
  if (!perfil){
    await sb.auth.signOut();
    return { ok:false, msg:'Seu usuário não está vinculado a nenhuma empresa. Procure o administrador.' };
  }
  if (perfil.ativo === false){
    await sb.auth.signOut();
    return { ok:false, msg:'Seu acesso foi desativado. Procure o administrador.' };
  }

  return { ok:true, sessao:data.session, perfil };
}

export async function sair(silencioso){
  const sb = await getClient();
  try { if (sb) await sb.auth.signOut(); } catch(e){ /* segue mesmo assim */ }

  _perfil = null;
  try {
    localStorage.removeItem(CACHE_PERFIL);
    // limpa o cache de dados do app, mas preserva a preferência de tema
    Object.keys(localStorage)
      .filter(k => k.startsWith('obrastock:') && k !== 'obrastock:tema')
      .forEach(k => localStorage.removeItem(k));
  } catch(e){}

  if (!silencioso) location.replace(ROTA_LOGIN);
  else irParaLogin();
}

/* ==========================================================================
   SENHA
   ========================================================================== */

export async function pedirRedefinicao(email){
  const sb = await getClient();
  if (!sb) return { ok:false, msg: erroCliente()?.msg || 'Sistema indisponível.' };

  const base = location.href.replace(/[^/]*$/, '');
  const { error } = await sb.auth.resetPasswordForEmail(
    String(email || '').trim().toLowerCase(),
    { redirectTo: base + ROTA_LOGIN + '?recuperar=1' }
  );

  // Resposta sempre igual, exista ou não o e-mail: não entregamos ao atacante
  // a informação de quais contas existem.
  if (error && !/rate limit|60 seconds/i.test(error.message || '')){
    return { ok:true, msg:'Se este e-mail estiver cadastrado, você receberá as instruções em instantes.' };
  }
  if (error) return { ok:false, msg: traduzErro(error) };

  return { ok:true, msg:'Se este e-mail estiver cadastrado, você receberá as instruções em instantes.' };
}

export async function definirNovaSenha(senha){
  const sb = await getClient();
  if (!sb) return { ok:false, msg:'Sistema indisponível.' };

  if (String(senha||'').length < 6)
    return { ok:false, msg:'A senha precisa ter ao menos 6 caracteres.' };

  const { error } = await sb.auth.updateUser({ password: senha });
  if (error) return { ok:false, msg: traduzErro(error) };
  return { ok:true, msg:'Senha alterada com sucesso.' };
}

/* ==========================================================================
   PERFIL
   ========================================================================== */

export async function carregarPerfil(forcar){
  if (_perfil && !forcar) return _perfil;

  const sb = await getClient();
  if (!sb) return null;

  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return null;

  const { data, error } = await sb
    .from('perfis')
    .select('id, nome, cargo, papel, tema, ativo, empresa_id, empresas ( id, nome, cnpj, galpao )')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error || !data) return null;

  _perfil = {
    id:         data.id,
    email:      auth.user.email,
    nome:       data.nome,
    cargo:      data.cargo,
    papel:      data.papel,
    tema:       data.tema || 'auto',
    ativo:      data.ativo,
    empresa_id: data.empresa_id,
    empresa:    data.empresas?.nome   || '',
    cnpj:       data.empresas?.cnpj   || '',
    galpao:     data.empresas?.galpao || 'Galpão Central'
  };

  try { localStorage.setItem(CACHE_PERFIL, JSON.stringify(_perfil)); } catch(e){}
  return _perfil;
}

/** Perfil já em memória (síncrono). Use depois de exigirSessao(). */
export function perfil(){
  if (_perfil) return _perfil;
  try { return JSON.parse(localStorage.getItem(CACHE_PERFIL) || 'null'); }
  catch(e){ return null; }
}

export async function atualizarPerfil(patch){
  const sb = await getClient();
  const p = perfil();
  if (!sb || !p) return { ok:false, msg:'Sessão não encontrada.' };

  const { error } = await sb.from('perfis').update(patch).eq('id', p.id);
  if (error) return { ok:false, msg: traduzErro(error) };

  await carregarPerfil(true);
  return { ok:true };
}

/* ==========================================================================
   PAPÉIS E PERMISSÕES
   ========================================================================== */

export function ehAdmin(){       return perfil()?.papel === 'admin'; }
export function podeEditar(){    const p = perfil()?.papel; return p === 'admin' || p === 'estoquista'; }
export function somenteLeitura(){ return perfil()?.papel === 'visualizador'; }

export function rotuloPapel(papel){
  return { admin:'Administrador', estoquista:'Estoquista', visualizador:'Visualizador' }[papel || perfil()?.papel] || '—';
}

/**
 * Aplica as permissões na interface.
 * Elementos marcados com data-requer="editar" ou "admin" são REMOVIDOS
 * do DOM quando o papel não permite — e não apenas desabilitados, para
 * não sugerir uma ação indisponível.
 */
export function aplicarPermissoes(raiz){
  const escopo = raiz || document;

  escopo.querySelectorAll('[data-requer="editar"]').forEach(el => {
    if (!podeEditar()) el.remove();
  });
  escopo.querySelectorAll('[data-requer="admin"]').forEach(el => {
    if (!ehAdmin()) el.remove();
  });

  if (somenteLeitura()) document.documentElement.dataset.somenteLeitura = '1';
}

/* ==========================================================================
   REAÇÃO A MUDANÇA DE SESSÃO (logout em outra aba, token expirado)
   ========================================================================== */
export async function observarSessao(){
  const sb = await getClient();
  if (!sb) return;

  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'SIGNED_OUT' || (!sessao && evento !== 'INITIAL_SESSION')){
      _perfil = null;
      try { localStorage.removeItem(CACHE_PERFIL); } catch(e){}
      if (!location.pathname.endsWith(ROTA_LOGIN)) irParaLogin();
    }
  });
}

/** Libera a página depois que a sessão foi confirmada (evita flash de conteúdo). */
export function liberarTela(){
  document.documentElement.style.visibility = '';
}

export { ROTA_APP, ROTA_LOGIN };
