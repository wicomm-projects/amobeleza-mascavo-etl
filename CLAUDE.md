# amobeleza-mascavo-etl

ETL em Node.js/TypeScript que alimenta os bancos MySQL `mascavo_etl` e `amobeleza_etl` da cliente, no lugar do ETL
Laravel que a WPP desligou. O Power BI da cliente lê essas tabelas e **não muda**: o ETL grava nas mesmas tabelas, com
as mesmas colunas, tipos e convenções de antes (docs/contrato/).

## Regra número 1: produção da cliente

**Nada neste repositório grava no banco da cliente.** Nesta etapa o destino só pode ser o MySQL local do Docker.

- O env recusa destino fora do local (`TARGET_DB_HOST`) e recusa o usuário `root` em qualquer banco.
- O writer só grava se achar `etl_local_meta.marker` (só existe no Docker local; o usuário do ETL não consegue criá-lo).
  Um túnel SSH para a produção aparece como 127.0.0.1 — por isso o marcador, e não o host, é a trava principal.
- O banco da cliente (`REF_DB_*`) é só leitura: `src/core/db/ref-reader.ts` aceita um único SELECT/SHOW, roda dentro de
  `START TRANSACTION READ ONLY`, com `max_execution_time`, e nunca lê tabela do Laravel.
- VTEX e AnyMarket: o cliente HTTP (`src/core/http/transport.ts`) só tem `get`. Nada é alterado nas plataformas.
- Liberar gravação em produção é um PR próprio, revisado, só depois de: paridade OK, backup das tabelas, autorização
  por escrito da cliente e usuário próprio com permissão só nas tabelas do mapa. Não "destrave" as regras acima em outro PR.
- Tabelas do Laravel (`failed_jobs`, `telescope_*`, `migrations`, `users`, `password_resets`, `personal_access_tokens`,
  `health_check_*`) nunca entram no código.

## Segredos e dado pessoal

- Chaves só no `.env` (fora do Git). `.env.example` tem só nomes. Nunca cole chave em código, doc, commit ou mensagem.
- As documentações da WPP (PDF) têm senhas em texto aberto, inclusive root: **nunca** entram no repo nem são copiadas.
- Pedidos, clientes e `anymarket_buyer` têm dado pessoal: log só com contagens e IDs; nada de dado de produção no
  Docker local; fixtures só com exemplos públicos das APIs; `reports/` fica fora do Git.

## Comandos

```bash
npm run db:up                      # MySQL local (127.0.0.1:3307) com o marcador
npm run etl -- sources             # o que está configurado e o que espera chave
npm run etl -- check-access        # leitura mínima por credencial
npm run etl -- db:apply            # recria no Docker local as tabelas de db/schema/**
npm run etl -- schema:pull         # SHOW CREATE TABLE na produção (só leitura) → db/schema/
npm run etl -- run <job> --brand mascavo --dry-run
npm run etl -- run <job> --brand mascavo --fixture caminho.json
npm run etl -- parity <job> --brand mascavo --sample 200
npm run dev                        # Express /health e /status em 127.0.0.1:3000
npm run typecheck && npm run lint && npm test
```

## Estrutura

- `src/config/` — env (zod), marcas (`brands.ts`), logger (pino com redact).
- `src/core/db/` — pools, `ref-reader` (produção, só leitura), `target-guard` + `writer` (destino local), schema.
- `src/core/jobs/` — contrato `iSource`/`iJob`, registro, runner, lock (GET_LOCK), agendador (node-cron).
- `src/core/parity/` — comparação coluna a coluna com a produção.
- `src/connectors/<fonte>/` — um conector por fonte. Cada fase mexe só na própria pasta, em
  `db/schema/<banco>/<tabelas dela>.sql` e em `docs/conectores/<fonte>.md`.
- `db/schema/<banco>/<tabela>.sql` — um CREATE TABLE por arquivo. Provisório (dicionário da WPP) até o `schema:pull`.

## Convenções de código (mesmo molde do bff-givex)

- TypeScript ESM, imports com `.js`. Prettier: tabs, sem `;`, aspas simples, 120 colunas. Interfaces `iX`, tipos `tX`.
- Early return; constante nomeada em vez de número mágico; validar resposta de API na borda com zod.
- SQL sempre parametrizado; nomes por `mysql.escapeId` depois de `isSafeIdentifier`.
- Sem `console.log`: logger (`getLogger()`) no código, `process.stdout.write` só no CLI.
- Commits `tipo: descrição` (feat, fix, refactor, docs, test, chore, perf, ci). PT-BR em tudo.

## Fluxo de branches

`develop` é o tronco. Branch nasce de `origin/develop`, PR volta para `develop`. **Nenhum merge sem autorização do
Matheus.** `main` só recebe release.

## Documentos

- Plano: `docs/planos/2026-11-18-estrutura-inicial-fases-0-1-3-6.md`
- Decisões: `docs/adr/`
- Contrato das tabelas: `docs/contrato/`
- Acessos e VPS: `docs/runbooks/`
