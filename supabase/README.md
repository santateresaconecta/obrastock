# Etapa 1 — Banco de dados no Supabase

Arquivos desta pasta:

| Arquivo | O que é |
|---|---|
| `schema.sql` | Script completo: tabelas, views, regras, segurança. É o que você executa. |
| `verificar.sql` | 12 checagens automáticas. Confirma que a instalação ficou correta. |

---

## Passo a passo

### 1. Criar o projeto

1. Acesse [supabase.com](https://supabase.com) → **New project**
2. **Name:** `obrastock`
3. **Database Password:** gere uma senha forte e **guarde em local seguro** —
   ela não é exibida de novo e é necessária para restaurar backup.
4. **Region:** `South America (São Paulo)` — menor latência para o Espírito Santo.
5. **Plan:** Free.

A criação leva cerca de 2 minutos.

### 2. Executar o schema

1. Menu lateral → **SQL Editor** → **New query**
2. Cole o conteúdo inteiro de `schema.sql`
3. **Run** (ou `Ctrl+Enter`)

Esperado: `Success. No rows returned`.

> Vão aparecer vários avisos `NOTICE: ... does not exist, skipping`. **São
> normais** — vêm das proteções que permitem reexecutar o script sem erro.

### 3. Verificar

1. **New query** → cole `verificar.sql` → **Run**
2. Os 12 itens devem sair como **OK**:

```
Tabelas criadas (9)                         | OK
Views criadas (3)                           | OK
Views com security_invoker (CRITICO)        | OK
RLS habilitada nas 9 tabelas                | OK
Nenhuma tabela com RLS e sem politica       | OK
Movimentacoes sem policy de DELETE          | OK
Triggers de regra de negocio (4)            | OK
Trigger de novo usuario em auth.users       | OK
Funcoes fn_empresa_id / fn_papel            | OK
Constraints qtd_positiva e obra_obrigatoria | OK
Indice unico parcial da chave da NFe        | OK
Papel anon sem acesso a dados               | OK
```

**Qualquer item diferente de OK: pare e corrija antes de seguir.** Em especial o
item `security_invoker` — sem ele, o estoque de uma construtora fica visível para
as outras.

### 4. Criar o primeiro usuário

1. **Authentication** → **Users** → **Add user** → **Create new user**
2. E-mail e senha do administrador
3. Marque **Auto Confirm User** (evita depender do e-mail de confirmação no teste)

O trigger `trg_novo_usuario` cria automaticamente a empresa, o perfil como
**admin** e as 14 categorias padrão.

Para definir o nome da empresa já na criação, use **User Metadata**:

```json
{ "nome": "Carlos Almeida", "empresa": "Construtora Santa Teresa Ltda", "cargo": "Responsável pelo Estoque" }
```

### 5. Conferir que o usuário foi criado corretamente

**SQL Editor** → **New query**:

```sql
select p.nome, p.papel, e.nome as empresa,
       (select count(*) from categorias c where c.empresa_id = e.id) as categorias
from perfis p join empresas e on e.id = p.empresa_id;
```

Esperado: uma linha, papel `admin`, 14 categorias.

### 6. Guardar as credenciais da aplicação

**Project Settings** → **API**:

- **Project URL** → vai em `assets/js/config.js`
- **anon / public key** → vai em `assets/js/config.js`

```js
export const SUPABASE_URL  = 'https://xxxxx.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOi...';
```

> A chave **anon** é pública por design — é a RLS que protege os dados, e ela foi
> verificada nos testes. O que **nunca** pode sair do painel nem ir para o
> repositório é a chave **`service_role`**: ela ignora toda a segurança.

---

## O que o schema garante

Estas regras foram testadas em PostgreSQL 17 antes da entrega:

| Regra | Comportamento |
|---|---|
| Saída acima do saldo | Recusada: `Estoque insuficiente. Disponível: 97.000 SC` |
| Devolução acima do enviado | Recusada: `Devolução maior que o enviado. Na obra: 2.000 SC` |
| Entrega direta na obra | Não altera o saldo do galpão |
| Devolução | Recompõe o saldo pelo custo unitário da saída original |
| Saída sem obra informada | Recusada pela constraint |
| Quantidade zero ou negativa | Recusada pela constraint |
| Estorno que zeraria abaixo de zero | Recusado (`P0003`) |
| Estorno de saída já devolvida | Recusado (`P0004`) |
| Apagar movimentação | Impossível — não existe política de DELETE |
| Empresa B lendo dados da A | 0 linhas, inclusive pelas views |
| Usuário sem login (`anon`) | `permission denied` |
| Custo médio | Recalculado a cada entrada |

## Códigos de erro para tratar na interface

| Código | Significado | Mensagem sugerida ao usuário |
|---|---|---|
| `P0001` | Saldo insuficiente | "Estoque insuficiente. Disponível: X UN" |
| `P0002` | Devolução acima do enviado | "Esta obra recebeu apenas X UN" |
| `P0003` | Estorno deixaria saldo negativo | "Estorne antes as saídas posteriores deste material" |
| `P0004` | Estorno de saída já devolvida | "Estorne primeiro a devolução desta obra" |

Não exibir o erro cru do banco. Traduzir e, quando possível, oferecer o caminho
para resolver.

---

## Manutenção

### Evitar a pausa do plano Free

O Supabase Free **pausa o projeto após 7 dias sem requisição**. Em obra parada no
fim de ano isso acontece. Configure um Cron Trigger no Cloudflare Workers
(gratuito) com uma chamada diária — está detalhado na seção 7 do
`PROMPT-PRODUCAO-ObraStock.md`.

### Backup

O plano Free **não tem backup automático**. Até migrar para o Pro, exporte
periodicamente:

```bash
pg_dump "postgresql://postgres:SENHA@db.xxxxx.supabase.co:5432/postgres" \
  --clean --if-exists -f backup_$(date +%F).sql
```

**Teste a restauração ao menos uma vez.** Backup nunca testado é backup que não existe.

### Reexecutar o schema

É seguro: o script remove e recria seus próprios objetos (views, triggers,
políticas). **Não apaga dados** das tabelas existentes.

---

## Próximo passo

Etapa 3 do roteiro: `login.html` + `auth.js` + guarda de rota.
