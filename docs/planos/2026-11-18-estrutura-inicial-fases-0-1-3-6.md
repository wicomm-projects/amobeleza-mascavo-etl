# Plano — Estrutura inicial do ETL Amobeleza + Mascavo (fases 0, 1, 3 e 6)

## Contexto

A WPP desligou o ETL (Laravel) que alimentava os bancos MySQL `mascavo_etl` e `amobeleza_etl`; os Power BI pararam. O combinado com a cliente (call de 11/11 + roadmap publicado) é **refazer só o conector**: um ETL novo, em Node.js, que grava **nas mesmas tabelas, colunas e convenções** de antes, sem mexer no Power BI. Roadmap: 9 etapas, 97–148 h. Este plano monta a estrutura das etapas **0 (Preparação), 1 (Pedidos VTEX), 3 (GA4) e 6 (Marketplace/AnyMarket)**.

Situação hoje (18/11/2026):
- **Nenhum acesso chegou** (VTEX, GA4, AnyMarket, usuário MySQL). Só existe o root geral que veio na doc da WPP — **nunca será usado**.
- **VPS ainda não existe** (o chefe está criando na Hostinger).
- Repo `wicomm-projects/amobeleza-mascavo-etl` vazio (só `main` com README).
- Não existe "middleware" anterior em lugar nenhum: tudo é escrito do zero.
- A doc da Amobeleza (149 p.) **não está no disco** (o caminho em Downloads não existe). A da Mascavo está em `C:\Users\matheus\Downloads\BI-20261110T144546Z-1-001\BI\Documentação  Mascavo (1).pdf`.

Objetivo: deixar tudo pronto para que, quando as chaves chegarem, baste preencher o `.env` e rodar `check-access`. Testes de conector ficam para quando houver chaves (pedido do Matheus).

## Decisões (assumidas, a confirmar)

| Tema | Decisão | Motivo |
|---|---|---|
| Linguagem | TypeScript ESM, Node 24 LTS (`.nvmrc`), npm | Pedido do Matheus; mesmo molde do `bff-givex` |
| Padrão de código | Copiar configs do `bff-givex`: `tsconfig` (NodeNext, strict, noUncheckedIndexedAccess), eslint flat, prettier (tabs 4, sem `;`, aspas simples, 120), zod 4, axios, pino com `redact`, dotenv | Padrão da Wicomm já usado |
| Express | Só `GET /health` e `GET /status`, escutando em `127.0.0.1`. Nenhuma rota que grava ou dispara carga | O ETL é batch; não deve ter porta aberta |
| Agendador | `node-cron` dentro do mesmo processo, desligado por padrão (`SCHEDULER_ENABLED=false`); lock por job com `GET_LOCK()` do MySQL de destino | Evita duas execuções sobrepostas, mesmo CLI + agendador |
| Execução manual | CLI `npm run etl -- <comando>` (via `tsx`, `node:util parseArgs`) | Paridade, schema e cargas manuais |
| Banco local | Docker MySQL 8.4 (LTS) na porta 3307, com `mascavo_etl`, `amobeleza_etl` e `etl_local_meta` | Desenvolvimento sem tocar em produção |
| Dependências | A fase 0 já instala tudo que as fases 1, 3 e 6 vão usar (incl. `@google-analytics/data`) | As 3 sessões não mexem em `package.json`/lock → sem conflito entre PRs |
| Testes | Fase 0: só testes das **travas de segurança** (não precisam de chave). Conectores: sem suíte agora | Pedido do Matheus; as travas são o que impede gravar em produção |
| Branches | Criar `develop` a partir de `main`. Fase 0 em `feat/fase-0-fundacao` → PR para `develop`. Fases 1/3/6 em branches próprias → PR para `develop`. **Nenhum merge sem autorização do Matheus** | Kit de orquestração + pedido do Matheus |

## Travas de segurança (não negociáveis)

1. **Duas conexões separadas**:
   - `REF_DB_*` (MySQL da cliente, referência): só para `schema:pull` e `parity`. Abre a sessão com `SET SESSION TRANSACTION READ ONLY` e um guarda que rejeita qualquer SQL que não comece com `SELECT`/`SHOW`. O validador do env **rejeita usuário `root`**.
   - `TARGET_DB_*` (destino): nesta etapa só pode ser o Docker local.
