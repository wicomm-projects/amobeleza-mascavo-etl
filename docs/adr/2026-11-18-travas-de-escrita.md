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

1. **Env:** `TARGET_DB_HOST` só aceita host local (`127.0.0.1`, `localhost`, `::1`, `mysql`); usuário `root` é recusado
   em qualquer banco; `HOST` do Express só loopback.
2. **Marcador local:** o writer, o `db:apply` e o `check-access` exigem a linha `etl_local_meta.marker` = `local-dev`.
   Ela só é criada pelo `db/init/00-local.sql` do Docker, e o usuário do ETL tem só SELECT nesse banco. É a trava que
   pega o caso do túnel.
3. **Lista de tabelas:** cada job declara as tabelas que grava; o writer recusa qualquer outra e sempre recusa as do
   Laravel.
4. **Transação:** toda gravação é em transação; erro no meio → ROLLBACK.
5. **Produção só leitura:** `ref-reader` aceita um único SELECT/SHOW, sem comentário, sem `;`, sem INTO, sem FOR UPDATE,
   sem SLEEP, sem tabela do Laravel; roda em `START TRANSACTION READ ONLY` com `max_execution_time`.
6. **APIs só leitura:** o cliente HTTP só tem `get`.

Testes automatizados em `tests/core/` cobrem cada trava.

## Alternativas consideradas

- **Confiar só no host:** não pega o túnel SSH.
- **Confiar só no usuário de banco da cliente:** depende de terceiros configurarem certo; o `check-access` ainda avisa se
  o usuário de leitura tiver permissão de escrita.

## Consequências

- Liberar a produção exige um PR próprio, revisado por agente separado, que: troque o marcador por uma regra explícita de
  produção (ex.: host + usuário próprio + lista de tabelas + flag por fonte), e só depois de paridade OK, backup das
  tabelas do mapa e autorização por escrito da cliente.
- Enquanto isso, as cargas reais (com chave) gravam no Docker local, o que permite validar tudo sem risco.
