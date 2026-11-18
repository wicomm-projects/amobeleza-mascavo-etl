# Dicionário `mascavo_etl` — tabelas das etapas 1 (VTEX) e 3 (GA4)

Extraído da "Documentação Mascavo" da WPP (79 p., levantamento de 05/10/2026), páginas indicadas em cada tabela. Só
estrutura: nenhum dado, host ou credencial. É **provisório** até o `schema:pull` trazer o DDL real (índices, charset).

Legenda: Nulo = aceita nulo; Chave = PK / IDX / UNI (vazio = sem chave). Toda tabela termina com `created_at` e
`updated_at` (`timestamp`, nulo Sim), salvo indicação. Segundo a WPP, as tabelas VTEX do `amobeleza_etl` têm a mesma
estrutura (p. 10) — confirmar no `schema:pull`.

## Pedidos VTEX (p. 10–19)

### `vtex_orders` — 223.292 linhas (p. 12–13). **Sem PK**; `order_id` é a "chave lógica".

| Coluna                      | Tipo          | Nulo | Chave | Nota                         |
| --------------------------- | ------------- | ---- | ----- | ---------------------------- |
| order_id                    | varchar(255)  | Não  | IDX   | ex. 1665527299796-01         |
| order_date                  | datetime      | Não  |       | UTC                          |
| total_value                 | decimal(10,2) | Não  |       | em centavos (Power BI ÷ 100) |
| status                      | varchar(255)  | Sim  | IDX   | inglês                       |
| status_description          | varchar(255)  | Não  | IDX   | português                    |
| market_place_order_id       | varchar(255)  | Sim  |       |                              |
| sequence                    | varchar(255)  | Não  |       |                              |
| sales_channel               | varchar(255)  | Não  | IDX   |                              |
| affiliate_id                | varchar(255)  | Sim  | IDX   |                              |
| origin                      | varchar(255)  | Não  | IDX   | Marketplace, Fulfillment...  |
| workflow_in_error_state     | tinyint(1)    | Não  |       |                              |
| workflow_in_retry           | tinyint(1)    | Não  |       |                              |
| shipping_estimated_date     | datetime      | Sim  |       |                              |
| shipping_estimated_date_max | datetime      | Sim  |       |                              |
| shipping_estimated_date_min | datetime      | Sim  |       |                              |
| order_is_complete           | tinyint(1)    | Não  |       |                              |
| authorized_date             | datetime      | Sim  |       |                              |
| total_items                 | int           | Não  |       |                              |
| currency_code               | varchar(10)   | Não  |       | BRL                          |
| hostname                    | varchar(255)  | Não  |       | conta/loja VTEX              |
| last_change                 | datetime      | Sim  |       |                              |
| is_all_delivered            | tinyint(1)    | Sim  |       |                              |
| is_any_delivered            | tinyint(1)    | Sim  |       |                              |
| ready_for_handling_date     | datetime      | Sim  |       |                              |

### `vtex_order_details` — 227.447 linhas (p. 13–14). PK `order_id`; 1:1 com `vtex_orders`.

