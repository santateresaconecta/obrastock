-- =============================================================================
--  ObraStock v2.0 — Schema de produção
--  PostgreSQL / Supabase
--
--  Como usar:
--    1. Supabase → SQL Editor → New query
--    2. Cole este arquivo inteiro e execute (Run)
--    3. Execute depois o arquivo verificar.sql para conferir a instalação
--
--  Seguro para reexecutar: o script remove e recria seus próprios objetos.
--  ATENÇÃO: reexecutar NÃO apaga dados das tabelas já existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  0. EXTENSÕES
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
--  1. TIPOS
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'mov_tipo') then
    create type mov_tipo as enum ('entrada','saida','entrada_direta','devolucao','ajuste');
  end if;
  if not exists (select 1 from pg_type where typname = 'obra_status') then
    create type obra_status as enum ('andamento','planejada','concluida','pausada');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin','estoquista','visualizador');
  end if;
end $$;


-- -----------------------------------------------------------------------------
--  2. TABELAS
-- -----------------------------------------------------------------------------

create table if not exists empresas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  cnpj              text,
  galpao            text not null default 'Galpão Central',
  aviso_baixo_pct   int  not null default 100,
  aviso_critico_pct int  not null default 50,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz
);
comment on table empresas is 'Tenant. Cada construtora é uma empresa; todo dado é isolado por empresa_id.';

create table if not exists perfis (
  id            uuid primary key references auth.users on delete cascade,
  empresa_id    uuid not null references empresas on delete cascade,
  nome          text not null,
  cargo         text,
  papel         user_role not null default 'estoquista',
  tema          text not null default 'auto',   -- 'auto' | 'light' | 'dark'
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz
);
comment on column perfis.papel is 'admin = tudo | estoquista = movimenta e cadastra | visualizador = somente leitura';
comment on column perfis.tema  is 'Preferência de modo escuro, sincronizada entre dispositivos.';
create index if not exists ix_perfis_empresa on perfis (empresa_id);

create table if not exists categorias (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas on delete cascade,
  nome          text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,
  unique (empresa_id, nome)
);

create table if not exists fornecedores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas on delete cascade,
  razao_social  text not null,
  fantasia      text,
  cnpj          text,
  telefone      text,
  email         text,
  cidade        text,
  obs           text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists ix_forn_empresa on fornecedores (empresa_id);

create table if not exists obras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas on delete cascade,
  nome          text not null,
  codigo        text,
  endereco      text,
  responsavel   text,
  inicio        date,
  status        obra_status not null default 'planejada',
  obs           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,
  unique (empresa_id, codigo)
);
create index if not exists ix_obras_empresa on obras (empresa_id, status);

create table if not exists materiais (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas on delete cascade,
  codigo         text not null,
  descricao      text not null,
  categoria      text not null,
  unidade        text not null,
  estoque_minimo numeric(14,3) not null default 0,
  estoque_ideal  numeric(14,3) not null default 0,
  custo_medio    numeric(14,2) not null default 0,
  ean            text,
  cod_fornecedor text,
  fornecedor_id  uuid references fornecedores on delete set null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,
  unique (empresa_id, codigo)
);
create index if not exists ix_mat_empresa    on materiais (empresa_id, ativo);
create index if not exists ix_mat_categoria  on materiais (empresa_id, categoria);

create table if not exists notas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas on delete cascade,
  numero            text not null,
  serie             text,
  chave             text,
  emissao           date,
  fornecedor_id     uuid references fornecedores on delete set null,
  emitente_nome     text,
  emitente_cnpj     text,
  destinatario_cnpj text,
  valor_total       numeric(14,2) not null default 0,
  origem            text not null default 'manual',  -- 'manual' | 'xml'
  destino           text not null default 'galpao',  -- 'galpao' | 'obra'
  obra_id           uuid references obras on delete set null,
  xml_bruto         text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz
);
create index if not exists ix_notas_empresa on notas (empresa_id, emissao desc);

-- Índice parcial: nota manual não tem chave. UNIQUE simples deixaria
-- várias notas com chave '' colidirem entre si.
create unique index if not exists ux_notas_chave
  on notas (empresa_id, chave) where chave is not null and chave <> '';

