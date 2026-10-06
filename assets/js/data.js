/* =============================================================================
   ObraStock — Camada de dados sobre o Supabase
   =============================================================================
   O protótipo foi escrito com um adaptador SÍNCRONO (LocalStorageAdapter) e as
   ~100 chamadas de leitura espalhadas pelas telas contam com isso. O Supabase
   é assíncrono. Reescrever todas as telas para async/await significaria mexer
   em praticamente todo o arquivo — exatamente o que combinamos não fazer.

   Solução: este adaptador mantém um ESPELHO EM MEMÓRIA dos dados da empresa.
     · Leituras  (list/get)        -> síncronas, direto do espelho. UI intacta.
     · Escritas  (insert/update..) -> aplicam no espelho na hora, devolvem o
       registro, e empurram para o servidor em segundo plano numa fila.
     · Se o servidor recusar, o espelho volta atrás e o usuário é avisado.

   O id é gerado no cliente (uuid v4) e enviado junto. Sem isso, um registro
   recém-criado não teria id estável e qualquer edição seguinte quebraria.

   Volume: uma construtora de médio porte gera alguns milhares de linhas por
   ano. Isso cabe folgado em memória. Se um dia passar disso, o caminho é
   paginar as movimentações antigas — as telas de relatório já filtram período.
============================================================================= */

import { getClient, traduzErro } from './supabase.js';
import { perfil } from './auth.js';

/* --------------------------------------------------------------------------
   CONVERSÃO snake_case  <->  camelCase
   O banco usa material_id; a interface usa materialId. A conversão é
   mecânica, então vale uma função genérica em vez de mapa campo a campo.
-------------------------------------------------------------------------- */
const paraCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const paraSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

function linhaParaUI(row){
  if (!row) return row;
  const out = {};
  for (const k in row) out[paraCamel(k)] = row[k];
  return out;
}
function linhaParaBanco(obj){
  const out = {};
  for (const k in obj){
    if (obj[k] === undefined) continue;
    out[paraSnake(k)] = obj[k];
  }
  return out;
}

/** Campos que existem só na interface e não têm coluna no banco. */
const IGNORAR = new Set(['mat', 'criadoEm', 'atualizadoEm']);
function limpar(obj){
  const out = {};
  for (const k in obj) if (!IGNORAR.has(k)) out[k] = obj[k];
  return out;
}