| Coluna                        | Tipo          | Nulo | Chave                 |
| ----------------------------- | ------------- | ---- | --------------------- |
| order_id                      | varchar(255)  | Não  | PK                    |
| sequence                      | varchar(255)  | Não  |                       |
| client_profile_id             | varchar(255)  | Sim  | IDX                   |
| marketplace_order_id          | varchar(255)  | Sim  |                       |
| marketplace_services_endpoint | varchar(255)  | Não  |                       |
| seller_order_id               | varchar(255)  | Sim  |                       |
| origin                        | varchar(255)  | Não  | IDX                   |
| affiliate_id                  | varchar(255)  | Sim  |                       |
| sales_channel                 | varchar(3)    | Não  | IDX                   |
| merchant_name                 | varchar(255)  | Sim  |                       |
| status                        | varchar(255)  | Não  | IDX                   |
| status_description            | varchar(255)  | Não  |                       |
| value                         | decimal(10,2) | Não  |                       |
| creation_date                 | datetime      | Não  |                       |
| last_change                   | datetime      | Não  |                       |
| order_group                   | varchar(255)  | Sim  |                       |
| totals_items                  | decimal(10,2) | Não  |                       |
| totals_discounts              | decimal(10,2) | Não  | (negativo na VTEX)    |
| totals_shipping               | decimal(10,2) | Não  |                       |
| totals_taxes                  | decimal(10,2) | Não  |                       |
| followup_email                | varchar(255)  | Não  | (mascarado pela VTEX) |
| hostname                      | varchar(255)  | Não  |                       |
| opentextfield                 | varchar(255)  | Sim  |                       |
| roundingerror                 | int           | Não  |                       |
| orderformid                   | varchar(255)  | Sim  |                       |
| commercialconditiondata       | json          | Sim  |                       |
| iscompleted                   | tinyint(1)    | Não  |                       |
| allowcancellation             | tinyint(1)    | Não  |                       |
| allowedition                  | tinyint(1)    | Não  |                       |
| ischeckedin                   | tinyint(1)    | Não  |                       |
| utm_source                    | varchar(255)  | Sim  | IDX                   |
| coupon                        | varchar(255)  | Sim  | IDX                   |
| authorizeddate                | datetime      | Não  |                       |
| invoiceddate                  | datetime      | Não  | (ver convencoes.md)   |

### `vtex_order_items` — 583.810 linhas (p. 14–15). PK `uniqueid`.

| Coluna            | Tipo          | Nulo | Chave | Nota                         |
| ----------------- | ------------- | ---- | ----- | ---------------------------- |
| order_id          | varchar(255)  | Não  | IDX   |                              |
| uniqueid          | varchar(255)  | Não  | PK    |                              |
| id                | int           | Não  | IDX   | SKU                          |
| productid         | int           | Não  | IDX   |                              |
| ean               | varchar(255)  | Sim  |       |                              |
| lockid            | varchar(255)  | Não  |       |                              |
| quantity          | int           | Não  |       |                              |
| seller            | int           | Não  |       |                              |
| name              | varchar(255)  | Não  |       |                              |
| refid             | varchar(255)  | Não  |       |                              |
| price             | decimal(10,2) | Não  |       |                              |
| listprice         | decimal(10,2) | Não  |       |                              |
| manualprice       | int           | Sim  |       |                              |
| imageurl          | varchar(255)  | Sim  |       |                              |
| detailurl         | varchar(255)  | Sim  |       |                              |
| sellersku         | varchar(255)  | Não  |       |                              |
| commission        | int           | Não  |       |                              |
| tax               | int           | Não  |       |                              |
| presaledate       | datetime      | Sim  |       |                              |
| additionalinfo    | json          | Não  |       | marca, categorias, dimensões |
| measurementunit   | varchar(10)   | Não  |       |                              |
| unitmultiplier    | decimal(8,4)  | Não  |       |                              |
| sellingprice      | decimal(10,2) | Não  |       |                              |
| isgift            | tinyint(1)    | Não  |       |                              |
| shippingprice     | decimal(10,2) | Sim  |       |                              |
| rewardvalue       | int           | Não  |       |                              |
| freightcommission | int           | Não  |       |                              |
| taxcode           | varchar(255)  | Não  |       |                              |
| costprice         | decimal(10,2) | Não  |       |                              |

### `vtex_order_logistics_info` — 683.183 linhas (p. 15–16)

`id` bigint unsigned PK (técnico) · `order_id` varchar(255) Não IDX · `sku_id` int Sim IDX · `item_index` int Não (mesma
posição do item no pedido) · `selected_sla` varchar(255) Sim · `lock_ttl` varchar(255) Sim · `price`, `list_price`,
`selling_price` decimal(10,2) Sim · `delivery_window`, `delivery_company`, `delivery_channel`, `address_id` varchar(255) Sim.

### `vtex_order_logistics_delivery_ids` — 696.547 linhas (p. 16)

`id` bigint unsigned PK · `order_id` varchar(255) Não IDX · `item_index` int Não · `courier_id`, `courier_name`, `dock_id`
varchar(255) Sim · `quantity` int Sim · `warehouse_id`, `account_carrier_name` varchar(255) Sim.

