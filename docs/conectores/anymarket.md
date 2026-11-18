# Conector AnyMarket (fase 6)

Traz os pedidos de marketplace de **todas as contas** do token do AnyMarket (Mercado Livre, Amazon, Shopee, TikTok
Shop, Livelo...; inclusive a conta `MASCAVO`) e grava em `amobeleza_etl.anymarket_*`. É uma fonte **global**: roda uma
vez, não por marca. Os dois Power BI leem dessas tabelas (o da Mascavo filtra `account_name = 'MASCAVO'`; o da
Amobeleza usa todas as contas menos essa).

Código em `src/connectors/anymarket/`. DDL em `db/schema/amobeleza_etl/anymarket_*.sql`.

| Arquivo           | O que faz                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `index.ts`        | A fonte (`iSource`): sabe se o token está no `.env`, faz o `check-access`, registra o job |
| `client.ts`       | Cliente só GET, link `next` → caminho relativo, paginação, espera no 429, `check-access`  |
| `schemas.ts`      | zod da resposta (envelope paginado e pedido)                                              |
| `dates.ts`        | Data da API → instante UTC dentro da faixa da coluna (TIMESTAMP/DATETIME)                 |
| `transform.ts`    | Pedido → linhas das 6 tabelas (função pura), com conferência das faixas numéricas         |
| `orders-job.ts`   | Job `anymarket-orders`: janela, fatias, lotes, gravação                                   |
| `tables.ts`       | Nomes das tabelas e da coluna de ligação                                                  |
| `fixtures/*.json` | Página de exemplo montada com o exemplo **público** do schema `Order` da especificação    |

## Como rodar

```bash
npm run etl -- check-access --source anymarket          # sem token: "aguardando chave"
npm run etl -- db:apply                                  # recria as tabelas no Docker LOCAL
npm run etl -- run anymarket-orders --dry-run            # últimas 24 h, só conta
npm run etl -- run anymarket-orders --from 2026-10-05 --to 2026-11-18 --dry-run   # carga retroativa
npm run etl -- run anymarket-orders --fixture src/connectors/anymarket/fixtures/orders-page.json   # grava o exemplo
```

Sem `--dry-run`, a carga com o token grava comprador e endereço **reais** no MySQL local. Até a decisão da pergunta
**AMO-Q4** (pendência 7), com dado real só `--dry-run`.

Agenda: a cada 30 min (`*/30 * * * *`, fuso de São Paulo), quando o agendador for ligado.

Quando o token chegar, basta preencher `ANYMARKET_TOKEN` no `.env` (`ANYMARKET_BASE_URL` já aponta para a produção,
`https://api.anymarket.com.br/v2`).

## A API (confirmado na documentação oficial em 18/11/2026)

Fontes: especificação pública `https://developers.anymarket.com.br/specs/backoffice.pt-BR.json` (schemas `Page_Order` e
`Order`, operação `GET /orders`) e a página "Regras e comportamentos gerais da API"
(`/knowing_anymarket/first_steps/rules_api`).

- **Autenticação:** header `gumgaToken`. O guia oficial de integração também pede o header `platform` (identifica o
  sistema integrador: `TOTVS`, `WINTHOR`, `ERP_PROPRIO`...). Enviamos `platform: ERP_PROPRIO` — ver dúvidas.
- **Ambientes:** produção `https://api.anymarket.com.br/v2`, sandbox `https://sandbox-api.anymarket.com.br/v2`. Token de
  um não vale no outro (401).
- **`GET /orders`:** filtros `createdAfter`/`createdBefore` (intervalo máximo de **120 dias**; sem filtro de criação, só
  os últimos 120 dias), `updatedAfter`/`updatedBefore` (intervalo máximo de **7 dias**), `status`, `marketplace`,
  `marketplaceId`, `partnerId`, `shippingId`, `offset`, `limit` (5 a **100**), `sort`, `sortDirection`. Datas com fuso
  explícito, como `2021-11-25T14:00:00-03:00`; o conector manda em UTC (`+00:00`).
- **Paginação:** resposta `{ links: [{ rel, href }], content: [...], page: { size, totalElements, totalPages, number } }`.
  O `href` do `next` vem **absoluto**.
