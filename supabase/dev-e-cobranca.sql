-- =============================================================================
-- ObraStock — Acesso de desenvolvedor, contrato e cobrança
-- =============================================================================
-- Execute no SQL Editor DEPOIS de schema.sql e ping.sql.
-- Pode ser executado mais de uma vez sem problema.
--
-- O que este script faz:
--   1. Cria o nível "desenvolvedor", acima do admin do cliente, identificado
--      por e-mail.
--   2. Passa a permitir que SÓ o desenvolvedor crie e altere usuários.
--   3. Cria contrato e cobranças mensais, que o cliente lê mas não edita.
--
-- >>> ANTES DE EXECUTAR: troque o e-mail na seção 1. <<<
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. QUEM É DESENVOLVEDOR
--
--  Guardado em tabela, não no código. Assim dá para acrescentar um sócio ou
--  revogar um acesso sem republicar o sistema.
-- -----------------------------------------------------------------------------
create table if not exists desenvolvedores (
  email      text primary key,
  nome       text,
  criado_em  timestamptz not null default now()
);

comment on table desenvolvedores is
  'E-mails com poder de desenvolvedor: gerenciam usuários e cobrança de todas as empresas.';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- TROQUE O E-MAIL ABAIXO PELO SEU (o mesmo que você usa para entrar)
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
insert into desenvolvedores (email, nome)
values ('polo.lemos@gmail.com', 'Desenvolvedor')
on conflict (email) do nothing;


-- A tabela só pode ser lida pelo próprio desenvolvedor. Se o admin do cliente
-- pudesse ler, saberia exatamente qual conta atacar para virar dono de tudo.
alter table desenvolvedores enable row level security;

create or replace function fn_eh_dev()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from desenvolvedores
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

comment on function fn_eh_dev() is
  'true quando o usuário autenticado está na lista de desenvolvedores.';

do $$
begin
  drop policy if exists sel_devs on desenvolvedores;
  drop policy if exists ins_devs on desenvolvedores;
  drop policy if exists upd_devs on desenvolvedores;
  drop policy if exists del_devs on desenvolvedores;
end $$;

create policy sel_devs on desenvolvedores for select using (fn_eh_dev());
create policy ins_devs on desenvolvedores for insert with check (fn_eh_dev());
create policy upd_devs on desenvolvedores for update using (fn_eh_dev());
create policy del_devs on desenvolvedores for delete using (fn_eh_dev());

revoke all on desenvolvedores from anon;


-- -----------------------------------------------------------------------------
--  2. SÓ O DESENVOLVEDOR MEXE EM USUÁRIOS
--
--  Antes: o admin do cliente criava e editava perfis.
--  Agora: o admin continua VENDO a equipe, mas quem cria, muda papel ou
--  desativa é o desenvolvedor. Cada um segue podendo editar o próprio
--  nome e tema — senão ninguém consegue nem trocar o modo escuro.
-- -----------------------------------------------------------------------------
do $$
begin
  drop policy if exists sel_perfis on perfis;
  drop policy if exists ins_perfis on perfis;
  drop policy if exists upd_perfis on perfis;
  drop policy if exists del_perfis on perfis;
end $$;

-- o desenvolvedor enxerga todas as empresas; o cliente, só a dele
create policy sel_perfis on perfis for select
  using (fn_eh_dev() or empresa_id = fn_empresa_id());

-- criar usuário: só desenvolvedor
-- (o trigger de novo usuário roda como definer e não passa por aqui)
create policy ins_perfis on perfis for insert
  with check (fn_eh_dev());

-- alterar: o próprio usuário em si mesmo, ou o desenvolvedor em qualquer um
create policy upd_perfis on perfis for update
  using (id = auth.uid() or fn_eh_dev())
  with check (id = auth.uid() or fn_eh_dev());

-- remover perfil: só desenvolvedor
create policy del_perfis on perfis for delete
  using (fn_eh_dev());


-- Um usuário comum não pode se promover a admin editando o próprio perfil.
-- A policy acima deixa ele alterar a própria linha — inclusive a coluna papel.
-- Este gatilho fecha a brecha.
create or replace function fn_protege_perfil()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  papel_jwt text := coalesce(auth.jwt() ->> 'role', '');
begin
  -- Contexto de servidor: a Edge Function de gestão de usuários usa a chave
  -- service_role, que não tem "sub" nenhum. Sem esta saída, o próprio
  -- mecanismo oficial de criar e promover usuários ficaria bloqueado — e o
  -- mesmo vale para você rodando um UPDATE no SQL Editor.
  if papel_jwt = 'service_role' or auth.uid() is null then
    return new;
  end if;

  if fn_eh_dev() then
    return new;                    -- desenvolvedor pode tudo
  end if;

  if new.papel is distinct from old.papel then
    raise exception 'Somente o desenvolvedor pode alterar o papel de um usuário'
      using errcode = 'P0005';
  end if;
  if new.ativo is distinct from old.ativo then
    raise exception 'Somente o desenvolvedor pode ativar ou desativar um usuário'
      using errcode = 'P0005';
  end if;
  if new.empresa_id is distinct from old.empresa_id then
    raise exception 'Não é possível mudar o usuário de empresa'
      using errcode = 'P0005';
  end if;
  return new;
