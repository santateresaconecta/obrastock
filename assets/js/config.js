/* =============================================================================
   ObraStock — Configuração
   =============================================================================
   PREENCHA os dois valores abaixo com os dados do SEU projeto Supabase:
     Supabase → Project Settings → API
       Project URL      -> SUPABASE_URL
       anon public key  -> SUPABASE_ANON

   A chave "anon" é pública por design: quem protege os dados é a RLS,
   já validada no schema. NUNCA coloque aqui a chave "service_role" —
   ela ignora toda a segurança.
============================================================================= */

export const SUPABASE_URL  = 'COLE_AQUI_SUA_PROJECT_URL';
export const SUPABASE_ANON = 'COLE_AQUI_SUA_ANON_KEY';

/* Marca do aplicativo (usada na tela de login e nos e-mails) */
export const APP_NOME    = 'ObraStock';
export const APP_DESC    = 'Gestão de Estoque';
export const APP_VERSAO  = 'v2.0.0';

/* -----------------------------------------------------------------------------
   DESENVOLVEDOR
   E-mails com acesso à gestão de usuários e à cobrança.

   >>> TROQUE PELO SEU E-MAIL <<<

   Isto aqui é só conveniência de interface: decide quais menus aparecem.
   Quem realmente bloqueia é a tabela `desenvolvedores` no banco e a Edge
   Function. Mesmo que alguém edite este arquivo no próprio navegador, o
   servidor recusa.
----------------------------------------------------------------------------- */
export const DEVS = ['polo.lemos@gmail.com'];

export function ehDevEmail(email){
  if (!email) return false;
  return DEVS.some(d => d.toLowerCase() === String(email).toLowerCase());
}

/* Nome da Edge Function que cria e altera usuários */
export const FN_USUARIOS = 'admin-usuarios';

/* Para onde ir depois de autenticar */
export const ROTA_APP   = 'index.html';
export const ROTA_LOGIN = 'login.html';

/* true quando as credenciais ainda não foram preenchidas */
export const CONFIGURADO =
  !SUPABASE_URL.startsWith('COLE_AQUI') &&
  !SUPABASE_ANON.startsWith('COLE_AQUI') &&
  SUPABASE_URL.includes('supabase');