- **Limite de requisições:** 429 quando passa do limite. A resposta traz `ratelimit-limit`, `ratelimit-remaining`
  ("requisições restantes no minuto atual") e `ratelimit-reset` (segundos). **Não manda `Retry-After`.** O valor do
  limite não é documentado na v2 (varia por conta e plano).
- **Não usamos `/orders/feeds`:** é uma fila que o integrador confirma com `PUT`. Além de exigir escrita, consumiria a
  fila que o ERP da cliente pode estar usando. A leitura é só por `GET /orders`.

## Como o conector lê

1. **Janela pela data de atualização** (`updatedAfter`/`updatedBefore`): pega pedido novo e mudança de status de pedido
   antigo. Sem `--from/--to`: as últimas **24 h** a cada 30 min. A sobreposição cobre o pedido que muda durante a
   paginação e uma parada curta do agendador. Parada longa: carga manual com `--from/--to`.
2. **Fatias de 1 dia** (abaixo do teto de 7 dias da API): menos páginas por consulta e menos deslocamento de offset.
3. **Páginas de 100.** Segue o link `next`: confere que é o mesmo host e o mesmo caminho base do `ANYMARKET_BASE_URL`
   (senão `SafetyError`), reduz a caminho relativo + parâmetros e **reaplica os filtros da janela** por cima (se a API
   devolver um `next` sem filtros, a carga não sai varrendo todos os pedidos). Offset que não avança ou mais de 1.000
   páginas numa fatia → erro, em vez de laço infinito. No fim da fatia, total recebido diferente do `totalElements` da
   primeira página vira aviso no log.
4. **429:** o transporte do núcleo já tenta de novo com espera exponencial curta (`HTTP_MAX_ATTEMPTS`). Se ainda vier
   429, o conector espera **60 s** (a janela do limite é de 1 minuto) e repete a mesma página, até 3 vezes.
5. **Validação na borda:** o envelope é estrito (`content` nulo vale como página vazia); cada pedido é validado sozinho.
   Obrigatório só o que identifica e classifica o pedido no painel: `id`, `accountName`, `marketPlace`, `status` e
   `createdAt` com fuso e dentro da faixa do TIMESTAMP. Pedido sem isso é **pulado** e aparece nas notas do resumo (só o
   ID; no log, só ID e nome dos campos). Enum (status, marketplace) é texto livre: marketplace novo não para a carga.
6. **Faixa das colunas** (o MySQL roda em modo estrito; um valor fora da faixa derrubaria o lote de 500 e travaria as
   cargas seguintes no mesmo pedido):
    - data opcional sem fuso, ilegível ou fora da faixa (TIMESTAMP: 1970-01-01 00:00:01 a 2038-01-19; DATETIME: anos
      1000 a 9999) vira `NULL` — é o caso das datas "sentinela" como `1970-01-01T00:00:00Z` — e entra na contagem das
      notas, por campo;
    - número que não cabe na coluna (`decimal(8,2)` até 999.999,99 no pedido, `decimal(10,2)` nos itens e pagamentos,
      `int`) faz o pedido ser **recusado**, com o ID nas notas e o nome da coluna no log.
7. **Pedido sem mudança:** no processo do agendador, o `lastUpdate` já gravado de cada pedido fica em memória e o pedido
   que volta igual na janela seguinte não é regravado (sem isso, cada pedido do dia seria regravado ~48 vezes). Cada
   `npm run etl` é um processo novo: carga manual grava tudo. Depois de um `db:apply`, reinicie o agendador.
8. **Erro do banco** sobe só com o código e o nome da coluna: o mysql2 guarda em `err.sql` o INSERT montado, com dado
   pessoal, e o runner loga o erro inteiro (pendência 10).

## Gravação

Lotes de 500 pedidos, cada lote numa transação (erro → ROLLBACK do lote):

| Tabela                     | Estratégia                               | Linhas por pedido              |
| -------------------------- | ---------------------------------------- | ------------------------------ |
| `anymarket_orders`         | `upsert` pela PK `id` (id do pedido)     | 1                              |
| `anymarket_order_items`    | `replaceByKeys` por `anymarket_order_id` | 1 por item                     |
| `anymarket_order_payments` | `replaceByKeys` por `anymarket_order_id` | 1 por pagamento                |
| `anymarket_order_shipping` | `replaceByKeys` por `anymarket_order_id` | 1, se vier endereço de entrega |
| `anymarket_order_tracking` | `replaceByKeys` por `anymarket_order_id` | 1, se vier rastreio            |
| `anymarket_order_buyer`    | `replaceByKeys` por `anymarket_order_id` | 1, se vier comprador           |