2. **Marcador do banco local**: antes de qualquer gravação, o writer confere `SELECT 1 FROM etl_local_meta.marker WHERE env='local-dev'`. Isso bloqueia até um túnel SSH para produção que apareça como `127.0.0.1`. **Nenhum código destas fases sabe gravar fora do banco local**; liberar produção será um PR próprio, revisado, depois da paridade, do backup e da autorização por escrito da cliente.
3. **Lista de tabelas**: cada job declara as tabelas que grava; o writer recusa as demais e sempre recusa as do Laravel (`failed_jobs`, `telescope_*`, `migrations`, `users`, `password_resets`, `personal_access_tokens`, `health_check_*`).
4. **APIs só leitura**: o transporte da VTEX e do AnyMarket não aceita método além de GET (o tipo nem permite). GA4 usa a lib oficial (`runReport`), com a conta de serviço só como Leitor.
5. **Segredos**: `.env` fora do Git, `.env.example` só com nomes, `pino.redact` para `X-VTEX-API-AppToken`, `X-VTEX-API-AppKey`, `gumgaToken`, `authorization`, `password`. `.gitignore` bloqueia `*.pdf`, `*.xlsx`, `*.docx`, `reports/`, `credentials/`, `*service-account*.json`. As docs da WPP (com senhas) nunca entram no repo.
6. **LGPD**: nenhum dado de produção vem para o banco local. Fixtures só com exemplos públicos das APIs. `reports/` (saída de paridade e dry-run) fica fora do Git. Log só com contagens e IDs.
7. Nenhuma credencial copiada das docs para código, `.env.example`, docs ou mensagens entre sessões (só nomes de variável).

## Estrutura do repositório (criada na fase 0)

```
amobeleza-mascavo-etl/
  .nvmrc  .env.example  .gitignore  package.json  tsconfig.json
  eslint.config.mjs  .prettierrc.mjs  vitest.config.ts
  docker-compose.yml                 # MySQL 8.4 local, porta 3307
  CLAUDE.md                          # regras do projeto (travas, comandos, convenções)
  README.md
  .github/workflows/ci.yml           # npm ci, lint, typecheck, test (PR para develop)
  db/
    init/00-local.sql                # cria os 3 bancos + etl_local_meta.marker
    schema/<banco>/<tabela>.sql      # DDL; provisória (do dicionário WPP) até o schema:pull
  src/
    server.ts                        # Express /health e /status, 127.0.0.1, shutdown limpo
    cli.ts                           # sources | check-access | db:apply | schema:pull | run | parity
    config/env.ts                    # zod; grupos opcionais por fonte; rejeita root
    config/brands.ts                 # mascavo → mascavo_etl; amobeleza → amobeleza_etl; anymarket (global) → amobeleza_etl
    config/logger.ts                 # pino com redact
    core/http/transport.ts           # cliente GET-only: retry exponencial em 429/5xx/rede, Retry-After, timeout
    core/concurrency.ts              # runWithConcurrency (padrão bff-givex)
    core/db/pools.ts                 # pools target e ref (lazy)
    core/db/ref-reader.ts            # leitura da cliente, read-only + guarda de SQL
    core/db/target-guard.ts          # marcador local, lista de tabelas, denylist Laravel
    core/db/writer.ts                # estratégias em transação (abaixo)
    core/jobs/{types,registry,runner,scheduler,lock}.ts
    core/parity/compare.ts           # diff coluna a coluna, saída em reports/
    connectors/vtex/index.ts         # stub: export const jobs = []  (preenchido na fase 1)
    connectors/ga4/index.ts          # stub (fase 3)
    connectors/anymarket/index.ts    # stub (fase 6)
  tests/core/*.test.ts               # travas de segurança
  ops/systemd/*.service              # modelo para a VPS (logs no journald; deploy depois)
  docs/
    adr/2026-11-18-stack-typescript-express.md
    adr/2026-11-18-travas-de-escrita.md
    planos/2026-11-18-estrutura-inicial-fases-0-1-3-6.md   # cópia deste plano
    contrato/convencoes.md           # centavos, UTC, status em inglês, created_at/updated_at, grafias
    contrato/mascavo_etl.md          # dicionário das tabelas das fases 1 e 3 (sem segredos)
    runbooks/acessos.md              # o que pedir, onde entra cada chave no .env, como checar
    runbooks/vps.md                  # Hostinger: usuário etl, chave SSH, firewall, Node 24, systemd, túnel
```

**Estratégias do writer** (todas em transação, SQL parametrizado, `escapeId` nos nomes, lotes):
- `upsert(table, rows)` → `INSERT … ON DUPLICATE KEY UPDATE` (ex.: `vtex_order_details`, `vtex_products`)
- `replaceByKeys(table, keyCol, keys, rows)` → apaga por chave e reinsere (ex.: `vtex_orders` e filhas por `order_id`)
- `replaceDateWindow(table, dateCol, from, to, rows)` → tabelas `sheets_google_drive_*`
- `replaceAll(table, rows)` → tabelas pequenas (`vtex_category_tree`, `sheets_google_drive_category`)

