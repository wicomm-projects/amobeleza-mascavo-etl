# Plano — Paridade da VTEX (vtex-orders e vtex-catalog)

Item AMO-F1, pergunta AMO-Q26 (24/11/2026). Pré-requisito para liberar a gravação em produção: provar, numa amostra,
que o ETL novo monta as mesmas linhas que o ETL antigo gravou.

## Objetivo

`npm run etl -- parity vtex-orders --brand mascavo [--sample 200] [--from AAAA-MM-DD --to AAAA-MM-DD]` e
`npm run etl -- parity vtex-catalog --brand mascavo [--sample 200]`:

1. leem a VTEX (só GET, como a carga);
2. transformam em memória com as **mesmas** funções da carga (`toOrderRow`, `toDetailRows`, `sellerNameOf`,
   `toCategoryTreeRows`, `toSkusAndProductsRows`, `toProductRow`);
3. leem a produção só com `refReader.query` (usuário só leitura, SELECT com `LIMIT`, sempre por chave);
4. comparam com `compareRows` (`src/core/parity/compare.ts`);
5. gravam o relatório em `reports/` (fora do Git) e imprimem só contagens.

**Nada é gravado em banco nenhum** (nem no local). Nenhum `writer` é usado.

## Regras que não podem quebrar

- Produção só por `ctx.refReader.query`. Nenhum import de `mysql2`/pools fora de `src/core/db` (ESLint já barra).
- Toda consulta à produção: um único SELECT, sem comentário, com `LIMIT`, filtrada por chave (`order_id IN (?)`,
  `id IN (?)`, `product_id IN (?)`). Única exceção: o `MAX(creation_date)` do passo 1 (agregado com `LIMIT 1`) e a
  árvore de categorias inteira (tabela pequena, `LIMIT 5000`).
- Dado pessoal: no relatório, as diferenças em colunas de `PERSONAL_COLUMNS` (`personal-data.ts`, exportar a constante)
  saem com `expected` e `actual` trocados por `MASK` (`[mascarado]`). O terminal só mostra contagens. Nada de valor de
  coluna no log.
- Nomes de tabela vêm das constantes de `tables.ts` e o banco de `ctx.database` (tipo fechado): montar
  `` `${database}`.`${table}` `` é seguro; valores sempre por parâmetro `?`.

## Arquivos

### `src/core/parity/compare.ts` (núcleo, mudança pequena)

- `writeParityReport(job, results, meta?)`: grava `{ meta, results }` (hoje grava só `results`). `meta` é
  `Record<string, unknown>` opcional. Nenhum outro chamador existe ainda.
- Exportar `DEFAULT_IGNORED`.

### `src/core/jobs/types.ts`

- `iParitySummary` ganha `notes?: string[]`.

### `src/cli.ts` (`commandParity`)

- Depois das linhas por tabela, imprimir `summary.notes` (uma por linha), antes de "Relatório completo".

### `src/connectors/vtex/personal-data.ts`

- Exportar `PERSONAL_COLUMNS`.

### `src/connectors/vtex/catalog-job.ts`

- Exportar `writesProducts` (já existe, só não é exportado).

### `src/connectors/vtex/parity-shared.ts` (novo)

- `pickSample<T>(items: readonly T[], size: number): T[]` — amostra determinística, espaçada uniformemente (ordem
  de entrada preservada; `size >= items.length` devolve tudo; `size <= 0` devolve `[]`).
- `redactPersonal(table: string, results: iCompareResult): iCompareResult` — troca `expected`/`actual` por `MASK` nas
  diferenças de colunas pessoais daquela tabela.
- `summarize(results: iCompareResult[]): iParitySummary['tables']` — `divergent = compared − matched` (linha da produção
  sem par no novo conta como divergente). Linhas a mais no novo (`extraInNew`) entram como nota (ver abaixo).
- `qualified(database, table)` → `` `db`.`table` ``.

### `src/connectors/vtex/orders-parity.ts` (novo) — `orderParity(ctx, deps?)`

`deps` (para teste): `{ api?: Pick<iVtexApi, 'listOrders' | 'getOrder'>; writeReport?: typeof writeParityReport;
now?: Date }`. Padrão: `createBrandApi(brand)`, `writeParityReport`, `new Date()`.

1. **Janela.** Se `options.from`/`options.to` vierem, usa. Senão: `SELECT MAX(creation_date) AS ultima FROM <details>
LIMIT 1` → `to` = fim do dia de `ultima − DEFAULT_LAG_DAYS (30)`; `from` = `to − DEFAULT_WINDOW_DAYS (7)`. Motivo:
   pedidos com mais de 30 dias antes da parada do ETL antigo já estavam no estado final quando ele gravou.