O mesmo pedido em duas páginas do mesmo lote fica com a última versão (sem filha duplicada). `created_at`/`updated_at`
são do writer (horário UTC da carga; o upsert não sobrescreve `created_at`).

Convenções (`docs/contrato/convencoes.md`):

- **Valores em reais**, como a API manda. O Power BI usa o valor bruto do AnyMarket sem dividir por 100 (só a VTEX vem
  em centavos).
- **Datas em UTC.** O Power BI subtrai 3 h das datas do AnyMarket também.
- **Status sem tradução** (`PENDING`, `PAID_WAITING_SHIP`, `INVOICED`, `PAID_WAITING_DELIVERY`, `CONCLUDED`,
  `CANCELED`...).
- Coluna `NOT NULL` sem valor na API: `0` nos valores e em `id_account`, `''` no texto (ex.: `market_place_id`,
  `market_place_number`, `transmission_status`, `market_place_status`, `deliver_status`).
- Texto maior que a coluna é cortado no tamanho dela (255; `sku_kit_partner_id` 100).

## De-para dos campos

`anymarket_orders` (grafia original, inclusive `invoce_number`):

| Coluna                                | Campo da API                                   | Coluna                | Campo da API        |
| ------------------------------------- | ---------------------------------------------- | --------------------- | ------------------- |
| `id`                                  | `id`                                           | `discount`            | `discount`          |
| `account_name`                        | `accountName`                                  | `freight`             | `freight`           |
| `market_place_id`                     | `marketPlaceId`                                | `seller_freight`      | `sellerFreight`     |
| `market_place_number`                 | `marketPlaceNumber`                            | `interest_value`      | `interestValue`     |
| `market_place`                        | `marketPlace`                                  | `gross`               | `gross`             |
| `order_created_at`                    | `createdAt`                                    | `total`               | `total`             |
| `payment_date`                        | `paymentDate`                                  | `deliver_status`      | `deliveryStatus`    |
| `transmission_status`                 | `transmissionStatus`                           | `id_account`          | `idAccount`         |
| `status`                              | `status`                                       | `fulfillment`         | `fulfillment` (1/0) |
| `invoice_access_key`                  | `invoice.accessKey`                            | `order_type_name`     | `orderTypeName`     |
| `invoice_series`                      | `invoice.series`                               | `invoce_number`       | `invoice.number`    |
| `invoice_date`                        | `invoice.date`                                 | `market_place_status` | `marketPlaceStatus` |
| `meta_data_need_invoice_xml`          | `metadata.needInvoiceXML` (1/0)                |                       |                     |
| `meta_data_fiscal_document_file_type` | `metadata.fiscalDocumentFileType` _(assumido)_ |                       |                     |
| `meta_data_system_origin`             | `metadata.systemOrigin` _(assumido)_           |                       |                     |
| `meta_data_shipping_type_to_send`     | `metadata.shippingTypeToSend` _(assumido)_     |                       |                     |

`anymarket_order_items` (um por `items[]`): `product_id`/`product_name` ← `product.id`/`.title`;
`sku_id`/`sku_name`/`sku_partner_id`/`sku_partner_ean` ← `sku.id`/`.title`/`.partnerId`/`.ean`;
`sku_kit_id`/`_title`/`_partner_id`/`_amount` ← `skuKit.*` _(assumido)_; `amount`, `unit`, `gross`, `discount`, `total`;
`id_in_marketplace` ← `idInMarketPlace`; `marketplace_id` ← `marketPlaceId`; `order_item_id` ← `orderItemId`;
`free_shipping` ← `freeShipping` (1/0).

`anymarket_order_payments` (um por `payments[]`): `method`, `status`, `value`, `market_place_id` ← `marketplaceId`.

`anymarket_order_shipping` (← `shipping`): `city`, `state`, `country`, `country_acronym_normalized` ←
`countryAcronymNormalized`, `country_normalized` ← `countryNameNormalized`, `address`, `number`, `neighborhood`,
`street`, `zip_code` ← `zipCode`, `receiver_name` ← `receiverName`, `promised_shipping_time` ← `promisedShippingTime`.