end $$;

drop trigger if exists tg_protege_perfil on perfis;
create trigger tg_protege_perfil
  before update on perfis
  for each row execute function fn_protege_perfil();


-- -----------------------------------------------------------------------------
--  2b. EMPRESAS — o desenvolvedor precisa enxergar todas
--
--  Sem isto, o dev lê os perfis de todos os clientes mas não os nomes das
--  empresas: qualquer tela que junte as duas tabelas volta vazia, e a
--  cobrança fica sem saber de quem é cada contrato.
--  O cliente continua restrito à própria empresa — nada muda para ele.
-- -----------------------------------------------------------------------------
do $$
begin
  drop policy if exists sel_empresa on empresas;
  drop policy if exists upd_empresa on empresas;
end $$;

create policy sel_empresa on empresas for select
  using (id = fn_empresa_id() or fn_eh_dev());

create policy upd_empresa on empresas for update
  using ((id = fn_empresa_id() and fn_papel() = 'admin') or fn_eh_dev());


-- -----------------------------------------------------------------------------
--  3. CONTRATO
--
--  Uma linha por empresa: o que foi combinado e quanto custa por mês.
--  O cliente lê (transparência); só o desenvolvedor altera.
-- -----------------------------------------------------------------------------
create table if not exists contratos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null unique references empresas on delete cascade,
  plano            text not null default 'Sustentação mensal',
  valor_mensal     numeric(12,2) not null default 350.00,
  dia_vencimento   int not null default 10 check (dia_vencimento between 1 and 28),
  inicio           date not null default current_date,
  fim              date,
  status           text not null default 'ativo'
                     check (status in ('ativo','suspenso','encerrado')),
  valor_implantacao numeric(12,2) default 0,
  inclui           text[] not null default array[
                     'Hospedagem e banco de dados',
                     'Backup mensal dos dados',
                     'Correções de falhas',
                     'Suporte por WhatsApp em horário comercial',
                     'Pequenos ajustes e melhorias contínuas',
                     'Monitoramento e disponibilidade'
                   ],
  observacao       text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz
);

comment on table contratos is 'Condições comerciais por empresa. Cliente lê, desenvolvedor edita.';

alter table contratos enable row level security;

do $$
begin
  drop policy if exists sel_contratos on contratos;
  drop policy if exists ins_contratos on contratos;
  drop policy if exists upd_contratos on contratos;
  drop policy if exists del_contratos on contratos;
end $$;

create policy sel_contratos on contratos for select
  using (fn_eh_dev() or empresa_id = fn_empresa_id());
create policy ins_contratos on contratos for insert with check (fn_eh_dev());
create policy upd_contratos on contratos for update using (fn_eh_dev());
create policy del_contratos on contratos for delete using (fn_eh_dev());

revoke all on contratos from anon;


-- -----------------------------------------------------------------------------
--  4. COBRANÇAS MENSAIS
-- -----------------------------------------------------------------------------
create table if not exists cobrancas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas on delete cascade,
  competencia    date not null,                      -- sempre o dia 1 do mês
  descricao      text not null default 'Sustentação mensal do sistema',
  valor          numeric(12,2) not null,
  vencimento     date not null,
  pago_em        date,
  metodo         text,                               -- PIX, boleto, transferência
  observacao     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,
  unique (empresa_id, competencia)
);

comment on table cobrancas is 'Uma linha por mês de sustentação. Cliente lê, desenvolvedor edita.';
create index if not exists ix_cobr_empresa on cobrancas (empresa_id, competencia desc);

alter table cobrancas enable row level security;

do $$
begin
  drop policy if exists sel_cobrancas on cobrancas;
  drop policy if exists ins_cobrancas on cobrancas;
  drop policy if exists upd_cobrancas on cobrancas;
  drop policy if exists del_cobrancas on cobrancas;
end $$;

create policy sel_cobrancas on cobrancas for select
  using (fn_eh_dev() or empresa_id = fn_empresa_id());
create policy ins_cobrancas on cobrancas for insert with check (fn_eh_dev());
create policy upd_cobrancas on cobrancas for update using (fn_eh_dev());
create policy del_cobrancas on cobrancas for delete using (fn_eh_dev());

revoke all on cobrancas from anon;

drop trigger if exists tg_touch_contratos on contratos;
create trigger tg_touch_contratos before update on contratos
  for each row execute function fn_touch();
drop trigger if exists tg_touch_cobrancas on cobrancas;
create trigger tg_touch_cobrancas before update on cobrancas
  for each row execute function fn_touch();