2. **Lista** via `listOrdersInWindow(api, { from, to })` (`orders-window.ts`).
3. **Amostra**: `pickSample(listados ordenados por orderId, options.sample)`.
4. **Produção** (só os IDs da amostra), uma consulta por tabela:
    - `SELECT * FROM <tabela> WHERE order_id IN (?) LIMIT ?` para `vtex_orders`, `vtex_order_details` e as 8 filhas
      (`ORDER_CHILD_TABLES`); limite = `ids.length × MAX_ROWS_PER_ORDER (50)`.
    - `vtex_client_profile`: `WHERE id IN (?)` com a união de `client_profile_id` da produção e
      `clientProfileData.userProfileId` da API (pula a consulta se vazia).
5. **Detalhe na VTEX** da amostra com `runWithConcurrency(..., getEnv().HTTP_CONCURRENCY)`; falha entra nas notas com
   o ID e o pedido sai da comparação.
6. **Classificação** por pedido, comparando `vtex_order_details.last_change` da produção (normalizado com
   `toComparableUtc`) com `toComparableUtc(detail.lastChange)`:
    - `stable`: iguais → entra na comparação estrita;
    - `changedAfter`: diferentes → o pedido mudou depois que o ETL antigo gravou; não compara, só conta e lista IDs no
      `meta` do relatório;
    - `withoutProductionDetail`: sem linha em `vtex_order_details` → só conta e lista.
7. **Transformação** (só `stable`), exatamente como `orders-job.ts`:
    - `toOrderRow(order, accountOf(brand) ?? null)`; em `amobeleza_etl` (`hasSellerName`) acrescentar
      `seller_name: sellerNameOf(detail)`;
    - `toDetailRows(detail, { account, processedAtLocal: saoPauloWallClock(now) })`;
    - **substitutos de data**: quando a VTEX não manda `authorizedDate` (ou `invoicedDate`), a coluna
      `authorizeddate` (ou `invoiceddate`) recebe o horário da carga e nunca vai bater: nesses pedidos, copiar o valor da
      produção para a linha nova antes de comparar e contar quantos foram neutralizados (nota);
    - pedido que lança na transformação → nota com o ID, fora da comparação.
8. **Comparação** por tabela, só com as linhas dos pedidos `stable` dos dois lados:

    | Tabela                                     | `keyColumns`                                                      |
    | ------------------------------------------ | ----------------------------------------------------------------- |
    | `vtex_orders`                              | `order_id`                                                        |
    | `vtex_order_details`                       | `order_id`                                                        |
    | `vtex_order_items`                         | `uniqueid`                                                        |
    | `vtex_order_logistics_info`                | `order_id`, `item_index`                                          |
    | `vtex_order_logistics_delivery_ids`        | `order_id`, `item_index`, `courier_id`, `warehouse_id`, `dock_id` |
    | `vtex_order_shipping_data`                 | `order_id`, `address_id`                                          |
    | `vtex_order_payment_transactions`          | `order_id`, `transaction_id`                                      |
    | `vtex_order_payment_transactions_payments` | `order_id`, `payment_id`                                          |
    | `vtex_order_payment_gift_cards`            | `order_id`, `gift_card_id`                                        |
    | `vtex_order_rates`                         | `order_id`, `id`                                                  |
    | `vtex_client_profile`                      | `id`                                                              |

    Conferir cada coluna de chave no DDL de `db/schema/<banco>/<tabela>.sql`; se alguma não existir, usar a coluna mais
    próxima que identifique a linha e anotar no relatório final. `ignoreColumns`: o padrão (`id`, `created_at`,
    `updated_at`).

9. `redactPersonal` em cada resultado; relatório com `writeReport('vtex-orders-<brand>', results, meta)`, onde `meta` =
   `{ brand, database, window: {from, to}, sample, listed, stable, changedAfter: ids, withoutProductionDetail: ids,
failedDetails: ids, invalid: ids, neutralizedDates }`.
10. Devolve `{ reportPath, tables: summarize(results), notes }`. Notas: janela, listados, amostra, quantos `stable` /
    `changedAfter` / sem detalhe / falhas, datas neutralizadas, e `extraInNew` por tabela quando > 0.

### `src/connectors/vtex/catalog-parity.ts` (novo) — `catalogParity(ctx, deps?)`

`deps`: `{ api?: Pick<iVtexApi, 'getProductAndSkuIds' | 'getProduct' | 'getCategoryTree'>; writeReport? }`.