create table if not exists nota_itens (
  id             uuid primary key default gen_random_uuid(),
  nota_id        uuid not null references notas on delete cascade,
  material_id    uuid references materiais on delete set null,
  descricao      text not null,
  ncm            text,
  cfop           text,
  ean            text,
  quantidade     numeric(14,3) not null,
  unidade        text,
  valor_unitario numeric(14,4) not null default 0,
  valor_total    numeric(14,2) not null default 0
);
create index if not exists ix_itens_nota on nota_itens (nota_id);

create table if not exists movimentacoes (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas on delete cascade,
  tipo           mov_tipo not null,
  data           date not null default current_date,
  material_id    uuid not null references materiais on delete restrict,
  material_desc  text not null,
  unidade        text,
  quantidade     numeric(14,3) not null,
  valor_unitario numeric(14,4) not null default 0,
  valor_total    numeric(14,2) not null default 0,
  obra_id        uuid references obras on delete set null,
  fornecedor_id  uuid references fornecedores on delete set null,
  nota_id        uuid references notas on delete set null,
  nf_numero      text,
  origem         text,
  destino        text,
  responsavel    text,
  observacao     text,
  criado_por     uuid references perfis on delete set null,
  criado_em      timestamptz not null default now(),
  estornada_em   timestamptz,
  estornada_por  uuid references perfis on delete set null,
  estorno_motivo text,

  constraint qtd_positiva check (
    (tipo = 'ajuste' and quantidade <> 0) or (tipo <> 'ajuste' and quantidade > 0)
  ),
  constraint obra_obrigatoria check (
    tipo not in ('saida','entrada_direta','devolucao') or obra_id is not null
  )
);
comment on table movimentacoes is
  'Livro-razão do estoque. Nunca se apaga: estorno é lógico (estornada_em).';

create index if not exists ix_mov_data     on movimentacoes (empresa_id, data desc);
create index if not exists ix_mov_material on movimentacoes (empresa_id, material_id) where estornada_em is null;
create index if not exists ix_mov_obra     on movimentacoes (empresa_id, obra_id)     where estornada_em is null;
create index if not exists ix_mov_tipo     on movimentacoes (empresa_id, tipo);


-- -----------------------------------------------------------------------------
--  3. FUNÇÕES DE CONTEXTO
--     SECURITY DEFINER de propósito: precisam ler 'perfis' ignorando a RLS,
--     senão a política de 'perfis' chamaria a si mesma em recursão.
-- -----------------------------------------------------------------------------
create or replace function fn_empresa_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select empresa_id from perfis where id = auth.uid() and ativo $$;

create or replace function fn_papel()
returns user_role
language sql stable security definer set search_path = public
as $$ select papel from perfis where id = auth.uid() and ativo $$;


-- -----------------------------------------------------------------------------
--  4. VIEWS
--
--  security_invoker = true é OBRIGATÓRIO.
--  Sem ele a view roda com os privilégios do dono (postgres) e IGNORA a RLS
--  das tabelas de baixo — qualquer usuário autenticado leria o estoque de
--  todas as construtoras. Testado: sem a flag, a view devolve as duas empresas.
-- -----------------------------------------------------------------------------

drop view if exists vw_estoque cascade;
drop view if exists vw_saldos cascade;
drop view if exists vw_pendentes_obra cascade;

-- Saldo de cada material no galpão.
-- entrada_direta é ignorada de propósito: não passa pelo estoque principal.
create view vw_saldos with (security_invoker = true) as
select
  m.empresa_id,
  m.id as material_id,
  coalesce(sum(
    case mv.tipo
      when 'entrada'   then  mv.quantidade
      when 'devolucao' then  mv.quantidade
      when 'saida'     then -mv.quantidade
      when 'ajuste'    then  mv.quantidade
      else 0
    end
  ), 0)::numeric(14,3) as saldo
from materiais m
left join movimentacoes mv
  on mv.material_id = m.id and mv.estornada_em is null
group by m.empresa_id, m.id;

