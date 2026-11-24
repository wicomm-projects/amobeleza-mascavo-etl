# Power BI B2C da Mascavo — o que ele lê do banco

Levantado em 24/11/2026 do modelo do relatório (`Mascavo - B2C.pbit`, exportado com a conta da cliente; o arquivo fica
em `amobeleza_mascavo_docs`, fora do Git, porque guarda listas coladas à mão). Só estrutura: nenhum dado, host ou
credencial. Serve para a paridade e para saber qual etapa do ETL destrava cada página. O Power BI **não muda**: quem se
ajusta é o ETL.

## Em números

- 81 tabelas no modelo, 71 relações, 325 medidas, 29 páginas.
- Só a **VISÃO GERAL** aparece no menu; as outras 28 ficam ocultas e abrem pelos botões de navegação.
- O calendário do painel começa em **01/10/2024**: nada antes disso aparece.
- Todas as tabelas de pedidos tiram os pedidos de uma lista de fraude colada no próprio arquivo (`pedidos_fraude_042026`).

## De onde vem cada tabela do modelo

### Pedidos VTEX — `mascavo_etl` (etapa 1)

| Tabela no Power BI  | Tabela no MySQL                                               | Colunas lidas                                                                                                                                                                           | O que o Power BI faz                                                                                   |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pedidos`           | `vtex_orders` LEFT JOIN `vtex_order_details` (por `order_id`) | orders: `order_id`, `order_date`, `total_value`, `status_description`, `affiliate_id`, `origin` · details: `order_group`, `totals_discounts`, `totals_shipping`, `utm_source`, `coupon` | `total_value ÷ 100`; `order_group` nulo vira `order_id`; junta os pedidos do AnyMarket (regras abaixo) |
| `pedidos_itens`     | `vtex_order_items`                                            | `order_id`, `id`, `quantity`, `price`, `sellingprice`, `isgift`                                                                                                                         | `valor_final = quantity × sellingprice` (**sem ÷ 100**); custo por SKU; ~30 trocas fixas de ID de SKU  |
| `pedidos_endereco`  | `vtex_order_shipping_data`                                    | `order_id`, `state`, `city`                                                                                                                                                             | junta AnyMarket                                                                                        |
| `pedidos_logistica` | `vtex_order_logistics_info`                                   | `order_id`, `selected_sla`, `delivery_company`, `sku_id`                                                                                                                                | junta AnyMarket                                                                                        |
| `pedidos_pagamento` | `vtex_order_payment_transactions_payments`                    | `order_id`, `payment_system_name`, `installments`                                                                                                                                       | resume a forma de pagamento (Cartão, Pix…); junta AnyMarket                                            |
| `pedidos_rates`     | `vtex_order_rates` (+ `vtex_orders`)                          | `order_id`, `id`, `name`, `featured`                                                                                                                                                    | alimenta a coluna "Promoção aplicada?" de `pedidos`                                                    |
| `category_tree`     | `vtex_category_tree` (ligada a ela mesma duas vezes)          | `id`, `name`, `sub_category_id`                                                                                                                                                         | monta Departamento → Categoria → Subcategoria (ver divergência 1)                                      |
| `vtex_products`     | `vtex_skus_and_products_id` + `vtex_products` (+ `vtex_skus`) | `sku_id` (lista JSON), `product_id`, `name`, `ref_id`, `is_active`, `department_id`, `category_id`, `brand_id`, `link_id`                                                               | abre a lista JSON de SKUs com `JSON_TABLE`, uma linha por SKU                                          |

### AnyMarket — `amobeleza_etl` (etapa 6), sempre com `account_name = 'MASCAVO'`

| Tabela no Power BI      | Tabela no MySQL                                         | Colunas lidas                                                                                                | O que o Power BI faz                                              |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pedidos_any`           | `anymarket_orders` LEFT JOIN `anymarket_order_tracking` | `id`, `order_created_at`, `gross`, `status`, `market_place`, `discount`, `freight`, `account_name`; `number` | `gross` em reais (sem ÷ 100); `discount × −1`; entra em `pedidos` |
| `pedidos_itens_any`     | `anymarket_order_items` (+ `anymarket_orders`)          | `anymarket_order_id`, `sku_partner_id`, `amount`, `unit`, `total`                                            | `sellingprice = total ÷ amount`; brinde quando `total = 0`        |
| `pedidos_pagamento_any` | `anymarket_order_payments` (+ `anymarket_orders`)       | `method`                                                                                                     | entra em `pedidos_pagamento`                                      |
| `pedidos_endereco_any`  | `anymarket_order_shipping` (+ `anymarket_orders`)       | `state`, `city`                                                                                              | entra em `pedidos_endereco`                                       |
| `pedidos_logistica_any` | `anymarket_order_tracking` (+ `anymarket_orders`)       | `carrier`                                                                                                    | entra em `pedidos_logistica`                                      |

