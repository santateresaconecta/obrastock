/* =============================================================================
   ObraStock — Gestão de usuários e cobrança (área do desenvolvedor)
   =============================================================================
   Criar login exige a chave service_role, que não pode estar no navegador.
   Por isso tudo que mexe em usuário passa pela Edge Function `admin-usuarios`,
   que roda no servidor do Supabase e confere se quem pediu está na tabela
   `desenvolvedores`.

   Contrato e cobranças são tabelas comuns: o cliente lê (transparência),
   só o desenvolvedor escreve — garantido por RLS, já testada.
============================================================================= */

import { getClient, traduzErro } from './supabase.js';
import { perfil, sessaoAtual } from './auth.js';
import { FN_USUARIOS, ehDevEmail, ROTA_LOGIN } from './config.js';

/* -----------------------------------------------------------------------------
   É desenvolvedor?
   A resposta que vale é a do servidor. Esta é só para montar o menu.
----------------------------------------------------------------------------- */
export function ehDev(){
  const p = perfil();
  return ehDevEmail(p && p.email);
}

/* -----------------------------------------------------------------------------
   Chamada à Edge Function
----------------------------------------------------------------------------- */
async function chamar(acao, dados = {}){
  const sb = await getClient();
  if (!sb) throw new Error('Sistema sem conexão com o servidor.');

  const redirectTo = location.origin + '/' + ROTA_LOGIN;
  const { data, error } = await sb.functions.invoke(FN_USUARIOS, {
    body: { acao, redirectTo, ...dados }
  });

  if (error){
    // a Edge Function devolve a explicação no corpo; o SDK só traz "non-2xx"
    let detalhe = '';
    try { detalhe = (await error.context?.json())?.erro || ''; } catch (e) {}
    throw new Error(detalhe || traduzErro(error));
  }
  if (data && data.erro) throw new Error(data.erro);
  return data;
}

export const Usuarios = {
  listar:    empresaId => chamar('listar', { empresaId }),
  empresas:  ()        => chamar('empresas'),
  criar:     dados     => chamar('criar', dados),
  atualizar: dados     => chamar('atualizar', dados),
  convite:   email     => chamar('convite', { email }),
  remover:   id        => chamar('remover', { id })
};

/* -----------------------------------------------------------------------------
   CONTRATO E COBRANÇAS
----------------------------------------------------------------------------- */
export const Cobranca = {

  async contrato(empresaId){
    const sb = await getClient();
    let q = sb.from('contratos').select('*');
    if (empresaId) q = q.eq('empresa_id', empresaId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(traduzErro(error));
    return data;
  },

  async salvarContrato(empresaId, patch){
    const sb = await getClient();
    const { data: existe } = await sb.from('contratos')
      .select('id').eq('empresa_id', empresaId).maybeSingle();

    const resposta = existe
      ? await sb.from('contratos').update(patch).eq('empresa_id', empresaId).select().single()
      : await sb.from('contratos').insert({ empresa_id: empresaId, ...patch }).select().single();

    if (resposta.error) throw new Error(traduzErro(resposta.error));
    return resposta.data;
  },

  async lista(empresaId, limite = 24){
    const sb = await getClient();
    let q = sb.from('cobrancas').select('*').order('competencia', { ascending: false }).limit(limite);
    if (empresaId) q = q.eq('empresa_id', empresaId);
    const { data, error } = await q;
    if (error) throw new Error(traduzErro(error));
    return data || [];
  },

  async gerarMes(empresaId, competencia){
    const sb = await getClient();
    const { data, error } = await sb.rpc('fn_gerar_cobranca', {
      p_empresa: empresaId,
      p_competencia: competencia || null
    });
    if (error) throw new Error(traduzErro(error));
    return data;
  },

  async marcarPaga(id, metodo){
    const sb = await getClient();
    const { error } = await sb.from('cobrancas')
      .update({ pago_em: new Date().toISOString().slice(0, 10), metodo: metodo || 'PIX' })
      .eq('id', id);
    if (error) throw new Error(traduzErro(error));
  },

  async reabrir(id){
    const sb = await getClient();
    const { error } = await sb.from('cobrancas')
      .update({ pago_em: null, metodo: null }).eq('id', id);
    if (error) throw new Error(traduzErro(error));
  },

  /* ---------------------------------------------------------------------------
     VALOR ENTREGUE NO MÊS
     Para a conversa de renovação não virar "acho que vale". São números
     tirados do uso real, não estimativas de marketing.
  --------------------------------------------------------------------------- */
  valorEntregue(mesISO){
    const D = window.DB, S = window.Stock;
    if (!D || !S) return null;

    const mes = mesISO || new Date().toISOString().slice(0, 7);
    const movs = D.movimentacoes.all();
    const doMes = movs.filter(m => (m.data || '').slice(0, 7) === mes);
    const linhas = S.rows().filter(r => r.ativo);

    const soma = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

    const entradas = doMes.filter(m => m.tipo === 'entrada');
    const saidas   = doMes.filter(m => m.tipo === 'saida');
    const diretas  = doMes.filter(m => m.tipo === 'entrada_direta');
    const devol    = doMes.filter(m => m.tipo === 'devolucao');

    /* Material que voltou da obra em vez de sumir. É o ganho mais concreto:
       sem registro de devolução, sobra de obra vira perda silenciosa. */
    const valorDevolvido = soma(devol, m => m.valorTotal);

    /* Compras que o alerta de estoque mínimo ajudou a antecipar. */
    const emAlerta = linhas.filter(r => r.status !== 'normal');
    const valorReposicao = soma(emAlerta, r => r.repor * r.custo);

    return {
      mes,
      valorEstoque:    soma(linhas, r => r.valorTotal),
      itensControlados: linhas.length,
      movimentacoes:   doMes.length,
      entradas:        entradas.length,
      valorEntradas:   soma(entradas, m => m.valorTotal),
      saidas:          saidas.length,
      valorSaidas:     soma(saidas, m => m.valorTotal),
      diretas:         diretas.length,
      valorDiretas:    soma(diretas, m => m.valorTotal),
      devolucoes:      devol.length,
      valorDevolvido,
      alertas:         emAlerta.length,
      valorReposicao,
      obras:           D.obras.all().filter(o => o.status === 'andamento').length,
      notas:           D.notas.all().filter(n => (n.data || n.emissao || '').slice(0, 7) === mes).length,
      /* Total movimentado: o volume financeiro que passou pelo controle. */
      volumeTotal:     soma(doMes, m => m.valorTotal)
    };
  }
};

/* Disponibiliza para o index.html, que é script clássico e não enxerga módulos. */
export function instalarPonte(){
  window.ObraStockGestao = { Usuarios, Cobranca, ehDev, sessaoAtual };
}