-- Estoque consolidado com status e sugestão de reposição.
create view vw_estoque with (security_invoker = true) as
select
  m.*,
  s.saldo,
  round(s.saldo * m.custo_medio, 2) as valor_total,
  case
    when s.saldo <= 0 then 'zerado'
    when m.estoque_minimo <= 0 then 'normal'
    when s.saldo <= m.estoque_minimo * 0.5 then 'critico'
    when s.saldo <= m.estoque_minimo then 'baixo'
    else 'normal'
  end as status,
  greatest(0, coalesce(nullif(m.estoque_ideal, 0), m.estoque_minimo) - s.saldo) as repor
from materiais m
join vw_saldos s on s.material_id = m.id;

-- Quanto cada obra ainda tem em mãos (enviado - devolvido).
-- Base da devolução e do consumo líquido por obra.
create view vw_pendentes_obra with (security_invoker = true) as
select
  mv.empresa_id,
  mv.obra_id,
  mv.material_id,
  max(mv.material_desc) as material_desc,
  max(mv.unidade)       as unidade,
  sum(case when mv.tipo = 'saida'     then mv.quantidade else 0 end) as enviado,
  sum(case when mv.tipo = 'devolucao' then mv.quantidade else 0 end) as devolvido,
  sum(case when mv.tipo = 'saida'     then  mv.quantidade
           when mv.tipo = 'devolucao' then -mv.quantidade else 0 end) as pendente,
  case when sum(case when mv.tipo = 'saida' then mv.quantidade else 0 end) > 0
       then round(
              sum(case when mv.tipo = 'saida' then mv.quantidade * mv.valor_unitario else 0 end)
              / nullif(sum(case when mv.tipo = 'saida' then mv.quantidade else 0 end), 0), 2)
       else 0 end as custo_unitario
from movimentacoes mv
where mv.tipo in ('saida','devolucao') and mv.estornada_em is null
group by mv.empresa_id, mv.obra_id, mv.material_id
having sum(case when mv.tipo = 'saida'     then  mv.quantidade
                when mv.tipo = 'devolucao' then -mv.quantidade else 0 end) > 0;


-- -----------------------------------------------------------------------------
--  5. REGRAS DE NEGÓCIO (triggers)
-- -----------------------------------------------------------------------------

-- 5.1 Trava de saldo. É isto que torna a regra inviolável: a validação do
--     navegador é conveniência, esta é a que vale.
create or replace function fn_valida_movimentacao()
returns trigger language plpgsql as $$
declare v_saldo numeric; v_pend numeric;
begin
  if new.tipo = 'saida' then
    select saldo into v_saldo from vw_saldos where material_id = new.material_id;
    if coalesce(v_saldo, 0) < new.quantidade then
      raise exception 'Estoque insuficiente. Disponível: % %',
        coalesce(v_saldo, 0), coalesce(new.unidade, 'UN')
        using errcode = 'P0001';
    end if;
  end if;

  if new.tipo = 'devolucao' then
    select pendente into v_pend from vw_pendentes_obra
      where obra_id = new.obra_id and material_id = new.material_id;
    if coalesce(v_pend, 0) < new.quantidade then
      raise exception 'Devolução maior que o enviado. Na obra: % %',
        coalesce(v_pend, 0), coalesce(new.unidade, 'UN')
        using errcode = 'P0002';
    end if;
  end if;

  new.empresa_id := coalesce(fn_empresa_id(), new.empresa_id);
  new.criado_por := coalesce(auth.uid(), new.criado_por);
  return new;
end $$;

drop trigger if exists trg_valida_mov on movimentacoes;
create trigger trg_valida_mov
before insert on movimentacoes
for each row execute function fn_valida_movimentacao();


