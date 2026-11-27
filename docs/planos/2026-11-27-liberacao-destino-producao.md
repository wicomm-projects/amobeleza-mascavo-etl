# Liberação do destino de produção (passo 3 da virada)

- **Data:** 2026-11-27
- **Base:** `docs/planos/2026-11-25-virada-producao.md`, passo 3
- **Risco:** alto (permissão, dado pessoal, dado que não volta) → revisão pelo `orquestracao:revisor`

## Objetivo

Hoje o ETL só grava no MySQL local do Docker. Este PR ensina o ETL a gravar na produção da cliente **só** quando o
modo produção está ligado de forma explícita, com o usuário `wicomm_etl` (criado em 27/11/2026) e com as travas do
Docker trocadas por travas equivalentes para a produção. O merge não grava nada: a primeira gravação só acontece
quando o `.env` da VPS ganha `TARGET_MODE=production` e alguém roda um job.

## Desenho

### Constantes da produção (`src/config/production-target.ts`)

`PRODUCTION_TARGET = { port, user, hostname, serverUuid }`, escritas no código. O host fica só no `.env` da VPS (fora
do Git); um `.env` apontando para outro servidor não grava, porque o uuid não bate. `hostname` e `serverUuid` vêm de
`SELECT @@hostname, @@server_uuid` na produção (só leitura).

### Env (`src/config/env.ts`)

- `TARGET_MODE`: `local` (padrão) ou `production`. Valor diferente desses é erro na subida.
- `local`: como hoje (host só loopback).
- `production`:
    - `TARGET_DB_HOST` = endereço do banco da cliente (só no `.env`), `TARGET_DB_PORT` = `PRODUCTION_TARGET.port`;
    - `TARGET_DB_USER` = `PRODUCTION_TARGET.user`;
    - loopback recusado: a escrita na produção só sai da VPS, que é o IP liberado para o `wicomm_etl`.
- `root` continua recusado nos dois modos.

### Trava do destino (`src/core/db/target-guard.ts`)

- `assertTarget(connection, mode)`: `local` → `assertLocalTarget` (sem mudança); `production` →
  `assertProductionTarget`.
- `assertProductionTarget`, na mesma conexão que vai gravar:
    - `@@hostname` = `PRODUCTION_TARGET.hostname` e `@@server_uuid` = `PRODUCTION_TARGET.serverUuid`;
    - `CURRENT_USER()` = `wicomm_etl@<IPv4 literal>` (sem curinga `%`);
    - `assertProductionGrants(SHOW GRANTS)`: só `USAGE ON *.*` e `SELECT/INSERT/UPDATE/DELETE` em
      `` `mascavo_etl|amobeleza_etl`.`<tabela>` `` (tabela segura, não Laravel). Recusa `ALL`, DDL, privilégio em
      `*.*` ou em `banco.*`, outro banco, `GRANT OPTION` e role.
- `writer`, `guardedTargetSource` (lock e check-access) passam a usar `assertTarget`. O modo vem do env, com
  injeção para teste.
- `db:apply` continua só com `assertLocalTarget` e recusa logo no início se o modo for produção.

### Outras travas

- `runner`: em produção, `--fixture` sem `--dry-run` é recusado (dado de exemplo nunca vai para o banco da cliente).
- Máscara de dado pessoal (VTEX e AnyMarket): desligada só quando `TARGET_MODE=production`.
- `check-access`: mostra o modo e confere a identidade do destino do modo atual.

## Tarefas

1. Testes de env (modo, host, porta, usuário, loopback em produção) → implementação.
2. Testes de `assertProductionGrants` e `assertProductionTarget` com conexão falsa (identidade certa, outro
   servidor, outro usuário, usuário com curinga, grants a mais) → implementação.
3. Teste do writer em modo produção (grava com fake de produção, recusa o Docker local) → `assertTarget`.
4. Teste da máscara por modo → implementação nos dois `personal-data.ts`.
5. Teste do runner (fixture em produção) → implementação.
6. `db:apply` em produção recusado.
7. CLI (`check-access`, ajuda), `.env.example`, `CLAUDE.md`, ADR, plano da virada e runbook da VPS.

## Verificação

`npm run typecheck`, `npm run lint`, testes afetados (`tests/core`, `tests/connectors` dos dois conectores com
máscara). Integração no Docker local, se o `db:up` estiver de pé.