function uuid(){
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* Coleção da UI -> tabela do banco */
const TABELA = {
  materiais: 'materiais', obras: 'obras', fornecedores: 'fornecedores',
  movimentacoes: 'movimentacoes', notas: 'notas', categorias: 'categorias'
};

/* =============================================================================
   ADAPTADOR
============================================================================= */
export class SupabaseAdapter {
  constructor(sb, empresaId, perfilId){
    this.sb = sb;
    this.empresaId = empresaId;
    this.perfilId  = perfilId;
    this.cache = { materiais: [], obras: [], fornecedores: [],
                   movimentacoes: [], notas: [], categorias: [], config: [] };
    this.fila = Promise.resolve();   // serializa as escritas
    this.pendentes = 0;
    this.ok = true;
  }

  /* ---------------- carga inicial ---------------- */
  async carregar(){
    const sel = t => this.sb.from(t).select('*');
    const [mat, obr, forn, mov, nf, cat, emp] = await Promise.all([
      sel('materiais'), sel('obras'), sel('fornecedores'),
      this.sb.from('movimentacoes').select('*').order('data', { ascending: false }),
      sel('notas'), sel('categorias'),
      this.sb.from('empresas').select('*').eq('id', this.empresaId).single()
    ]);

    const erro = [mat, obr, forn, mov, nf, cat, emp].find(r => r.error);
    if (erro) throw new Error(traduzErro(erro.error));

    this.cache.materiais     = (mat.data  || []).map(linhaParaUI);
    this.cache.obras         = (obr.data  || []).map(linhaParaUI);
    this.cache.fornecedores  = (forn.data || []).map(linhaParaUI);
    this.cache.movimentacoes = (mov.data  || []).map(linhaParaUI);
    this.cache.notas         = (nf.data   || []).map(linhaParaUI);
    this.cache.categorias    = (cat.data  || []).map(linhaParaUI);

    const p = perfil() || {};
    const e = linhaParaUI(emp.data || {});
    this.cache.config = [{
      id: e.id,
      empresa: e.nome || '', cnpj: e.cnpj || '',
      galpao: e.galpao || 'Galpão Central',
      avisoBaixoPct:   e.avisoBaixoPct   ?? 100,
      avisoCriticoPct: e.avisoCriticoPct ?? 50,
      usuario: p.nome || '', cargo: p.cargo || ''
    }];

    return this;
  }

  /* ---------------- leituras (síncronas) ---------------- */
  list(c){ return this.cache[c] || []; }
  get(c, id){ return (this.cache[c] || []).find(r => r.id === id) || null; }

  /* ---------------- fila de escrita ---------------- */
  _enfileirar(tarefa){
    this.pendentes++;
    this._sinal();
    this.fila = this.fila
      .then(tarefa)
      .catch(e => console.error('[dados]', e))
      .finally(() => { this.pendentes--; this._sinal(); });
    return this.fila;
  }

  _sinal(){
    if (typeof window.ObraStockSync === 'function')
      window.ObraStockSync(this.pendentes);
  }

  _falhou(msg){
    this.ok = false;
    if (window.Toast && window.Toast.err) window.Toast.err('Não foi possível salvar', msg);
    else console.error('[dados]', msg);   // nunca alert(): trava a página inteira
    if (window.App && window.App.render) window.App.render();
  }

  /* ---------------- escritas (otimistas) ---------------- */
  insert(c, obj){
    const tabela = TABELA[c];
    const row = Object.assign({ id: uuid(), criadoEm: new Date().toISOString() }, obj);

    if (!tabela){                       // config não passa por aqui
      (this.cache[c] = this.cache[c] || []).push(row);
      return row;
    }

    this.cache[c].push(row);            // aparece na tela imediatamente

    const payload = linhaParaBanco(limpar(
      Object.assign({ empresaId: this.empresaId }, obj, { id: row.id })
    ));
    if (c === 'movimentacoes') payload.criado_por = this.perfilId;

    this._enfileirar(async () => {
      const { data, error } = await this.sb.from(tabela).insert(payload).select().single();
      if (error){
        // o servidor recusou: desfaz para a tela não mentir
        const i = this.cache[c].findIndex(r => r.id === row.id);
        if (i >= 0) this.cache[c].splice(i, 1);
        this._falhou(traduzErro(error));
        return;
      }
      // o banco pode ter calculado colunas (valor_total, custo médio); sincroniza
      const i = this.cache[c].findIndex(r => r.id === row.id);
      if (i >= 0) this.cache[c][i] = linhaParaUI(data);
      if (c === 'movimentacoes') await this._recarregarMateriais();
    });

    return row;
  }

  insertMany(c, arr){
    return arr.map(o => this.insert(c, o));
  }

  update(c, id, patch){
    const tabela = TABELA[c];
    const i = (this.cache[c] || []).findIndex(r => r.id === id);
    if (i < 0) return null;

    const anterior = this.cache[c][i];
    const novo = Object.assign({}, anterior, patch, { atualizadoEm: new Date().toISOString() });
    this.cache[c][i] = novo;
    if (!tabela) return novo;

    const payload = linhaParaBanco(limpar(patch));
    this._enfileirar(async () => {
      const { data, error } = await this.sb.from(tabela)
        .update(payload).eq('id', id).select().single();
      if (error){
        const j = this.cache[c].findIndex(r => r.id === id);
        if (j >= 0) this.cache[c][j] = anterior;      // volta ao valor antigo
        this._falhou(traduzErro(error));
        return;
      }
      const j = this.cache[c].findIndex(r => r.id === id);
      if (j >= 0) this.cache[c][j] = linhaParaUI(data);
    });
    return novo;
  }

  remove(c, id){
    const tabela = TABELA[c];
    const i = (this.cache[c] || []).findIndex(r => r.id === id);
    if (i < 0) return true;
    const anterior = this.cache[c][i];
    this.cache[c].splice(i, 1);
    if (!tabela) return true;

    this._enfileirar(async () => {
      const { error } = await this.sb.from(tabela).delete().eq('id', id);
      if (error){
        this.cache[c].push(anterior);                 // devolve para a lista
        this._falhou(traduzErro(error));
      }
    });
    return true;
  }

  /** As movimentações mexem no custo médio via trigger; relê os materiais. */
  async _recarregarMateriais(){
    const { data, error } = await this.sb.from('materiais').select('*');
    if (!error && data){
      this.cache.materiais = data.map(linhaParaUI);
      if (window.App && window.App.render) window.App.render();
    }
  }

  /* ---------------- config: empresa + perfil ---------------- */
  replaceAll(c, rows){ this.cache[c] = rows; return rows; }
  clear(c){ this.cache[c] = []; return []; }
  meta(){ return null; }

  salvarConfig(patch){
    const atual = this.cache.config[0] || {};
    const novo = Object.assign({}, atual, patch);
    this.cache.config[0] = novo;

    const daEmpresa = {};
    ['empresa', 'cnpj', 'galpao', 'avisoBaixoPct', 'avisoCriticoPct'].forEach(k => {
      if (patch[k] !== undefined) daEmpresa[k === 'empresa' ? 'nome' : k] = patch[k];
    });
    const doPerfil = {};
    if (patch.usuario !== undefined) doPerfil.nome  = patch.usuario;
    if (patch.cargo   !== undefined) doPerfil.cargo = patch.cargo;

    this._enfileirar(async () => {
      if (Object.keys(daEmpresa).length){
        const { error } = await this.sb.from('empresas')
          .update(linhaParaBanco(daEmpresa)).eq('id', this.empresaId);
        if (error) return this._falhou(traduzErro(error));
      }
      if (Object.keys(doPerfil).length){
        const { error } = await this.sb.from('perfis')
          .update(doPerfil).eq('id', this.perfilId);
        if (error) return this._falhou(traduzErro(error));
      }
    });
    return novo;
  }

  /** Espera a fila esvaziar — usado antes de sair ou fechar a aba. */
  async aguardar(){ await this.fila; }
}

/* =============================================================================
   INICIALIZAÇÃO
============================================================================= */
export async function iniciarDados(){
  const p = perfil();
  if (!p) throw new Error('Sem perfil carregado.');
  const sb = await getClient();
  const ad = new SupabaseAdapter(sb, p.empresaId || p.empresa_id, p.id);
  await ad.carregar();
  return ad;
}

/* Avisa antes de fechar a aba com gravações ainda na fila. */
export function protegerSaida(adapter){
  window.addEventListener('beforeunload', e => {
    if (adapter.pendentes > 0){ e.preventDefault(); e.returnValue = ''; }
  });
}