**Contrato de job** (`core/jobs/types.ts`): `name`, `scope` (`brand` | `global`), `tables`, `isConfigured(brand)`, `checkAccess(ctx)`, `run(ctx, { from, to, dryRun, fixture })`. Fonte sem chave aparece como **"aguardando chave"** — não quebra o processo.

**CLI**:
- `sources` — lista cada fonte × marca: configurada / aguardando chave.
- `check-access [--brand] [--source]` — uma chamada mínima de leitura por credencial; imprime OK/erro, sem dados.
- `db:apply` — aplica `db/schema/**` no Docker local.
- `schema:pull` — com o usuário de leitura: `SHOW CREATE TABLE` das tabelas da lista → sobrescreve `db/schema/` (só estrutura).
- `run <job> --brand <b> [--from --to] [--dry-run] [--fixture <arquivo>]` — `--fixture` roda transformação + gravação local a partir de um JSON de exemplo público, sem chave.
- `parity <job> --brand <b> --sample 200` — lê a produção (só SELECT), transforma em memória e compara; nada é gravado.

## Fase 0 — Fundação (aqui, nesta sessão)

1. `git checkout -b develop` a partir de `main`, `git push -u origin develop`; depois `feat/fase-0-fundacao`.
2. Esqueleto e configs copiados do `bff-givex` (`C:\Users\matheus\Desktop\Trabalhos\Wicomm\Back\bff-givex`): `package.json` (scripts `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`, `etl`), `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.mjs`; `src/config/env.ts` e `logger.ts` adaptados de `bff-givex/src/config/`; retry de `bff-givex/src/givex/transport.ts`; `runWithConcurrency` de `bff-givex/src/utils/limit.ts`; `main()` e shutdown de `bff-givex/src/server.ts`.
3. Dependências: express 5, zod 4, axios, pino, pino-http, dotenv, mysql2, node-cron, @google-analytics/data; dev: typescript, tsx, vitest, eslint, prettier, pino-pretty, @types/*.
4. Núcleo `src/core/**`, `config/brands.ts`, `server.ts`, `cli.ts`, stubs dos 3 conectores (registrados no `registry.ts` desde já, para as sessões só mexerem na própria pasta).
5. Docker local + `db/init/00-local.sql` + comando `db:apply`.
6. Testes das travas: writer sem marcador recusa; tabela do Laravel recusada; tabela fora da lista recusada; env com usuário `root` rejeitado; `ref-reader` recusa INSERT/UPDATE/DELETE/DROP/ALTER/SET/CALL; transporte faz retry em 429 e não tem outro método além de GET.
7. Docs: `CLAUDE.md`, `README.md`, 2 ADRs, cópia do plano, `docs/contrato/convencoes.md`, `docs/contrato/mascavo_etl.md` (dicionário já extraído da doc da Mascavo, p. 10–38), runbooks de acessos e da VPS, modelo de `ops/`.
8. CI no GitHub Actions.
9. PR `feat/fase-0-fundacao` → `develop`; revisão pelo agente `orquestracao:revisor` (mexe em segredo e permissão de banco). **Portão: pedir ao Matheus autorização para mergear a fase 0 em `develop`**, porque as 3 sessões nascem de `origin/develop`.

## Fases 1, 3 e 6 — três sessões paralelas (depois do merge da fase 0)

Cada sessão: worktree própria, branch a partir de `origin/develop`, PR para `develop`, **sem merge**. Só mexe em `src/connectors/<x>/`, `db/schema/<banco>/<tabelas dela>.sql` e `docs/conectores/<x>.md`. Sem testes de conector agora; verificação = lint + typecheck + `run --fixture` no Docker local + `check-access` mostrando "aguardando chave".

### Fase 1 — Pedidos VTEX (`feat/fase-1-vtex`)
- Tabelas (as duas marcas, mesmo formato): `vtex_orders`, `vtex_order_details`, `vtex_order_items`, `vtex_order_logistics_info`, `vtex_order_logistics_delivery_ids`, `vtex_order_shipping_data`, `vtex_order_payment_transactions`, `vtex_order_payment_transactions_payments`, `vtex_order_payment_gift_cards`, `vtex_order_rates`; catálogo `vtex_products`, `vtex_category_tree`, `vtex_skus_and_products_id`; clientes `vtex_client_profile` (Master Data, dado pessoal).
- Cliente: `GET /api/oms/pvt/orders` com `f_creationDate`, 100 por página, máx. 30 páginas; acima de 3.000 pedidos a janela é dividida ao meio automaticamente. Relê 45 dias e busca `GET /api/oms/pvt/orders/{id}` só do que mudou (`last_change` diferente do gravado). Carga retroativa a partir de 05/10/2026.
- Convenções: `total_value` em centavos (Power BI ÷100); itens/detalhes a confirmar na paridade; datas em UTC; status sem tradução; `group` com crase; `vtex_orders`, `shipping_data` e `rates` sem PK → `replaceByKeys` por `order_id`.
- DDL provisória a partir de `docs/contrato/mascavo_etl.md`; colunas de `vtex_client_profile` a extrair da doc da Mascavo.

### Fase 3 — GA4 (`feat/fase-3-ga4`)
- Mascavo (o que o B2C lê): `sheets_google_drive_trafego`, `_vendas`, `_users`, `_items`, `_category`. Amobeleza (Web Analytics): `_trafego`, `_transacoes`, `_navegacao`, `_por_hora`.
- `@google-analytics/data` (`runReport`) com conta de serviço (`GOOGLE_APPLICATION_CREDENTIALS` apontando para arquivo fora do repo). Uma definição de relatório por tabela (dimensões/métricas → colunas com a grafia exata: `Date`, `Session_source`, `Item_name`…).
- `vehicle_channel_no_pay` e `type`: De/Para versionado em `src/connectors/ga4/de-para.json`, montado depois com `SELECT DISTINCT` na produção (só leitura); até lá, fontes sem mapeamento vão para um relatório de pendências.
- Gravação `replaceDateWindow` (janela de 3 dias), `category` com `replaceAll`. Frequência proposta: a cada 3 h.
- Riscos registrados: dimensões de transacoes/navegacao/por_hora são da era Universal Analytics → equivalência GA4 a combinar; ID da propriedade Mascavo provavelmente 460424464 (a confirmar com a cliente).

### Fase 6 — AnyMarket (`feat/fase-6-anymarket`)
- Uma carga global, todas as contas (inclui `account_name = 'MASCAVO'`), gravando em `amobeleza_etl.anymarket_*` (6 tabelas: orders, items, payments, shipping, tracking, buyer — `_buyer` tem dado pessoal).
- Cliente GET-only em `https://api.anymarket.com.br/v2`, header `gumgaToken`, paginação por `offset`/`limit` com links `next`, tratamento de 429. Filtros do `/orders` a confirmar no portal developers.anymarket.com.br (agente `stack:docs`).
- O dicionário dessas tabelas só existe na doc da Amobeleza → depende de o Matheus colocar o PDF em `amobeleza_mascavo_docs` (fora do repo). Sem ele, a DDL fica para o `schema:pull`; a sessão entrega cliente, paginação, tipos da resposta e o esqueleto de transformação.

## Pendências fora do código

- **Doc da Amobeleza**: colocar o PDF em `C:\Users\matheus\Desktop\Trabalhos\Wicomm\Back\amobeleza_mascavo_docs\` (afeta fase 6 e parte da 3).
- **VPS**: quando o chefe criar, seguir `docs/runbooks/vps.md` e mandar o IP para o pedido do usuário MySQL de leitura.
- **Acessos**: usuário MySQL só leitura nos dois bancos + IP da VPS; chaves VTEX das duas lojas; IDs GA4 + Leitor; token AnyMarket; usuário de Power BI (histórico de refresh).
- **Cliente**: qual dos dois hosts MySQL citados na doc é o de produção.

## Verificação

Fase 0 (aqui, com saída real dos comandos):
- `npm ci && npm run lint && npm run typecheck && npm test` verdes.
- `docker compose up -d` e `npm run etl -- db:apply` sem erro.
- `npm run etl -- sources` e `check-access` mostram todas as fontes como "aguardando chave", sem nenhuma chamada à rede da cliente.
- `npm run dev` → `curl http://127.0.0.1:3000/health` responde sem segredos.
- Teste manual da trava: apagar o marcador local → qualquer `run` recusa gravar.
- Varredura do diff por segredos e IPs das docs (`git diff develop... | grep -iE "token|senha|password|<IPs das docs>"`) vazia.
- CI verde no PR.

Fases 1, 3 e 6 (nas sessões): lint + typecheck + `run <job> --fixture` gravando no Docker local + `check-access` "aguardando chave". Testes reais e paridade quando as chaves e o usuário de leitura chegarem.