1. **Árvore**: `toCategoryTreeRows(await api.getCategoryTree(CATEGORY_TREE_LEVELS))` (exportar a constante de
   `catalog-job.ts`) × `SELECT * FROM vtex_category_tree LIMIT 5000`. `keyColumns: ['id']`, `ignoreColumns:
['created_at', 'updated_at']` (**não** ignorar `id`: é o ID da VTEX que o Power BI liga; ver
   `docs/conectores/vtex.md`). `skippedIds` vai para as notas.
2. **Mapa produto → SKUs**: `listProductAndSkuIds(api)` (já exportado de `catalog-job.ts`); amostra de `product_id`
   com `pickSample`; `toSkusAndProductsRows` só da amostra × `SELECT * FROM vtex_skus_and_products_id WHERE product_id
IN (?) LIMIT ?`. `keyColumns: ['product_id']`.
3. **Produtos**: só se `writesProducts(brand)` (a Amobeleza não grava). Mesma amostra; `getProduct` com
   `runWithConcurrency`; `toProductRow` (produto que lança → nota) × `SELECT * FROM vtex_products WHERE id IN (?)
LIMIT ?`. `keyColumns: ['id']`, `ignoreColumns: ['created_at', 'updated_at']`.
4. Relatório `vtex-catalog-<brand>` com `meta` `{ brand, database, sample, productsInCatalog, writesProducts }`;
   devolve o resumo como no de pedidos.

### `src/connectors/vtex/index.ts`

- `jobs = [{ ...ordersJob, parity: orderParity }, { ...catalogJob, parity: catalogParity }]` — a paridade entra aqui
  para não criar import circular entre os jobs e os módulos de paridade.

### Testes — `tests/connectors/vtex-parity.test.ts`

Sem rede e sem banco: `api` falsa a partir das fixtures públicas (`src/connectors/vtex/fixtures/`), `refReader` falso
que responde por nome de tabela no SQL (e guarda os SQL recebidos), `writeReport` falso que captura `results` e `meta`.

Montar o cenário do pedido a partir da fixture: o detalhe `fixture.orders[0]` e um item de lista
`{ ...fixture.list.list[0], orderId: detalhe.orderId, lastChange: detalhe.lastChange, creationDate:
detalhe.creationDate }`. A "produção" falsa devolve as linhas que a própria transformação gera, convertidas como o
MySQL devolveria (decimal como texto `"9.90"`, datas como `Date`).

1. Pedido estável e produção igual → todas as tabelas com `divergent` 0.
2. `last_change` da produção diferente → pedido em `changedAfter`, nenhuma linha comparada.
3. Produção com `sellingprice` em centavos (`"990.00"`) → `vtex_order_items` com 1 divergente e
   `divergentByColumn.sellingprice = 1`.
4. E-mail diferente em `vtex_client_profile` → a diferença existe e sai com `expected` e `actual` = `[mascarado]`.
5. Pedido sem `authorizedDate` na VTEX → `authorizeddate` neutralizada (sem divergência) e contada em `meta`.
6. Toda consulta recebida pelo `refReader` falso começa com `SELECT`, tem `LIMIT` e usa parâmetro.
7. `pickSample`: tamanho, determinismo, `size` maior que a lista.
8. Catálogo: árvore igual → 0 divergentes; `department` diferente → divergência em `department`; Amobeleza não consulta
   `vtex_products`.

## Verificação

```bash
npx vitest run tests/connectors
npm run typecheck && npm run lint && npm run format:check
```

Depois, na sessão principal (não no executor): rodar a paridade real com o túnel aberto, só leitura.

## Risco

Médio-baixo: só leitura na produção e na VTEX, nada é gravado. O ponto de atenção é dado pessoal no relatório
(`redactPersonal`) e consultas sempre com `LIMIT` e por chave.

## Resultado (24/11/2026)

Implementado e rodado contra a produção (só leitura). O resultado e as diferenças aceitas estão em
`docs/conectores/vtex.md`, na seção "Paridade com a produção".

Mudanças em relação a este plano, por causa da paridade real:

- Na Mascavo, o ETL antigo nunca atualizava o pedido. Por isso os pedidos que mudaram depois também entram na
  comparação, num grupo próprio, sem as colunas de andamento (`VOLATILE_COLUMNS`), em vez de só serem contados.
- `ACCEPTED_DIFFERENCES` (pedidos e catálogo): diferenças conhecidas, com o motivo. Ficam no relatório e não contam
  como divergência.
- A comparação de JSON é feita pelo conteúdo, porque a coluna JSON do MySQL reordena as chaves.
- Correções no ETL achadas pela paridade:
    - `payment_id` = `"0"` quando a VTEX manda o pagamento sem id (pedido de marketplace);
    - `order_group` nulo quando a VTEX não manda;
    - `seller_name` também para a própria loja.
