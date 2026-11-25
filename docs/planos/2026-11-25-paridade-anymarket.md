# Plano — Paridade do AnyMarket (anymarket-orders)

Pergunta AMO-Q31 (25/11/2026). Mesma ideia da paridade da VTEX (`docs/planos/2026-11-24-paridade-vtex.md` e
`src/connectors/vtex/orders-parity.ts`): provar, numa amostra, que o ETL novo monta as mesmas linhas que o ETL antigo
gravou nas 6 tabelas `amobeleza_etl.anymarket_*`. Pré-requisito para liberar a gravação em produção.

## Objetivo

`npm run etl -- parity anymarket-orders [--sample 200] [--from AAAA-MM-DD --to AAAA-MM-DD]`. O job é global, sem
`--brand`, e o banco é sempre `amobeleza_etl`. O comando:

1. lista na API os pedidos **criados** numa janela antiga (só GET, pelo cliente do conector);
2. transforma em memória com a **mesma** função da carga (`toOrderRows`, em `transform.ts`);
3. lê a produção só com `ctx.refReader.query` (SELECT por chave, com `LIMIT`);
4. compara com `compareRows`;
5. grava o relatório em `reports/`, fora do Git, e imprime só contagens e notas.

**Nada é gravado em banco nenhum.**

## Regras que não podem quebrar

- As mesmas da paridade da VTEX:
    - produção só por `ctx.refReader.query`, um SELECT por consulta, sem comentário, com `LIMIT`, filtrando por chave;
    - a única exceção é o `MAX(order_created_at)` da janela padrão (agregado com `LIMIT 1`).
- **Dado pessoal:** as diferenças nas colunas de `PERSONAL_COLUMNS` (`src/connectors/anymarket/personal-data.ts`,
  exportar a constante) saem com `expected`/`actual` = `MASK`. Elas incluem comprador e endereço. Nada de valor no
  log.
- A API do AnyMarket é só GET, pelo cliente que já existe (`client.ts`). Nada de URL absoluta nova.

## 1. Mover o que é genérico para o núcleo (refatoração pequena)

Hoje `src/connectors/vtex/parity-shared.ts` tem peças que servem a qualquer conector. Criar
`src/core/parity/helpers.ts` com:

- `pickSample`;
- `summarize(results, accepted?)`;
- `acceptedNotes`;
- `extraNotes`;
- `qualified`;
- o tipo `tAcceptedDifferences`;
- `redactColumns(table, result, personal: Readonly<Partial<Record<string, readonly string[]>>>, mask: string)`.

Depois:

- `src/connectors/vtex/parity-shared.ts` passa a importar e reexportar esses itens. O `redactPersonal` dele vira um
  invólucro de `redactColumns` com o `PERSONAL_COLUMNS`/`MASK` da VTEX. Assim os imports e os testes da VTEX não mudam.
- Nenhum comportamento muda. Os testes existentes de `tests/connectors/vtex-parity.test.ts` continuam verdes, sem
  edição.

## 2. `src/connectors/anymarket/parity.ts` (novo) — `anymarketParity(ctx, deps?)`

`deps` (para teste):

```ts
{
	listPages?: (filters: tQueryParams) => AsyncGenerator<tOrdersPage>
	writeReport?: typeof writeParityReport
}
```

Padrões:

- `listPages`: `listOrderPages(createAnymarketClient(), filters, ctx.logger)`;
- `writeReport`: `writeParityReport`.

Passos:

1. **Janela.** Com `--from`/`--to`, usa. Com só um deles, o outro fica `DEFAULT_WINDOW_DAYS` adiante ou para trás.
   Sem nenhum dos dois:
   `SELECT MAX(order_created_at) AS ultima FROM amobeleza_etl.anymarket_orders LIMIT 1` → `to` = fim do dia de
   `ultima − DEFAULT_LAG_DAYS (30)`, `from` = `to − DEFAULT_WINDOW_DAYS (2)`.

    A janela é de 2 dias, e não 7 como na VTEX, porque o AnyMarket tem cerca de 3 mil pedidos por dia somando todas as
    contas.

2. **Lista** por data de **criação**: filtros `{ createdAfter, createdBefore }`, com `formatApiDate` (o mesmo formato
   do `CHECK_WINDOW` de `client.ts`). Uma consulta por fatia de 1 dia, como o `apiPages` de `orders-job.ts`
   (exportar `sliceWindow`, que já está exportado). Cada pedido da página passa por `orderSchema.safeParse`; o
   inválido entra nas notas pelo ID cru.
3. **Amostra**: `pickSample(pedidos válidos ordenados por id, options.sample)`.
4. **Produção**, só dos IDs da amostra:
    - `SELECT * FROM amobeleza_etl.anymarket_orders WHERE id IN (?) LIMIT ?`;
    - nas 5 filhas, `WHERE anymarket_order_id IN (?) LIMIT ?`, com limite `ids.length × 50`.
5. **Transformação**: `toOrderRows(order)` para cada pedido da amostra. Pedido com `outOfRange` preenchido sai da
   comparação, com o ID nas notas, porque a carga também o recusaria.
