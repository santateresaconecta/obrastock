-- =============================================================================
-- ObraStock — função de "sinal de vida" para o plano Free do Supabase
-- =============================================================================
-- O plano Free pausa o projeto após 7 dias sem ATIVIDADE NO BANCO. Abrir o
-- painel do Supabase não conta: é preciso que uma consulta chegue ao Postgres.
--
-- Esta função existe só para ser chamada por um agendador. Ela não lê nem
-- escreve nada de ninguém: devolve o horário do servidor. Mesmo assim é uma
-- consulta real, então o relógio da inatividade zera.
--
-- Execute uma vez no SQL Editor, depois do schema.sql.
-- =============================================================================

create or replace function public.fn_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select now();
$$;

comment on function public.fn_ping() is
  'Sinal de vida para evitar a pausa automática do plano Free. Não expõe dados.';

-- O agendador usa a chave anon, que é pública. Por isso a função não pode
-- revelar nada — e não revela: só o horário do servidor.
revoke all on function public.fn_ping() from public;
grant execute on function public.fn_ping() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Conferência
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_ping'
  ) then
    raise exception 'fn_ping não foi criada';
  end if;
  raise notice 'OK — fn_ping criada. Teste com: select public.fn_ping();';
end $$;
