-- =============================================================================
--  ObraStock — Verificação da instalação
--  Execute DEPOIS do schema.sql. Não altera dados.
--  Todos os itens devem sair como OK.
-- =============================================================================

with esperado as (
  select * from (values
    ('tabela','empresas'),('tabela','perfis'),('tabela','categorias'),
    ('tabela','fornecedores'),('tabela','obras'),('tabela','materiais'),
    ('tabela','notas'),('tabela','nota_itens'),('tabela','movimentacoes')
  ) as t(tipo, nome)
),
checagens as (

  -- 1. Tabelas
  select 1 as ord, 'Tabelas criadas (9)' as item,
         case when count(*) = 9 then 'OK' else 'FALTA: ' || string_agg(e.nome, ', ') end as resultado
  from esperado e
  left join information_schema.tables t
    on t.table_schema = 'public' and t.table_name = e.nome
  where t.table_name is not null

  union all
  -- 2. Views
  select 2, 'Views criadas (3)',
         case when count(*) = 3 then 'OK'
              else 'ENCONTRADAS: ' || coalesce(string_agg(table_name, ', '), 'nenhuma') end
  from information_schema.views
  where table_schema = 'public'
    and table_name in ('vw_saldos','vw_estoque','vw_pendentes_obra')

  union all
  -- 3. security_invoker nas views  >>> CRÍTICO <<<
  --    Sem isto a view ignora a RLS e vaza dados entre construtoras.
  select 3, 'Views com security_invoker (CRITICO)',
         case when count(*) = 3 then 'OK'
              else 'FALHA — views sem a flag vazam dados entre empresas' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in ('vw_saldos','vw_estoque','vw_pendentes_obra')
    and 'security_invoker=true' = any (c.reloptions)

  union all
  -- 4. RLS habilitada
  select 4, 'RLS habilitada nas 9 tabelas',
         case when count(*) = 9 then 'OK'
              else 'SEM RLS: ' || coalesce(string_agg(relname, ', '), '?') end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and c.relname in ('empresas','perfis','categorias','fornecedores','obras',
                      'materiais','notas','nota_itens','movimentacoes')

  union all
  -- 5. Nenhuma tabela com RLS ativa e zero políticas (bloqueio silencioso)
  select 5, 'Nenhuma tabela com RLS e sem politica',
         case when count(*) = 0 then 'OK'
              else 'BLOQUEADAS: ' || string_agg(c.relname, ', ') end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname)

  union all
  -- 6. movimentacoes não pode ter política de DELETE
  select 6, 'Movimentacoes sem policy de DELETE',
         case when count(*) = 0 then 'OK' else 'FALHA: existe policy de DELETE' end
  from pg_policies
  where schemaname = 'public' and tablename = 'movimentacoes' and cmd = 'DELETE'

  union all
  -- 7. Triggers
  select 7, 'Triggers de regra de negocio (4)',
         case when count(*) = 4 then 'OK'
              else 'ENCONTRADOS: ' || coalesce(string_agg(tgname, ', '), 'nenhum') end
  from pg_trigger
  where not tgisinternal
    and tgname in ('trg_valida_mov','trg_valida_estorno','trg_custo_medio','trg_seed_categorias')

  union all
  -- 8. Trigger de criação de usuário
  select 8, 'Trigger de novo usuario em auth.users',
         case when count(*) = 1 then 'OK' else 'FALTANDO' end
  from pg_trigger where not tgisinternal and tgname = 'trg_novo_usuario'

  union all
  -- 9. Funções de contexto
  select 9, 'Funcoes fn_empresa_id / fn_papel',
         case when count(*) = 2 then 'OK' else 'FALTANDO' end
  from information_schema.routines
  where routine_schema = 'public' and routine_name in ('fn_empresa_id','fn_papel')

  union all
  -- 10. Constraints de integridade
  select 10, 'Constraints qtd_positiva e obra_obrigatoria',
         case when count(*) = 2 then 'OK' else 'FALTANDO' end
  from pg_constraint
  where conname in ('qtd_positiva','obra_obrigatoria')

  union all
  -- 11. Índice parcial da chave da NF-e
  select 11, 'Indice unico parcial da chave da NFe',
         case when count(*) = 1 then 'OK' else 'FALTANDO' end
  from pg_indexes where schemaname = 'public' and indexname = 'ux_notas_chave'

  union all
  -- 12. anon não pode ler nada
  select 12, 'Papel anon sem acesso a dados',
         case when count(*) = 0 then 'OK'
              else 'FALHA: anon tem acesso a ' || string_agg(table_name, ', ') end
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
)
select item, resultado from checagens order by ord;


-- -----------------------------------------------------------------------------
--  Resumo dos objetos
-- -----------------------------------------------------------------------------
select 'Politicas por tabela' as info, tablename, count(*) as qtd
from pg_policies where schemaname = 'public'
group by tablename order by tablename;