-- 5.2 Trava de estorno. Sem ela, estornar uma entrada antiga deixa o saldo
--     negativo. O estorno tem de respeitar a ordem das dependências.
create or replace function fn_valida_estorno()
returns trigger language plpgsql as $$
declare v_saldo numeric; v_pend numeric; v_delta numeric;
begin
  if new.estornada_em is null or old.estornada_em is not null then
    return new;                       -- não é um estorno acontecendo agora
  end if;

  v_delta := case old.tipo
               when 'entrada'   then  old.quantidade
               when 'devolucao' then  old.quantidade
               when 'ajuste'    then  old.quantidade
               when 'saida'     then -old.quantidade
               else 0 end;            -- entrada_direta não afeta o galpão

  if v_delta <> 0 then
    select saldo into v_saldo from vw_saldos where material_id = old.material_id;
    if coalesce(v_saldo, 0) - v_delta < 0 then
      raise exception 'Estorno deixaria o estoque negativo. Saldo atual: % %. Estorne antes as saídas posteriores.',
        coalesce(v_saldo, 0), coalesce(old.unidade, 'UN')
        using errcode = 'P0003';
    end if;
  end if;

  if old.tipo = 'saida' then
    select pendente into v_pend from vw_pendentes_obra
      where obra_id = old.obra_id and material_id = old.material_id;
    if coalesce(v_pend, 0) - old.quantidade < 0 then
      raise exception 'Estorno inválido: já houve devolução deste material nesta obra. Estorne a devolução primeiro.'
        using errcode = 'P0004';
    end if;
  end if;

  new.estornada_por := coalesce(auth.uid(), new.estornada_por);
  return new;
end $$;

drop trigger if exists trg_valida_estorno on movimentacoes;
create trigger trg_valida_estorno
before update on movimentacoes
for each row execute function fn_valida_estorno();


-- 5.3 Custo médio ponderado, recalculado a cada entrada no galpão.
create or replace function fn_atualiza_custo_medio()
returns trigger language plpgsql as $$
declare v_custo numeric;
begin
  select round(sum(quantidade * valor_unitario) / nullif(sum(quantidade), 0), 2)
    into v_custo
  from movimentacoes
  where material_id = new.material_id
    and tipo = 'entrada'
    and estornada_em is null
    and quantidade > 0
    and valor_unitario > 0;

  if v_custo is not null and v_custo > 0 then
    update materiais set custo_medio = v_custo where id = new.material_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_custo_medio on movimentacoes;
create trigger trg_custo_medio
after insert on movimentacoes
for each row when (new.tipo = 'entrada')
execute function fn_atualiza_custo_medio();