### GA4 — `mascavo_etl` (etapa 3)

| Tabela no Power BI                                      | Tabela no MySQL                | Colunas lidas                                                                                                                            |
| ------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `trafego_ga4`, `canais`, `campanhas`, `device_category` | `sheets_google_drive_trafego`  | `date`, `session_source`, `session_campaign_name`, `platform_device_category`, `event_count`, `vehicle_channel_no_pay`, `type`           |
| `vendas_ga4` (e parte de `canais`)                      | `sheets_google_drive_vendas`   | `date`, `source`, `event_campaign_name`, `platform_device_category`, `purchase_revenue`, `conversions`, `vehicle_channel_no_pay`, `type` |
| `new_users_purchasers`                                  | `sheets_google_drive_users`    | `Date`, `Session_source`, `First_time_purchasers`, `New_users`                                                                           |
| `items_ga4`                                             | `sheets_google_drive_items`    | `Date`, `Session_source`, `Item_name`, `Item_revenue`, `Item_purchase_quantity`                                                          |
| `category_ga4`                                          | `sheets_google_drive_category` | `id`, `Item_category`, `Item_category_2`, `Item_name`                                                                                    |

`trafego_ga4` ainda soma uma tabela colada no arquivo (`trafego_ajuste_junho`).

### Ainda sem conector

| Tabela no Power BI                | Tabela no MySQL                                                 | Colunas lidas e regra                                                                                                           | Etapa           |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `metas_gerais`                    | `mascavo_etl.sheets_google_metas_erp`                           | `date`, `tipo_loja`, `receita_captada_bruta(_frete)`, `receita_faturada_bruta(_frete)`, `pedidos_captados`, `pedidos_faturados` | 2               |
| `metas_por_dia`                   | `mascavo_etl.sheets_metas_diarizacao`                           | `date`, `receita_captada`, `faturamento`, `budget`, `sessoes` — **todas ÷ 100**                                                 | 2               |
| `metas_por_hora`                  | `mascavo_etl.sheets_google_metas_horario`                       | `date`, `hora`, `porcentagem ÷ 100`                                                                                             | 2               |
| `metas_por_canal`                 | `mascavo_etl.sheets_metas_canais`                               | `date`, `canal`, `receita_captada`, `budget`, `sessoes`                                                                         | 2               |
| `insights_acoes`                  | `mascavo_etl.sheets_insights`                                   | `date`, `semana_do_mes`, `insight`, `proximas_acoes`                                                                            | 2               |
| `custo_produto`                   | `amobeleza_etl.sheets_google_custo_produtos`                    | `cod_produto`, `custo`, `data_lancamento`, `preco_original`; ordena por `updated_at` desc e fica com o primeiro de cada produto | 2               |
| `filial_tipo`                     | `amobeleza_etl.emillennium_nf_emitidas_completa`                | `cod_filial`, `tipo_pedido` (agrupados); aparece em quase todas as páginas                                                      | 2 (a confirmar) |
| `facebook`, `tiktok`, `pinterest` | `mascavo_etl.sheets_looker_facebook` / `_tiktok` / `_pinterest` | `date`, `impressions`, `clicks` (`link_clicks` no Facebook), `cost`, somados por dia                                            | 4               |
| `gads`                            | `mascavo_etl.sheets_google_gads`                                | `date`, `impressions`, `clicks`, `cost`, somados por dia                                                                        | 4               |
| `awin`                            | `mascavo_etl.awin_transactions`                                 | `transaction_date`, `commission_amount`, `sale_amount`, `transaction_id`, somados por dia                                       | 5               |
| `rakuten`                         | `mascavo_etl.rakuten_bi_api_report`                             | `transaction_date`, `baseline_commission`, `impressions`, `clicks`, `gross_sales`, `order_id`, somados por dia                  | 5               |
| `blue`                            | `mascavo_etl.blue_performances`                                 | `date`, `mediacost`, `revenue`, `clicks`, `impressions`                                                                         | 5               |