### `vtex_order_shipping_data` — 200.456 linhas (p. 17). **Sem PK.**

`order_id` varchar(255) Não IDX · `address_id` varchar(255) Não · `address_type`, `neighborhood`, `postal_code`, `city`,
`state`, `country` varchar(255) Sim IDX.

### `vtex_order_payment_transactions` — 203.742 linhas (p. 17)

`id` bigint unsigned PK · `order_id` varchar(255) Não IDX · `is_active` tinyint(1) Sim IDX · `transaction_id`
varchar(255) Sim IDX · `merchant_name` varchar(255) Sim IDX.

### `vtex_order_payment_transactions_payments` — 211.508 linhas (p. 18)

`id` bigint unsigned PK · `order_id`, `transaction_id`, `payment_id`, `payment_system` varchar(255) Não IDX ·
`payment_system_name` varchar(255) Não · `value` decimal(10,2) Sim · `installments` int Sim · `reference_value`
decimal(10,2) Sim · `redemption_code`, `gift_card_id`, `gift_card_name`, `gift_card_caption` varchar(255) Sim ·
`gift_card_as_discount` tinyint(1) Sim · `gift_card_provider` varchar(255) Sim · `group` varchar(255) Sim (palavra
reservada) · `tid` varchar(255) Sim.

### `vtex_order_payment_gift_cards` — 14.619 linhas (p. 19)

`id` bigint unsigned PK · `order_id` varchar(255) Não IDX · `gift_card_id` varchar(255) Não · `redemption_code`, `name`,
`caption` varchar(255) Sim · `value`, `balance` decimal(10,2) Sim · `provider`, `group_name` varchar(255) Sim · `in_use`,
`is_special_card` tinyint(1) Sim.

### `vtex_order_rates` — 436.618 linhas (p. 19). **Sem PK.** (ratesAndBenefits)

`order_id` varchar(255) Não IDX · `featured` tinyint(1) Não · `id` varchar(255) Não IDX (promoção) · `name` varchar(255)
Não IDX.

**Relacionamentos (p. 10–11):** details, items, shipping, payment_transactions, gift_cards e rates → `vtex_orders.order_id`;
payments → `transactions.transaction_id`; logistics_info ↔ items por `order_id` + `item_index`; delivery_ids ↔
logistics_info por `order_id` + `item_index`; `shipping_data.address_id` ↔ `logistics_info.address_id`.

## Catálogo VTEX (p. 20–23)

### `vtex_products` — 333 linhas (p. 20–21)

`id` bigint unsigned PK (ID do produto) · `name` varchar(255) Não · `department_id`, `category_id`, `brand_id` int Não IDX ·
`link_id`, `ref_id` varchar(255) Não · `is_visible` tinyint(1) Não · `description`, `description_short`, `release_date`
(varchar), `key_words`, `title` varchar(255) Sim · `is_active` tinyint(1) Não · `tax_code`, `meta_tag_description`,
`supplier_id`, `show_without_stock`, `ad_words_remarketing_code`, `lomadee_campaign_code`, `score` varchar(255) Sim.

### `vtex_category_tree` — 22 linhas (p. 23)

`id` bigint unsigned PK · `name` varchar(255) Não · `department` varchar(255) Sim IDX · `has_children` tinyint(1) Não ·
`url`, `title`, `meta_tag_description` varchar(255) Não · `sub_category_id` int Sim IDX (0 = raiz).

### `vtex_skus_and_products_id` — 333 linhas (p. 22)

`id` bigint unsigned PK · `product_id` int Não IDX · `sku_id` json Sim (lista de SKUs do produto).

### `vtex_client_profile`

Colunas não extraídas ainda: a sessão da etapa 1 lê na doc da Mascavo. Tem dado pessoal (nome, documento, e-mail,
telefone).

## GA4 — antigas planilhas do Supermetrics (p. 31–38, 46)

O B2C da Mascavo lê `trafego`, `vendas`, `users`, `items` e `category` (p. 60–61, 65). `transacoes`, `navegacao`,
`ev_navegacao`, `por_hora`, `trafego_dedup` e `transaction_last_click` não aparecem no B2C da Mascavo (a Amobeleza usa
o conjunto básico no Web Analytics).