6. **Classificação**, por pedido que existe nos dois lados:
    - **`changedAfter`**: alguma das colunas de andamento de `anymarket_orders` difere entre a produção e a linha nova.
      As colunas são `status`, `market_place_status`, `transmission_status`, `deliver_status`, `payment_date`,
      `invoice_access_key`, `invoice_series`, `invoce_number` e `invoice_date`.
    - **`stable`**: nenhuma difere.
    - **`withoutProduction`**: o pedido não está em `anymarket_orders` da produção. Só conta e lista.
7. **Comparação** por grupo, como `orders-parity.ts` da VTEX. O grupo "mudou depois" ganha o sufixo
   ` (mudou depois)` no nome da tabela e ignora `VOLATILE_COLUMNS`:

    | Tabela                     | `keyColumns`                                                  | `ignoreColumns` base             |
    | -------------------------- | ------------------------------------------------------------- | -------------------------------- |
    | `anymarket_orders`         | `id`                                                          | `created_at`, `updated_at`       |
    | `anymarket_order_items`    | `anymarket_order_id`, `sku_id`, `sku_kit_id`, `order_item_id` | `id`, `created_at`, `updated_at` |
    | `anymarket_order_payments` | `anymarket_order_id`, `method`, `value`                       | `id`, `created_at`, `updated_at` |
    | `anymarket_order_shipping` | `anymarket_order_id`                                          | `id`, `created_at`, `updated_at` |
    | `anymarket_order_tracking` | `anymarket_order_id`, `number`                                | `id`, `created_at`, `updated_at` |
    | `anymarket_order_buyer`    | `anymarket_order_id`                                          | `id`, `created_at`, `updated_at` |

    `VOLATILE_COLUMNS`:
    - `anymarket_orders`: as 9 colunas de andamento do passo 6;
    - `anymarket_order_payments`: `status`;
    - `anymarket_order_tracking`: `url`, `carrier`, `date`, `estimate_date`, `shipped_date` e `delivered_date`.

    Em `anymarket_orders`, `id` é o ID do pedido no AnyMarket, ou seja, dado de negócio. Por isso não fica no
    `ignoreColumns`.

8. **`ACCEPTED_DIFFERENCES`**: começa vazio (`{}`), com o comentário de que se preenche depois da paridade real, cada
   coluna com o motivo, como na VTEX.
9. **Relatório**: `redactColumns` com o `PERSONAL_COLUMNS`/`MASK` do AnyMarket. Grava com
   `writeReport('anymarket-orders', results, meta)`. O `meta` leva:
    - `database`, `window`, `sample`, `listed`;
    - `byAccount`: contagem da amostra por `account_name`;
    - `stable`, e as listas de IDs `changedAfter`, `withoutProduction`, `invalid` e `outOfRange`;
    - `volatileColumns` e `acceptedDifferences`.
10. Devolve `{ reportPath, tables: summarize(results, ACCEPTED_DIFFERENCES), notes }`. As notas trazem:
    - janela, quantos listados e o tamanho da amostra;
    - contagem por conta;
    - quantos `stable`, `changedAfter` e sem produção;
    - inválidos;
    - `extraNotes` e `acceptedNotes`.

## 3. `src/connectors/anymarket/index.ts`

`jobs = [{ ...anymarketOrdersJob, parity: anymarketParity }]`.

## 4. Correção do log do dry-run (`orders-job.ts`, linha do `'AnyMarket: lote gravado'`)

No dry-run, a mensagem deve ser `'AnyMarket: lote processado (dry-run, nada gravado)'`, mantendo os campos `orders` e
`written`. Hoje ela diz "gravado" mesmo sem gravar.

## Testes — `tests/connectors/anymarket-parity.test.ts`

Sem rede e sem banco. Para os pedidos, use a fixture que o conector já tem: procure `fixture` em
`src/connectors/anymarket/` e `src/connectors/anymarket/fixtures/`. Se não houver, monte 1 pedido mínimo válido pelo
`orderSchema`.

Peças falsas:

- `listPages` que devolve uma página;
- `refReader` que responde pelo nome da tabela no SQL e guarda os SQL recebidos;
- `writeReport` que captura `results` e `meta`.

A "produção" falsa devolve as linhas da própria `toOrderRows`, como o MySQL devolveria (decimal como texto, datas
como `Date`).

1. Pedido igual nos dois lados → todas as tabelas com `divergent` 0, e `meta.stable` = 1.
2. `status` diferente na produção → o pedido vai para `changedAfter` e é comparado no grupo `(mudou depois)` sem
   divergência.
3. `gross` diferente (ex.: em centavos na produção) → `anymarket_orders` com 1 divergente e
   `divergentByColumn.gross = 1`.
4. `email` diferente em `anymarket_order_buyer` → a diferença sai com `[mascarado]` dos dois lados.
5. Pedido fora da produção → entra em `withoutProduction` e não é comparado.
6. Toda consulta ao `refReader` falso começa com `SELECT`, tem `LIMIT` e usa parâmetro.
7. Os testes da VTEX continuam verdes sem mudança, o que prova a refatoração.

## Verificação

```bash
npx vitest run tests/connectors
npx vitest run
npm run typecheck && npm run lint && npm run format:check
```

Depois, na sessão principal (não no executor): rodar a paridade real com o túnel aberto, só leitura.

## Risco

Médio-baixo:

- só leitura na produção e na API, nada é gravado;
- a refatoração dos helpers não muda comportamento, e os testes da VTEX provam isso;
- o ponto de atenção é dado pessoal: comprador e endereço precisam sair mascarados no relatório.