`daily_cost_channel` junta as 7 tabelas de mídia e afiliados numa só (custo por canal e por dia).

### Fora do ETL

- **ERP no Azure SQL** (o Power BI lê direto): `estoque`, `produtos`, `notas_itens_estoque`, `f_Notas_devoluções`,
  `marketplace_any`.
- **Colado no arquivo**: De/Para de clientes, empresas e filial, `regiao`, `metrica_selecao(_ga4)`, `tipo_meta`,
  `trafego_ajuste_junho`, ajuste de categorias, lista de fraude, glossário e as tabelas que só guardam medidas
  (`metricas_*`).
- **Gerado no próprio Power BI**: `calendario`, `calendario_comparador`, `horario`, `metricas_bq`, `metricas_ga4`.

## Regras da tabela `pedidos` (a base da Visão Geral)

1. VTEX: `total_value ÷ 100`; `order_group` nulo vira `order_id`.
2. Junta os pedidos do AnyMarket na mesma tabela (`pedidos_any`).
3. Tira 3 h de `order_date` nas **duas** fontes (UTC → São Paulo) e separa em data e hora.
4. `utm_source` em minúsculas; cupom em maiúsculas, com uma troca fixa de código antigo pelo novo; cupom vazio vira
   "SEM CUPOM". No AnyMarket o cupom é "Não aplicável".
5. Status: põe `status_description` em minúsculas e compara com uma lista de 40 textos (os status em português da
   VTEX e os do AnyMarket, como `invoiced` e `canceled`) → **Aprovado**, **Em andamento** ou **Cancelado**. Texto fora
   da lista aparece cru.
6. Tipo de pedido: VTEX → "B2C - SITE"; AnyMarket com `affiliate_id = 'TIKTOK_SHOP'` → "B2C - TIKTOK"; outros, vazio.
7. Origem: `utm_source` `app_ios`/`app_android` → App; TikTok → TikTok Shop; o resto → Site.
8. Tira pedido duplicado por `order_id` e os pedidos da lista de fraude.
9. Colunas calculadas: "Promoção aplicada?", "Cupom aplicado?", "Aprovação" e "Faixa de valor".

## Medidas dos cartões da Visão Geral

| Cartão                               | Fórmula                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Receita bruta + frete                | `SUM(pedidos[total_value])`                                                                |
| Pedidos                              | `DISTINCTCOUNT(pedidos[order_group])`                                                      |
| AOV (ticket médio)                   | Receita bruta + frete ÷ Pedidos                                                            |
| Receita bruta                        | `SUM(pedidos_itens[valor_final])`                                                          |
| Frete / Desconto                     | `SUM(pedidos[totals_shipping])` / `SUM(pedidos[totals_discounts])`                         |
| Ontem, Há 7 dias, Há 1 mês, Há 1 ano | `valor de hoje ÷ valor do dia comparado − 1`, pela tabela `calendario_comparador`          |
| Sessões, Tx. Conversão               | **fixas em 0** (`sessions_bq = 0`, `tx_conv_bq = 0`; a fórmula do BigQuery está comentada) |

- "Hoje" é a coluna `calendario[Período]`, calculada na atualização do Power BI com `UTCNOW() − 3 h`. Entre uma
  atualização e outra, "hoje" é a data da última atualização. Sem pedido nesse dia, o cartão mostra "(Em branco)" e as
  variações dão −100% (vazio ÷ comparação − 1 = −1). Era o que o painel mostrava em 24/11/2026: última atualização
  04/11, ETL antigo parado desde 05/10.