### `sheets_google_drive_trafego` — 126.992 linhas, parada desde 19/08/2026 (p. 31–32)

`id` PK · `date` date Sim IDX · `ga4_property_id` **int** Sim · `session_source`, `session_campaign_name`,
`platform_device_category` varchar(255) Sim · `event_count` int Sim · `vehicle_channel_no_pay` varchar(255) Sim (canal
classificado) · `type` varchar(255) Sim (pago / não pago). Não há coluna de sessões: o Power BI chama de "Sessões" —
provavelmente `event_count` de um evento de sessão (confirmar).

### `sheets_google_drive_vendas` — 35.997 linhas, parada desde 21/08/2026 (p. 33)

`id` PK · `date` date Sim IDX · `ga4_property_id` **varchar(255)** Sim · `source`, `event_campaign_name`,
`platform_device_category` varchar(255) Sim · `purchase_revenue` decimal(10,2) Sim · `conversions` decimal(10,2) Sim ·
`vehicle_channel_no_pay`, `type` varchar(255) Sim · `investment` varchar(255) Sim (texto).

### `sheets_google_drive_users` — 21.049 linhas (p. 36)

`Date` date Não PK · `Session_source` varchar(255) Não PK (PK composta) · `First_time_purchasers`, `New_users` int Não ·
`created_at`/`updated_at` **datetime** Sim.

### `sheets_google_drive_items` — 163.376 linhas, parada desde 20/08/2026 (p. 35)

Sem `id`; PK composta das cinco colunas: `Date` date, `Session_source` varchar(255), `Item_name` varchar(255),
`Item_revenue` **double**, `Item_purchase_quantity` int (todas Não nulas).

### `sheets_google_drive_category` — 1.073 linhas (p. 35)

`id` PK · `Item_category`, `Item_category_2`, `Item_name` varchar(255) Não · `created_at`/`updated_at` **datetime Não
nulo**. `items.Item_name` → `category.Item_name` (N:1).

### `sheets_google_drive_transacoes` — 7.341 linhas (p. 33–34)

`id` PK · `date` date Sim IDX · `transaction_id` varchar(255) Sim · `source_medium`, `campaign`, `device_category`,
`mobile_device_brand` varchar(255) Sim IDX · `transactions` int Sim · `transaction_revenue` decimal(10,2) Sim.

### `sheets_google_drive_navegacao` — 61.541 linhas (p. 37). Sem PK.

`date` date Sim · `device_category`, `mobile_device_brand`, `segment` varchar(255) Sim IDX · `sessions` int Sim.

### `sheets_google_drive_por_hora` — 2.447 linhas (p. 38). Sem PK.

`date` date Sim · `hour` int Sim (0–23) · `transaction_revenue` decimal(10,2) Sim · `transactions`, `sessions` int Sim.

### `sheets_google_drive_ev_navegacao` — 6.885 linhas (p. 37). Sem PK.

`date` date Sim · `event_category`, `device_category`, `mobile_device_brand` varchar(255) Sim IDX · `unique_events`
decimal(10,2) Sim.

> As dimensões de `transacoes`, `navegacao`, `ev_navegacao` e `por_hora` (`source_medium`, `segment`, `event_category`,
> `unique_events`) são da era Universal Analytics: a equivalência no GA4 precisa ser combinada.

## Infra citada na doc (sem segredos)

- Dois bancos no mesmo servidor MySQL (InnoDB). A doc cita **dois hosts** para `mascavo_etl` — confirmar com a cliente
  qual é a produção. Versão, charset e collation não aparecem: `schema:pull` e `SELECT VERSION()` respondem.
- GA4 no BigQuery: projeto de nome "sandbox", dataset `analytics_460424464` (a ligação foi desligada). Pela convenção
  do export, a propriedade GA4 da Mascavo seria **460424464** — confirmar com a cliente.
- TikTok Shop chega via AnyMarket em `amobeleza_etl.anymarket_*`, filtrado por `account_name = 'MASCAVO'` (p. 59–66).
