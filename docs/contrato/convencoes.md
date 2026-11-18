# Convenções do formato antigo (contrato com o Power BI)

O Power Query da cliente espera os dados **exatamente** como o ETL da WPP gravava. Qualquer "melhoria" de formato quebra
o painel. Fonte: "Documentação Mascavo" da WPP (dicionário do `mascavo_etl` e raio-x do B2C) e Plano 2.

| Convenção                                  | Onde                                                                                                                                               | O que fazer                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valor em centavos                          | `vtex_orders.total_value` (decimal, descrito como R$, mas o Power BI divide por 100)                                                               | Gravar em centavos, como a VTEX manda. Itens, `vtex_order_details.totals_*`, pagamentos e logística: a doc não diz — **confirmar na paridade** antes de decidir |
| Datas em UTC                               | `order_date` e as demais datas da VTEX (o Power BI subtrai 3 h, inclusive do AnyMarket)                                                            | Gravar em UTC. O pool do mysql2 usa `timezone: 'Z'`                                                                                                             |
| Status como a VTEX manda                   | `status` em inglês (`invoiced`, `canceled`...) e `status_description` em português                                                                 | Gravar sem traduzir. As 40 regras do Power Query fazem o resto                                                                                                  |
| Carimbos do ETL                            | `created_at`, `updated_at` em todas as tabelas de dados                                                                                            | O writer preenche com o horário UTC da carga; o upsert nunca sobrescreve `created_at`                                                                           |
| Grafia original                            | `sheets_looker_facebook.campaing_name`; colunas com maiúscula em `sheets_google_drive_users` e `_items` (`Date`, `Session_source`, `Item_name`...) | Manter exatamente, inclusive erros de digitação                                                                                                                 |
| Campos que vinham calculados nas planilhas | `vehicle_channel_no_pay` e `type` (pago / não pago) em tráfego e vendas do GA4; `investment` (texto) em vendas                                     | De/Para montado a partir do histórico, com `SELECT DISTINCT` só de leitura. Os textos precisam ser idênticos: o modelo do Power BI se relaciona por eles        |
| Números em texto                           | `sheets_google_custo_produtos.custo`                                                                                                               | Gravar como texto, no mesmo formato                                                                                                                             |
| `order_group`                              | Pedido sem o sufixo `-01`                                                                                                                          | Afiliados e GA ligam no pedido por ele                                                                                                                          |
| Coluna `group`                             | `vtex_order_payment_transactions_payments`                                                                                                         | Palavra reservada: o writer já usa `escapeId`                                                                                                                   |

## Estratégia de gravação por tabela

| Tabelas                                                                                   | Chave no dicionário                                | Estratégia (`src/core/db/writer.ts`)                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `vtex_order_details`, `vtex_products`                                                     | PK (`order_id`, `id`)                              | `upsert`                                                               |
| `vtex_orders`                                                                             | `order_id` só com índice comum (sem PK)            | `replaceByKeys` por `order_id`                                         |
| `vtex_order_items` e filhas (logística, entrega, pagamentos, gift cards, rates, shipping) | `uniqueid` ou `id` técnico, ligadas por `order_id` | `replaceByKeys` por `order_id` (item removido some)                    |
| `vtex_category_tree`, `sheets_google_drive_category`                                      | id técnico, poucas linhas                          | `replaceAll`                                                           |
| `sheets_google_drive_*` com data                                                          | id técnico ou PK composta com data                 | `replaceDateWindow`                                                    |
| `anymarket_*`                                                                             | sem dicionário na doc da Mascavo                   | definir depois do `schema:pull` (ou do dicionário da doc da Amobeleza) |

## Cuidados

- Os índices reais precisam ser confirmados com `schema:pull` antes de liberar a gravação.
- `vtex_order_details.invoiceddate` e `authorizeddate` são `NOT NULL` no dicionário, mas pedido não faturado não tem
  data de faturamento: descobrir na paridade o que o ETL antigo gravava.
- O Power BI deduplica pedidos depois da união VTEX + AnyMarket — sinal de que `vtex_orders` já teve duplicidade.
- A ingestão antiga parou depois de 05/10/2026. A carga retroativa começa nessa data.
