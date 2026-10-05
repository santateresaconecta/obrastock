# ObraStock — Gestão de Estoque (PWA)

Protótipo funcional. Dados no `localStorage`, via camada de abstração pronta para Supabase.

**v1.1** — adicionada a **devolução de material da obra para o galpão**
(ex.: saíram 3 sacos de cimento, voltou 1). O saldo do estoque é recomposto e o
total consumido pela obra passa a ser calculado líquido das devoluções.

## Arquivos

```
index.html              Aplicação completa (HTML + CSS + JS)
manifest.webmanifest    Metadados do PWA (nome, ícones, atalhos)
sw.js                   Service Worker (cache do shell)
icons/                  Ícones do app (any, maskable, Apple, favicons, atalhos)
exemplo-nfe.xml         NF-e de teste para a importação de XML
```

## Como testar o modo aplicativo

O PWA **exige http(s)** — abrir `index.html` por duplo clique (`file://`) continua
funcionando como app normal, mas não instala.

```bash
# na pasta do projeto
python3 -m http.server 8000
# acesse http://localhost:8000
```

`localhost` é tratado como origem segura pelo Chrome, então dá para instalar já no teste.

## Publicação na Vercel

Projeto estático, sem build:

```bash
npx vercel --prod
```

Ou conecte o repositório no painel. Não é preciso configurar framework —
basta servir a raiz. Com HTTPS ativo, o app fica instalável.

## Instalação no celular

- **Android/Chrome**: aparece o botão "Instalar aplicativo" (ou o banner do navegador).
- **iPhone/Safari**: Compartilhar → Adicionar à Tela de Início.
  O iOS não tem prompt automático; o app mostra as instruções uma vez.

## Atalhos (long-press no ícone)

| Atalho | URL |
|---|---|
| Nova saída | `?acao=saida` |
| Nova entrada | `?acao=entrada` |
| Ver estoque | `?tela=estoque` |

Também funcionam `?acao=xml`, `?acao=devolucao` e `?acao=ajuste`.

## Atualizações

O `sw.js` usa *network-first* na navegação: ao publicar uma versão nova, o
usuário recebe na hora. Se o SW detectar atualização com o app aberto, aparece
a barra "Nova versão disponível".

**Ao alterar arquivos do shell, suba a versão** em `sw.js`:

```js
const VERSION = 'v1.0.1';   // invalida os caches antigos
```

## Cache: o que é e o que não é

O Service Worker guarda **apenas a interface** (HTML, ícones, fontes, Font Awesome).
Não há fila de escrita offline — decisão de escopo, já que a conexão do galpão é boa.
Chamadas para `*.supabase.co` e rotas `/rest/v1/`, `/auth/v1/` etc. são **ignoradas
pelo cache** e sempre vão à rede, para nunca exibir saldo desatualizado.

## Próximo passo: Supabase

A UI fala só com `DB.*` (`list/get/insert/update/remove`). Para migrar:

1. Criar as tabelas (`materiais`, `obras`, `fornecedores`, `movimentacoes`, `notas`, `categorias`);
2. Implementar `SupabaseAdapter` com a mesma interface;
3. Trocar a linha `const Adapter = new LocalStorageAdapter('obrastock')`.

**Importante:** mover a validação de saldo (`Mov.validarSaida`) para uma função
no Postgres, chamada via `rpc`, validando e inserindo na mesma transação.
Validação só no cliente é contornável e sofre condição de corrida com
múltiplos usuários.