-- -----------------------------------------------------------------------------
--  5. GERAR A COBRANÇA DO MÊS
--
--  Chamada pelo sistema quando o desenvolvedor abre a tela de contrato.
--  Não duplica: se a competência já existe, devolve a que existe.
-- -----------------------------------------------------------------------------
create or replace function fn_gerar_cobranca(p_empresa uuid, p_competencia date default null)
returns cobrancas
language plpgsql security definer set search_path = public
as $$
declare
  c   contratos%rowtype;
  cmp date;
  out_row cobrancas%rowtype;
begin
  if not fn_eh_dev() then
    raise exception 'Somente o desenvolvedor pode gerar cobranças' using errcode = 'P0005';
  end if;

  select * into c from contratos where empresa_id = p_empresa;
  if not found then
    raise exception 'Esta empresa ainda não tem contrato cadastrado' using errcode = 'P0006';
  end if;

  cmp := date_trunc('month', coalesce(p_competencia, current_date))::date;

  select * into out_row from cobrancas
   where empresa_id = p_empresa and competencia = cmp;
  if found then
    return out_row;
  end if;

  insert into cobrancas (empresa_id, competencia, valor, vencimento, descricao)
  values (p_empresa, cmp, c.valor_mensal,
          (cmp + (c.dia_vencimento - 1) * interval '1 day')::date,
          c.plano)
  returning * into out_row;

  return out_row;
end $$;

revoke all on function fn_gerar_cobranca(uuid, date) from public, anon;
grant execute on function fn_gerar_cobranca(uuid, date) to authenticated;


-- -----------------------------------------------------------------------------
--  5b. LIMPAR EMPRESAS ÓRFÃS
--
--  O trigger fn_novo_usuario cria uma empresa para todo login novo — é o que
--  faz o cadastro do primeiro usuário funcionar sozinho. Mas quando o
--  desenvolvedor cria alguém para uma empresa JÁ existente, essa empresa
--  recém-criada fica vazia. Esta função recolhe o lixo.
-- -----------------------------------------------------------------------------
create or replace function fn_limpar_empresas_vazias()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  removidas int;
begin
  if not (fn_eh_dev() or coalesce(auth.jwt() ->> 'role','') = 'service_role' or auth.uid() is null) then
    raise exception 'Somente o desenvolvedor pode executar esta limpeza' using errcode = 'P0005';
  end if;

  with vazias as (
    delete from empresas e
     where not exists (select 1 from perfis       p where p.empresa_id = e.id)
       and not exists (select 1 from materiais    m where m.empresa_id = e.id)
       and not exists (select 1 from obras        o where o.empresa_id = e.id)
       and not exists (select 1 from movimentacoes v where v.empresa_id = e.id)
       and not exists (select 1 from contratos    c where c.empresa_id = e.id)
    returning 1
  )
  select count(*) into removidas from vazias;

  return removidas;
end $$;

revoke all on function fn_limpar_empresas_vazias() from public, anon;
grant execute on function fn_limpar_empresas_vazias() to authenticated, service_role;


-- -----------------------------------------------------------------------------
--  6. CONFERÊNCIA
-- -----------------------------------------------------------------------------
do $$
declare
  faltando text := '';
  achou int;
begin
  if not exists (select 1 from pg_proc where proname = 'fn_eh_dev')
    then faltando := faltando || 'fn_eh_dev '; end if;
  if not exists (select 1 from pg_tables where tablename = 'desenvolvedores')
    then faltando := faltando || 'desenvolvedores '; end if;
  if not exists (select 1 from pg_tables where tablename = 'contratos')
    then faltando := faltando || 'contratos '; end if;
  if not exists (select 1 from pg_tables where tablename = 'cobrancas')
    then faltando := faltando || 'cobrancas '; end if;
  if not exists (select 1 from pg_trigger where tgname = 'tg_protege_perfil')
    then faltando := faltando || 'tg_protege_perfil '; end if;

  if faltando <> '' then
    raise exception 'FALTOU: %', faltando;
  end if;

  -- Ainda com o e-mail de exemplo? Então ninguém é desenvolvedor de fato.
  if exists (select 1 from desenvolvedores where email ilike 'SEU-EMAIL@%') then
    raise warning 'ATENÇÃO: o e-mail de desenvolvedor ainda é o de exemplo. Troque-o antes de usar.';
  end if;

  -- O login do desenvolvedor já existe no Auth?
  select count(*) into achou
    from auth.users where lower(email) = 'polo.lemos@gmail.com';

  if achou = 0 then
    raise warning 'O e-mail polo.lemos@gmail.com ainda não tem login no Auth. '
                  'Crie a conta (ou faça o primeiro acesso) para o acesso de desenvolvedor valer.';
  else
    raise notice 'Login do desenvolvedor encontrado no Auth — acesso liberado.';
  end if;

  raise notice 'OK — desenvolvedor, contrato e cobrança instalados.';
end $$;