- Os cartões só comparam até a hora do último pedido de hoje (`horario[Compararar]`), para a comparação ser justa no
  meio do dia.
- Sessões e Tx. Conversão não dependem do ETL: voltar a mostrá-las é mudança no Power BI, fora deste projeto.

## Qual etapa destrava cada página

Toda página que usa `pedidos` depende das etapas 1 **e** 6 (o AnyMarket entra em `pedidos`). As subpáginas mensal,
diário e hora seguem a página de cima.

| Página                         | VTEX (1) | GA4 (3) | AnyMarket (6) | Planilhas (2)                     | Mídia e afiliados (4, 5) | ERP (Azure)                   |
| ------------------------------ | -------- | ------- | ------------- | --------------------------------- | ------------------------ | ----------------------------- |
| VISÃO GERAL                    | sim      | sim     | sim           | `metas_gerais`, `filial_tipo`     | —                        | `produtos`                    |
| metas                          | sim      | sim     | sim           | `metas_gerais`, `metas_por_canal` | sim                      | `produtos`                    |
| mensal, diário, hora, períodos | sim      | sim     | sim           | `filial_tipo`                     | —                        | `produtos`                    |
| PRODUTOS, CUPONS, REGIÃO       | sim      | sim     | sim           | `filial_tipo`                     | —                        | `produtos`                    |
| CANAIS, categorias             | sim      | sim     | sim           | `filial_tipo`                     | sim                      | —                             |
| ESTOQUE                        | sim      | sim     | sim           | `filial_tipo`                     | —                        | `estoque`, `produtos`         |
| MARKETPLACE                    | sim      | sim     | sim           | —                                 | —                        | `marketplace_any`, `produtos` |
| BOLETIM DIÁRIO                 | sim      | sim     | sim           | `metas_gerais`, `insights_acoes`  | —                        | `estoque`, `produtos`         |
| metas gab                      | sim      | sim     | sim           | `metas_gerais`, `filial_tipo`     | sim                      | `produtos`                    |
| Glossário                      | —        | —       | —             | —                                 | —                        | —                             |

## Divergências com o ETL novo

1. **Árvore de categorias (`vtex_category_tree`).** O Power BI liga o `id` de uma linha ao `sub_category_id` das
   filhas, com a raiz em `sub_category_id = 0`. Ou seja, `id` é o ID da categoria na VTEX e `sub_category_id` é o ID do
   pai. **Resolvido** em 24/11/2026: confirmado nas duas marcas (só leitura) e o ETL novo passou a gravar assim
   (`src/connectors/vtex/transform-catalog.ts`).
2. **Centavos fora de `vtex_orders`.** O Power BI só divide por 100 o `vtex_orders.total_value`. Os itens
   (`quantity × sellingprice`), `totals_shipping` e `totals_discounts` entram sem divisão e somados com os valores do
   AnyMarket, que estão em reais. **Resolvido** em 24/11/2026: na produção (só leitura, duas marcas) só
   `vtex_orders.total_value` está em centavos; as colunas decimal de detalhes, itens, logística, pagamentos e
   vale-presente estão em reais, e o ETL novo passou a gravar assim (`toReais` em `src/connectors/vtex/values.ts`).
3. **`vtex_skus`.** A consulta de produtos faz LEFT JOIN em `mascavo_etl.vtex_skus` sem usar nenhuma coluna dela. O ETL
   novo não grava essa tabela; ela só precisa continuar existindo na produção para a consulta não quebrar.
4. **`vehicle_channel_no_pay` e `type` do GA4.** As páginas de canais agrupam por esses dois campos. Até o De/Para ficar
   pronto, eles ficam nulos e os canais aparecem como "(Em branco)".
5. **`status_description` da VTEX** precisa ser o texto em português que a VTEX manda: o painel compara com a lista de
   40 textos, e texto diferente aparece cru, fora de Aprovado/Em andamento/Cancelado.
6. **AnyMarket**: datas em UTC (o painel tira 3 h) e valores em reais. O ETL novo já grava assim.
7. **`custo_produto`** (etapa 2): o painel fica com o custo do registro de `updated_at` mais recente, então o conector
   precisa preencher `updated_at`.