`anymarket_order_tracking` (← `tracking`): `url`, `number`, `carrier`, `date`, `estimate_date`, `shipped_date`,
`delivered_date`.

`anymarket_order_buyer` (← `buyer`, **dado pessoal**): `name`, `email`, `document`, `document_type` ← `documentType`.

## Check-access

`GET /orders` com `createdAfter=2000-01-01T00:00:00+00:00` e `createdBefore=2000-01-01T00:00:01+00:00`: uma janela de 1 s
sem pedido. Prova que o token lê pedidos **sem trazer dado da cliente**; só confere o formato do envelope. 401/403 vira
"token recusado: confira `ANYMARKET_TOKEN` e o ambiente". 400/422 (a API recusou a janela de teste) conta como token
aceito: a autenticação vem antes da validação dos filtros.

## O que depende do token

- `check-access` real e a primeira carga em `--dry-run`.
- Confirmar: `platform`, formato de data aceito nos filtros, se o `next` preserva os filtros, as chaves de `metadata`, o
  formato de kit e o limite de requisições da conta.

## Pendências e dúvidas

1. **DDL provisória.** Escrita do dicionário da WPP ("Documentação Amobeleza", seção 2.5, p. 30–34). Tipos, `NOT NULL`
   e índices vêm do dicionário; nomes de índice no padrão do Laravel. O `schema:pull` (usuário só leitura) substitui.
2. **Header `platform`** _(assumido: `ERP_PROPRIO`)_. A especificação só exige `gumgaToken`; o guia oficial diz que sem
   `platform` a API dá 401. Se o `check-access` der 401 com o token certo, é o primeiro suspeito.
3. **`metadata` → `meta_data_*`** _(assumido)_. Só `needInvoiceXML` está na especificação; as outras três chaves foram
   deduzidas do nome da coluna. Confirmar com um pedido real e na paridade.
4. **Kits** _(assumido)_. O dicionário diz que `anymarket_order_items` "inclui decomposição de kits", mas o objeto
   `skuKit` não está na especificação pública. Confirmar com um pedido de kit real e na paridade.
5. **`NOT NULL` sem valor** (`''` e `0`) — conferir na paridade o que o ETL antigo gravava.
6. **Linhas a mais na produção.** `anymarket_order_shipping` tem 3,47 mi linhas para 3,19 mi pedidos: o ETL antigo
   parece ter duplicado filhas. O conector grava uma por pedido. O Power BI da Amobeleza usa `anymarket_orders`,
   `_tracking` e `_items` (o join em `_items` "multiplica linhas antes da deduplicação", segundo a doc) — conferir na
   paridade se algum número do painel depende da duplicidade.
7. **Dado pessoal no Docker local** (pergunta **AMO-Q4**, aguarda o Matheus). Com o token, `run anymarket-orders` sem
   `--dry-run` grava comprador e endereço reais no MySQL local; o `CLAUDE.md` diz "nada de dado de produção no Docker
   local", e o ADR das travas diz que as cargas reais gravam no Docker local. Até decidir, com dado real só `--dry-run`.
8. **429 e o núcleo.** O transporte lê `Retry-After`, que o AnyMarket não manda. O conector contorna com a espera de
   60 s; um PR no núcleo pode ensinar o transporte a ler `ratelimit-reset` (fora do escopo desta fase).
9. **Paridade** ainda não implementada (precisa do usuário só leitura no banco da cliente).
10. **`err.sql` no log (núcleo).** O mysql2 guarda o SQL montado em `err.sql`, o serializador do pino copia toda
    propriedade do erro e o `redact` do `src/config/logger.ts` não cobre `sql`: uma falha de banco no meio do lote
    levaria dado pessoal para o log, nesta fonte e na VTEX. O conector já relança só o código; o conserto definitivo é
    um PR no núcleo (`err.sql`, `*.sql`, `err.cause.sql` no redact, ou serializador de `err` sem `sql`).
11. **Offset em fatia antiga.** Paginação por offset sobre um conjunto que muda: se um pedido de uma fatia passada é
    atualizado durante a leitura, ele sai da fatia e o pedido seguinte pode pular de página. Na janela de 24 h a
    sobreposição recupera; na carga retroativa, não. Rodar a carga retroativa duas vezes (é idempotente) ou fora do
    horário de pico; o aviso de `totalElements` no log mostra quando aconteceu.