-- 5.4 atualizado_em automático (paridade com o adapter do protótipo).
create or replace function fn_touch()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas','perfis','categorias','fornecedores',
                           'obras','materiais','notas'] loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$I', t);
    execute format('create trigger trg_touch_%1$s before update on %1$I
                    for each row execute function fn_touch()', t);
  end loop;
end $$;


-- 5.5 Novo usuário: cria o perfil e, se necessário, a empresa.
--     As categorias padrão são semeadas junto com a empresa (5.6).
create or replace function fn_novo_usuario()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_empresa uuid;
begin
  v_empresa := nullif(new.raw_user_meta_data->>'empresa_id', '')::uuid;

  if v_empresa is null then
    insert into empresas (nome, cnpj)
    values (coalesce(nullif(new.raw_user_meta_data->>'empresa',''), 'Minha Construtora'),
            nullif(new.raw_user_meta_data->>'cnpj',''))
    returning id into v_empresa;
  end if;

  insert into perfis (id, empresa_id, nome, cargo, papel)
  values (
    new.id,
    v_empresa,
    coalesce(nullif(new.raw_user_meta_data->>'nome',''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'cargo',''),
    coalesce(nullif(new.raw_user_meta_data->>'papel','')::user_role, 'admin')
  );
  return new;
end $$;

drop trigger if exists trg_novo_usuario on auth.users;
create trigger trg_novo_usuario
after insert on auth.users
for each row execute function fn_novo_usuario();


-- 5.6 Categorias padrão para cada empresa nova.
create or replace function fn_seed_categorias()
returns trigger language plpgsql as $$
begin
  insert into categorias (empresa_id, nome)
  select new.id, c from unnest(array[
    'Cimento','Areia','Brita','Tijolos','Blocos','Ferragens','Tubulações',
    'Elétrica','Hidráulica','Argamassa','Madeira','Ferramentas','EPIs','Outros'
  ]) as c
  on conflict (empresa_id, nome) do nothing;
  return null;
end $$;

drop trigger if exists trg_seed_categorias on empresas;
create trigger trg_seed_categorias
after insert on empresas
for each row execute function fn_seed_categorias();


-- -----------------------------------------------------------------------------
--  6. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table empresas      enable row level security;
alter table perfis        enable row level security;
alter table categorias    enable row level security;
alter table fornecedores  enable row level security;
alter table obras         enable row level security;
alter table materiais     enable row level security;
alter table notas         enable row level security;
alter table nota_itens    enable row level security;
alter table movimentacoes enable row level security;

-- limpa políticas anteriores para permitir reexecução
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 6.1 Empresa e perfis
create policy sel_empresa on empresas for select
  using (id = fn_empresa_id());
create policy upd_empresa on empresas for update
  using (id = fn_empresa_id() and fn_papel() = 'admin');

create policy sel_perfis on perfis for select
  using (empresa_id = fn_empresa_id());
create policy ins_perfis on perfis for insert
  with check (empresa_id = fn_empresa_id() and fn_papel() = 'admin');
-- o próprio usuário edita seu tema/nome; admin edita qualquer um da empresa
create policy upd_perfis on perfis for update
  using (id = auth.uid() or (empresa_id = fn_empresa_id() and fn_papel() = 'admin'));

-- 6.2 Cadastros — gerado em laço.
--     Copiar à mão convida a esquecer uma tabela, e tabela com RLS ativa e
--     zero políticas bloqueia todo acesso silenciosamente.
do $$
declare t text;
begin
  foreach t in array array['categorias','fornecedores','obras','materiais','notas'] loop
    execute format($f$create policy sel_%1$s on %1$I for select
      using (empresa_id = fn_empresa_id())$f$, t);
    execute format($f$create policy ins_%1$s on %1$I for insert
      with check (empresa_id = fn_empresa_id() and fn_papel() in ('admin','estoquista'))$f$, t);
    execute format($f$create policy upd_%1$s on %1$I for update
      using (empresa_id = fn_empresa_id() and fn_papel() in ('admin','estoquista'))$f$, t);
    execute format($f$create policy del_%1$s on %1$I for delete
      using (empresa_id = fn_empresa_id() and fn_papel() = 'admin')$f$, t);
  end loop;
end $$;

-- 6.3 Movimentações — sem política de DELETE: ninguém apaga, só estorna.
create policy sel_mov on movimentacoes for select
  using (empresa_id = fn_empresa_id());
create policy ins_mov on movimentacoes for insert
  with check (empresa_id = fn_empresa_id() and fn_papel() in ('admin','estoquista'));
create policy upd_mov on movimentacoes for update
  using (empresa_id = fn_empresa_id() and fn_papel() in ('admin','estoquista'));

-- 6.4 Itens de nota — herdam o acesso da nota.
create policy sel_itens on nota_itens for select
  using (exists (select 1 from notas n where n.id = nota_id and n.empresa_id = fn_empresa_id()));
create policy ins_itens on nota_itens for insert
  with check (exists (select 1 from notas n where n.id = nota_id and n.empresa_id = fn_empresa_id())
              and fn_papel() in ('admin','estoquista'));
create policy upd_itens on nota_itens for update
  using (exists (select 1 from notas n where n.id = nota_id and n.empresa_id = fn_empresa_id())
         and fn_papel() in ('admin','estoquista'));
create policy del_itens on nota_itens for delete
  using (exists (select 1 from notas n where n.id = nota_id and n.empresa_id = fn_empresa_id())
         and fn_papel() = 'admin');


-- -----------------------------------------------------------------------------
--  7. PERMISSÕES
--     'authenticated' e 'anon' são os papéis padrão do Supabase.
--
--     O Supabase configura DEFAULT PRIVILEGES que concedem acesso a anon e
--     authenticated em toda tabela nova do schema public. Verificado em teste:
--     sem o revoke abaixo, o papel anon recebe grants nas 9 tabelas e nas 3
--     views. Hoje a RLS o bloqueia (0 linhas), mas basta alguém criar uma
--     policy permissiva ou desativar a RLS numa tabela para o dado vazar sem
--     login. Revogar é defesa em profundidade: sem login, nada.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  empresas, perfis, categorias, fornecedores, obras,
  materiais, notas, nota_itens, movimentacoes
  to authenticated;

grant select on vw_saldos, vw_estoque, vw_pendentes_obra to authenticated;

grant execute on function fn_empresa_id(), fn_papel() to authenticated;


-- =============================================================================
--  FIM. Execute verificar.sql para conferir a instalação.
-- =============================================================================
