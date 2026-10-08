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
  P0006: 'Esta empresa ainda não tem contrato ativo.',
  /* P0007 é usado pelo cadastro de cliente novo (CNPJ repetido, dia de
     vencimento fora da faixa, valor zerado). A própria função já devolve a
     frase pronta e específica; traduzir de novo só pioraria. */
  P0007: bruto => bruto
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

/* Nome tecnico da coluna -> nome que o usuario ve na tela. */
const ROTULOS = {
  nome: 'Nome', codigo: 'Codigo', descricao: 'Descricao', categoria: 'Categoria',
  unidade: 'Unidade', quantidade: 'Quantidade', material_desc: 'Material',
  razao_social: 'Razao social', numero: 'Numero', tipo: 'Tipo', data: 'Data',
  status: 'Status', empresa_id: 'Empresa', material_id: 'Material',
  obra_id: 'Obra', fornecedor_id: 'Fornecedor', nota_id: 'Nota fiscal'
};
function nomeAmigavel(col){
  return ROTULOS[col] || col.replace(/_id$/, '').replace(/_/g, ' ');
}

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

  /* Erros de formato e de campo obrigatório. Sem estes, qualquer um deles caía
     no "Não foi possível concluir. Tente novamente." do final — que não diz ao
     usuário o que fazer nem me ajuda a achar o defeito. O nome da coluna vem
     na mensagem do Postgres; aproveitamos para apontar o campo. */
  if (codigo === '22007' || codigo === '22008' || /invalid input syntax for type date/i.test(bruto))
    return 'Há uma data em formato inválido. Confira os campos de data.';
  if (codigo === '22P02' || /invalid input syntax for type (uuid|numeric|integer)/i.test(bruto))
    return 'Há um campo numérico ou uma seleção com valor inválido.';
  if (codigo === '23502' || /violates not-null constraint/i.test(bruto)){
    const m = bruto.match(/column "([^"]+)"/);
    return m ? 'O campo "' + nomeAmigavel(m[1]) + '" é obrigatório.'
             : 'Um campo obrigatório ficou em branco.';
  }
  if (codigo === 'PGRST204'){
    const m = bruto.match(/'([^']+)' column/);
    return 'O sistema tentou gravar um campo que não existe no banco' +
           (m ? ' ("' + m[1] + '")' : '') + '. Avise o suporte.';
  }

  for (const chave in MAPA_ERROS){
    if (bruto.includes(chave)) return MAPA_ERROS[chave];
  }
  if (/fetch|network|Failed to fetch/i.test(bruto))
    return 'Sem conexão com o servidor. Verifique sua internet.';
  if (/rate limit|too many/i.test(bruto))
    return 'Muitas tentativas seguidas. Aguarde um instante.';

  return 'Não foi possível concluir. Tente novamente.';
}
