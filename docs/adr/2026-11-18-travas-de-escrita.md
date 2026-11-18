# Travas de escrita: só o Docker local até a liberação formal da produção

- **Data:** 2026-11-18
- **Status:** aceita

## Contexto

O ETL existe para gravar no banco de produção da cliente, que o Power BI lê. Um erro de gravação aparece no painel que
a cliente usa todo dia. A documentação da WPP trouxe o root do MySQL em texto aberto. Ainda não há usuário próprio,
nem paridade, nem backup. O desenvolvimento acontece no computador do dev e, depois, numa VPS cujo IP terá acesso ao
banco — um túnel SSH pela VPS faz a produção aparecer como `127.0.0.1`.

## Decisão

Defesa em camadas, todas ativas desde a fase 0:

1. **Env:** `TARGET_DB_HOST` só aceita loopback (`127.0.0.1`, `localhost`, `::1`); usuário `root` é recusado em
   qualquer banco; `HOST` do Express só loopback; grupos de credencial incompletos são erro.
2. **Identidade do Docker local** (`src/core/db/target-guard.ts`), conferida no próprio servidor, na mesma conexão que
   vai gravar, antes de qualquer escrita, do `db:apply` e do lock (`GET_LOCK`):
    - linha `etl_local_meta.marker` = `local-dev`;
    - `@@hostname` = `amo-etl-mysql-local` (fixo no `docker-compose.yml`);
    - `CURRENT_USER()` = `etl_local@%`;
    - `SHOW GRANTS`: nada global além de USAGE, só SELECT no banco do marcador, sem role, sem GRANT OPTION.
      Um túnel para a produção aparece como 127.0.0.1, mas não passa nessa conferência — nem se alguém criar o marcador lá
      por engano, porque hostname, usuário e grants não batem. O `db/init/00-local.sql` também se recusa a rodar fora do
      container (confere `@@hostname` na primeira linha) e cria o marcador por último.
3. **Sem atalho:** fora de `src/core/db`, o ESLint proíbe importar `mysql2`, pools e conexões cruas
   (`no-restricted-imports`); todo acesso passa por `src/core/db/index.ts`.
4. **Lista de tabelas:** cada job declara as tabelas que grava; o writer recusa qualquer outra e sempre recusa as do
   Laravel. `replaceAll` e `replaceDateWindow` recusam lote vazio (resposta vazia por falha apagaria dados) sem
   `allowEmpty` explícito.
5. **Transação:** toda gravação é em transação; erro no meio → ROLLBACK.
6. **Produção só leitura** (`src/core/db/ref-reader.ts`):
    - SQL: um único SELECT/SHOW; recusa qualquer comentário (inclusive o executável `/*! ... */`, que o MySQL roda),
      `;`, INTO, FOR UPDATE/SHARE, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE e tabela do Laravel;
    - usuário: antes da primeira consulta, `SHOW GRANTS` precisa ter só SELECT / SHOW VIEW / USAGE / SHOW DATABASES, sem
      role, sem PROXY, sem GRANT OPTION — senão o reader recusa trabalhar e o `check-access` sai com erro;
    - servidor: `SET SESSION TRANSACTION READ ONLY` (barra DDL como `CREATE TABLE ... AS SELECT`, que o
      `START TRANSACTION READ ONLY` sozinho deixava passar pelo commit implícito), cada consulta em
      `START TRANSACTION READ ONLY` + ROLLBACK, `max_execution_time`.
7. **APIs só leitura:** o cliente HTTP só tem `get`, só aceita caminho relativo ao baseURL e não segue redirect — as
   credenciais (AppToken, gumgaToken) nunca vão para outro host.

Testes unitários em `tests/core/` cobrem cada trava com conexões falsas; `tests/integration/` prova no MySQL local
(Docker) que a sessão só leitura barra DDL e que o writer grava certo. O CI roda os dois.

## Alternativas consideradas

- **Confiar só no host:** não pega o túnel SSH.
- **Confiar só no marcador:** é uma linha que qualquer um com root pode criar; por isso hostname, usuário e grants.
- **Confiar só no usuário de banco da cliente:** depende de terceiros configurarem certo; por isso o reader confere os
  grants e recusa usuário com escrita.

## Histórico

- 2026-11-18: revisão independente achou que um comentário executável (`/*!CREATE TABLE ... AS */ SELECT 1`) passava pela
  checagem de SQL e o `CREATE TABLE ... AS SELECT` rodava dentro de `START TRANSACTION READ ONLY`. Corrigido antes do
  primeiro merge (itens 2, 3, 6 e 7 acima). Nenhum código chegou a rodar contra a produção.

## Consequências

- Liberar a produção exige um PR próprio, revisado por agente separado, que: troque o marcador por uma regra explícita de
  produção (ex.: host + usuário próprio + lista de tabelas + flag por fonte), e só depois de paridade OK, backup das
  tabelas do mapa e autorização por escrito da cliente.
- Enquanto isso, as cargas reais (com chave) gravam no Docker local, o que permite validar tudo sem risco. Dado pessoal
  (clientes VTEX, compradores e endereços do AnyMarket) é gravado como `[mascarado]` no local
  (`src/connectors/vtex/personal-data.ts` e `src/connectors/anymarket/personal-data.ts`); o PR de liberação da produção
  desliga as duas máscaras.
