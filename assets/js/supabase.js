/* =============================================================================
   ObraStock — Cliente Supabase (instância única)
   =============================================================================
   Sem etapa de build: o SDK entra como ES module via CDN.
   Se o CDN estiver bloqueado (offline, rede corporativa, preview em sandbox),
   a importação falha — por isso ela é isolada aqui e o erro é tratado, em vez
   de derrubar a aplicação inteira com tela branca.
============================================================================= */

import { SUPABASE_URL, SUPABASE_ANON, CONFIGURADO } from './config.js';

const CDN = 'https://esm.sh/@supabase/supabase-js@2';

let _client = null;
let _erro   = null;

/** Motivo pelo qual o cliente não pôde ser criado (ou null se está tudo bem). */
export function erroCliente(){ return _erro; }

/**
 * Devolve o cliente Supabase, criando-o na primeira chamada.
 * Retorna null quando não configurado ou quando o SDK não pôde ser carregado.
 */
export async function getClient(){
  if (_client) return _client;

  if (!CONFIGURADO){
    _erro = {
      tipo: 'config',
      titulo: 'Credenciais não configuradas',
      msg: 'Abra assets/js/config.js e preencha SUPABASE_URL e SUPABASE_ANON com os dados do seu projeto.'
    };
    return null;
  }

  try {
    const { createClient } = await import(CDN);
    _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,        // sessão sobrevive a fechar o navegador
        autoRefreshToken: true,      // renova o token sozinho
        detectSessionInUrl: true,    // necessário para o link de redefinir senha
        storageKey: 'obrastock.auth'
      }
    });
    return _client;
  } catch (e){
    _erro = {
      tipo: 'rede',
      titulo: 'Não foi possível carregar o sistema',
      msg: 'Verifique sua conexão com a internet e tente novamente.',
      detalhe: String(e && e.message || e)
    };
    return null;
  }
}

/* --------------------------------------------------------------------------
   Tradução de erros do Supabase para linguagem de obra.
   Regra: nunca revelar se um e-mail existe ou não (evita enumeração de contas).
-------------------------------------------------------------------------- */
const MAPA_ERROS = {
  'Invalid login credentials'      : 'E-mail ou senha incorretos.',
  'Email not confirmed'            : 'Confirme seu e-mail antes de entrar. Verifique a caixa de entrada.',
  'User already registered'        : 'Não foi possível concluir. Procure o administrador.',
  'Password should be at least 6 characters': 'A senha precisa ter ao menos 6 caracteres.',
  'New password should be different from the old password': 'A nova senha precisa ser diferente da atual.',
  'Email rate limit exceeded'      : 'Muitas tentativas. Aguarde alguns minutos.',
  'For security purposes, you can only request this after 60 seconds': 'Aguarde um minuto antes de tentar de novo.',
  'Auth session missing!'          : 'Sua sessão expirou. Entre novamente.',
  'Token has expired or is invalid': 'Este link expirou. Solicite um novo.'
};

/* Regras de negócio que os triggers do banco levantam. A mensagem já vem
   pronta do servidor (com o saldo real), então usamos o texto dele e apenas
   acrescentamos o que fazer. Ver supabase/README.md. */
const REGRAS = {
  P0001: t => t || 'Estoque insuficiente para esta saída.',
  P0002: t => (t ? t + '. ' : '') + 'A devolução não pode passar do que foi enviado para a obra.',
  P0003: 'Esta movimentação deixaria o estoque negativo. Estorne antes as saídas posteriores deste material.',
  P0004: 'Estorne primeiro a devolução desta obra.',
  P0005: 'Esta alteração é exclusiva do desenvolvedor do sistema.',
  P0006: 'Esta empresa ainda não tem contrato ativo.'
};

/* Violações de integridade — o nome da constraint diz o que aconteceu. */
const CONSTRAINTS = {
  qtd_positiva:     'A quantidade precisa ser maior que zero.',
  obra_obrigatoria: 'Escolha a obra para este tipo de movimentação.',
  ux_notas_chave:   'Esta nota fiscal já foi importada.',
  materiais_empresa_id_codigo_key: 'Já existe um material com este código.',
  obras_empresa_id_nome_key:       'Já existe uma obra com este nome.',
  categorias_empresa_id_nome_key:  'Esta categoria já existe.'
};

export function traduzErro(erro){
  if (!erro) return 'Ocorreu um erro inesperado.';
  const bruto = erro.message || String(erro);
  const codigo = erro.code || '';

  if (REGRAS[codigo]){
    const r = REGRAS[codigo];
    return typeof r === 'function' ? r(bruto) : r;
  }
  for (const nome in CONSTRAINTS){
    if (bruto.includes(nome)) return CONSTRAINTS[nome];
  }
  if (codigo === '42501' || /row-level security/i.test(bruto))
    return 'Seu perfil não tem permissão para esta ação.';
  if (codigo === '23503')
    return 'Este registro está sendo usado em outro lugar e não pode ser removido.';

  for (const chave in MAPA_ERROS){
    if (bruto.includes(chave)) return MAPA_ERROS[chave];
  }
  if (/fetch|network|Failed to fetch/i.test(bruto))
    return 'Sem conexão com o servidor. Verifique sua internet.';
  if (/rate limit|too many/i.test(bruto))
    return 'Muitas tentativas seguidas. Aguarde um instante.';

  return 'Não foi possível concluir. Tente novamente.';
}
