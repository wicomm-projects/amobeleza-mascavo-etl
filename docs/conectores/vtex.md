# Conector VTEX (fase 1)

Pedidos e catálogo das duas lojas VTEX, gravados nas mesmas tabelas e colunas que o ETL da WPP usava, para o Power BI
voltar sem mudança. Código em `src/connectors/vtex/`, DDL provisória em `db/schema/<banco>/vtex_*.sql`.

| Marca     | Banco           | Credenciais no `.env`                                              |
| --------- | --------------- | ------------------------------------------------------------------ |
| mascavo   | `mascavo_etl`   | `VTEX_MASCAVO_ACCOUNT`, `_ENVIRONMENT`, `_APP_KEY`, `_APP_TOKEN`   |
| amobeleza | `amobeleza_etl` | `VTEX_AMOBELEZA_ACCOUNT`, `_ENVIRONMENT`, `_APP_KEY`, `_APP_TOKEN` |

Sem as quatro variáveis da marca, a fonte aparece como "aguardando chave" e as cargas são puladas. Quando a chave
chegar, basta preencher o `.env` e rodar `npm run etl -- check-access --source vtex`.

## Jobs

| Job            | Quando                         | Tabelas                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vtex-orders`  | a cada 30 min (`*/30 * * * *`) | `vtex_orders`, `vtex_order_details`, `vtex_order_items`, `vtex_order_logistics_info`, `vtex_order_logistics_delivery_ids`, `vtex_order_shipping_data`, `vtex_order_payment_transactions`, `vtex_order_payment_transactions_payments`, `vtex_order_payment_gift_cards`, `vtex_order_rates`, `vtex_client_profile` |
| `vtex-catalog` | 1x/dia, 05:15 (`15 5 * * *`)   | `vtex_products` (só Mascavo), `vtex_skus_and_products_id`, `vtex_category_tree`                                                                                                                                                                                                                                  |

Horários no fuso de São Paulo; o agendador só liga com `SCHEDULER_ENABLED=true` (depois da liberação).

**Não há job `vtex-clients`.** O plano previa um job de clientes vindo do Master Data, mas a doc da WPP descreve
`vtex_client_profile` como "Perfis de clientes dos pedidos VTEX (dados mascarados pela VTEX)": são os dados de
`clientProfileData` do detalhe do pedido, e `vtex_order_details.client_profile_id` aponta para `vtex_client_profile.id`.
Esse dado já vem no mesmo GET do detalhe, então o `vtex-orders` grava a tabela — um job separado repetiria as chamadas.
As tabelas de Master Data da doc (`vtex_master_data_clients_monitoring`, `master_data_entity_clients`, esta vazia) não
estão no escopo da fase 1. _Assumido, a confirmar._

## API usada (só leitura)

Cliente: `createGetClient` do núcleo (só GET, só caminho relativo, sem redirect, retentativa em 429/5xx). Base
`https://{account}.{environment}.com.br` — a conta só aceita letras, números e hífen, e o ambiente só
`vtexcommercestable` ou `vtexcommercebeta` (as chaves nunca vão para outro host). Headers
`X-VTEX-API-AppKey` / `X-VTEX-API-AppToken`. Toda resposta passa por um schema zod (`schemas.ts`) antes de seguir.

| Chamada                                                    | Uso                                | Limites (doc oficial)                                           |
| ---------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `GET /api/oms/pvt/orders`                                  | lista de pedidos → `vtex_orders`   | `per_page` até 100; até 30 páginas (3.000 pedidos) por consulta |
| `GET /api/oms/pvt/orders/{orderId}`                        | detalhe → demais tabelas de pedido | rate limit não publicado (o transporte faz backoff)             |
| `GET /api/catalog_system/pvt/products/GetProductAndSkuIds` | produto → SKUs                     | `_to - _from` até 250                                           |
| `GET /api/catalog/pvt/product/{productId}`                 | cadastro do produto                |                                                                 |
| `GET /api/catalog_system/pub/category/tree/{levels}`       | árvore de categorias (3 níveis)    |                                                                 |

Fontes: specs OpenAPI públicas da VTEX (`github.com/vtex/openapi-schemas`, "VTEX - Orders API" e "VTEX - Catalog API")
e o guia "Using Orders Management filters in API" (developers.vtex.com). Conferido em 18/11/2026.

Filtro da lista: `f_creationDate=creationDate:[2026-10-05T00:00:00.000Z TO 2026-11-18T23:59:59.999Z]` (formato da doc),
com `orderBy=creationDate,asc` para a paginação ficar estável.

**Permissões do AppKey** (License Manager, perfil só de leitura): listar e ver pedidos no OMS (recurso `ListOrders`
e o de visualização de pedido) e leitura de catálogo. Os nomes exatos dos recursos de catálogo não foram confirmados na
doc — conferir ao criar a chave. Nenhum recurso de escrita.

## Como o `vtex-orders` funciona

1. **Janela:** padrão últimos 45 dias até agora; `--from`/`--to` mudam. Carga retroativa (a ingestão antiga parou em
   05/10/2026): `npm run etl -- run vtex-orders --brand mascavo --from 2026-10-05`.
2. **Lista** (`orders-window.ts`): página 1 com 100 por página; se o total passa de 3.000, a janela é dividida ao meio,
   recursivamente (`[início, meio]` e `[meio, fim]`: as metades se tocam no meio, porque a VTEX guarda a data com até
   7 casas decimais e uma fresta de 1 ms perderia pedido); senão lê as páginas 2..N (no máximo 30). Pedido repetido
   entre páginas ou metades entra uma vez. Mais de 3.000 pedidos em menos de 1 minuto é tratado como filtro quebrado e
   a carga falha.
3. **O que mudou** (`stored.ts`): lê no banco de destino (Docker local, conexão protegida do núcleo) o `last_change` de
   `vtex_order_details` dos pedidos listados. Busca o detalhe só de quem não tem detalhe gravado ou tem `lastChange`
   diferente ou ilegível (comparado em UTC, ao segundo). A base é `vtex_order_details`, não `vtex_orders`: um detalhe
   que falhou numa carga é buscado de novo na próxima. Se a maioria dos pedidos vier sem `lastChange`, a carga avisa
   (log e nota): nesse caso o detalhe de todos é buscado a cada 30 min.
4. **Detalhes** em paralelo (`HTTP_CONCURRENCY`). **Isolamento por pedido:** detalhe que falha (rede, 5xx, resposta
   fora do schema) ou que não cabe nas colunas (coluna NOT NULL vazia, `seller` não numérico) fica de fora desta carga,
   com o ID nas notas do resumo, e volta na próxima; o mesmo vale para um pedido da lista. Assim um pedido ruim não
   derruba a transação de todos. A carga só falha inteira se **todos** os detalhes falharem por HTTP/rede (credencial,
   permissão ou API fora do ar).
5. **Gravação** numa transação:
    - `vtex_orders`: `replaceByKeys` por `order_id`, com **todos** os pedidos listados (vêm da lista do OMS).
    - `vtex_order_details`: `upsert` (PK `order_id`).
    - filhas (`logistics_info`, `delivery_ids`, `shipping_data`, `payment_transactions`, `..._payments`, `gift_cards`,
      `rates`): `replaceByKeys` por `order_id` dos detalhes obtidos (item removido some).
    - `vtex_order_items` (PK `uniqueid`): apaga os itens dos pedidos regravados e faz `upsert` por `uniqueid`. O mesmo
      `uniqueId` pode reaparecer em outro pedido (pedido incompleto refeito do mesmo carrinho); com INSERT puro a
      chave duplicada derrubaria todas as cargas. Fica com o item o pedido alterado por último; cada troca aparece nas
      notas ("uniqueid: pedido antigo → novo"), para conferir na paridade.
    - `vtex_client_profile`: `upsert` (PK `id`), um perfil por cliente, o do pedido alterado por último.

**Dado pessoal** (decisão AMO-Q6, 18/11/2026): enquanto o destino é o MySQL local, nome, documento, e-mail e telefone
dos clientes são gravados como `[mascarado]` — `vtex_client_profile` (`first_name`, `last_name`, `document`,
`home_phone`, `email`) e `vtex_order_details.followup_email` (`personal-data.ts`). A máscara entra só na gravação: as
transformações continuam fiéis, e a paridade compara em memória com a produção. As **cargas reais com chave rodam só no
Docker da VPS**, nunca no notebook. Bairro e CEP de `vtex_order_shipping_data` não são mascarados (o Power BI usa UF e
cidade; não estavam na decisão). A máscara sai só no PR de liberação da produção.

**Erro de gravação sem dado pessoal:** o mysql2 anexa ao erro o SQL com os valores (nomes, e-mails, endereços) e o
runner loga o erro inteiro. Os dois jobs refazem o erro só com o código e a mensagem do MySQL, sem `cause`, e omitem os
valores citados ("Duplicate entry '[omitido]'"). A proteção definitiva é no núcleo (incluir `err.sql` no `redact` do
logger) — pendência abaixo, porque mexe fora da pasta do conector.

**Dry-run** não abre conexão: sem o `last_change` gravado, todo pedido conta como mudado e o detalhe de todos é
buscado. Use janela curta (`--from`/`--to`).

## `vtex-catalog`

GetProductAndSkuIds de 250 em 250 até o `range.total` → `vtex_skus_and_products_id` (`replaceAll`); cadastro de cada
produto → `vtex_products` (`upsert`, produto que sai do catálogo fica); árvore de 3 níveis → `vtex_category_tree`
(`replaceAll`). `replaceAll` recusa lote vazio: catálogo vazio vindo da API derruba a carga em vez de apagar as tabelas.
Página vazia do GetProductAndSkuIds antes do `range.total` (ou mais de 400 páginas) também derruba a carga — senão o
`replaceAll` apagaria do mapa os produtos que não chegaram a ser lidos. Produto fora do formato das colunas (ex.: sem
`RefId`) ou categoria sem título/meta description fica de fora com nota; a carga só falha inteira se todos os cadastros
falharem por HTTP/rede. _A conferir com a chave:_ se o `range.total` conta itens que a API não devolve, a última página
vem vazia por desenho e essa regra precisa de margem.

## Mapa campo VTEX → coluna

Grafia das colunas exatamente como no dicionário (`docs/contrato/mascavo_etl.md`). Funções puras em
`transform-orders.ts` e `transform-catalog.ts`.

- **`vtex_orders`** (item da lista): `orderId`→`order_id`, `creationDate`→`order_date`, `totalValue`→`total_value`,
  `status`, `statusDescription`→`status_description`, `marketPlaceOrderId`→`market_place_order_id`, `sequence`,
  `salesChannel`→`sales_channel`, `affiliateId`→`affiliate_id`, `origin`, `workflowInErrorState`, `workflowInRetry`,
  `ShippingEstimatedDate[Max|Min]`→`shipping_estimated_date[_max|_min]`, `orderIsComplete`, `authorizedDate`,
  `totalItems`, `currencyCode`, `hostname`, `lastChange`, `isAllDelivered`, `isAnyDelivered`, `readyForHandlingDate`.
  Só em `amobeleza_etl`: `seller_name` = nome do seller do detalhe (`sellers[]`) quando não é a própria loja (id `1`),
  nulo quando é — ver "Diferenças entre os bancos".
- **`vtex_order_details`**: campos do topo do detalhe; `client_profile_id` = `clientProfileData.userProfileId`;
  `totals_items|discounts|shipping|taxes` = `totals[]` com id `Items|Discounts|Shipping|Tax` (0 quando o total não vem);
  `utm_source`/`coupon` = `marketingData`; `opentextfield` = `openTextField.value`; `commercialconditiondata` em JSON;
  `order_group` = `orderGroup` (sem ele, o `orderId` sem o sufixo `-01`).
- **`vtex_order_items`**: `items[]` em minúsculas (`uniqueId`→`uniqueid`, `productId`→`productid`...); `id`, `productid`
  e `seller` convertidos para inteiro; `additionalinfo` em JSON.
- **`vtex_order_logistics_info` / `_delivery_ids`**: `shippingData.logisticsInfo[]` e `.deliveryIds[]`; `sku_id` =
  `itemId` (sem ele, o SKU do item na mesma posição); `delivery_window` em JSON quando vem.
- **`vtex_order_shipping_data`**: `shippingData.address` (só tipo, bairro, CEP, cidade, UF, país; sem rua nem nome).
- **`vtex_order_payment_transactions` / `_payments` / `_gift_cards`**: `paymentData.transactions[]`, `.payments[]` e
  `paymentData.giftCards[]`. Nenhum campo de cartão (titular, dígitos, validade) é lido.
- **`vtex_order_rates`**: `ratesAndBenefitsData.rateAndBenefitsIdentifiers[]` (`featured`, `id`, `name`).
- **`vtex_client_profile`**: `id` = `userProfileId`, `type` = `documentType` (sem ele, `cnpj`/`cpf` por
  `isCorporate`), `first_name`, `last_name`, `document`, `home_phone` = `phone`, `email`.
- **`vtex_products`**: campos de Get product em snake_case; booleanos em `varchar` (`show_without_stock`) gravados
  como `"1"`/`"0"`.
- **`vtex_skus_and_products_id`**: `product_id` + lista de SKUs em JSON.
- **`vtex_category_tree`**: árvore achatada, como o ETL antigo e como o Power BI lê (medido na produção, só leitura,
  24/11/2026): `id` = ID da categoria na VTEX e `sub_category_id` = ID do pai, 0 na raiz. `department` nulo na raiz e,
  abaixo dela, o nome do departamento (o ETL antigo gravava outra coisa; o Power BI B2C da Mascavo não lê a coluna).

## Convenções aplicadas

- Dinheiro: **centavos** só em `vtex_orders.total_value`; as colunas decimal de detalhes, itens, logística, pagamentos e
  vale-presente vão em **reais** (÷ 100), e as colunas int (`commission`, `tax`, `rewardvalue`…) ficam como a VTEX
  manda. Medido na produção, só leitura, 24/11/2026, nas duas marcas.
- Datas em **UTC**, cortadas no segundo (as colunas são `DATETIME` sem fração; a VTEX manda até 7 casas decimais).
- Status em inglês e descrição em português, **sem traduzir**.
- Booleano em `1`/`0`; JSON como texto JSON; valor ausente fica **nulo** (nada é inventado).
- `hostname` de `vtex_orders`: a spec pública não lista o campo na lista de pedidos; quando não vier, grava a conta
  VTEX do `.env` (a VTEX usa a conta como hostname).
- Texto acima de 255 caracteres é cortado nas colunas `varchar(255)` de texto livre (nome, descrição, URLs): em modo
  estrito o MySQL recusaria a linha e derrubaria a carga.
- Log só com contagens e IDs de pedido/produto; nenhum dado de cliente.

## Estrutura real e as 7 colunas NOT NULL

As 14 tabelas têm a estrutura real da produção (`schema:pull` de 24/11/2026, só leitura). 12 estavam iguais ao
dicionário. Nas outras, 7 colunas que a DDL provisória tinha relaxado para `NULL` são **`NOT NULL`** na produção, e o
servidor está em modo estrito (MySQL 8.4, `STRICT_TRANS_TABLES`): gravar vazio derrubaria o lote inteiro.

O ETL antigo sempre preenchia essas colunas. A leitura de amostras na produção (pedidos cancelados, aguardando
pagamento e em preparação, nas duas lojas; AMO-Q15) mostrou o substituto que ele usava quando a VTEX não mandava valor,
e o conector faz igual (`OLD_ETL_FALLBACK` em `transform-orders.ts`):

| Coluna                                              | Substituto quando a VTEX não manda                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `vtex_order_details.authorizeddate`, `invoiceddate` | o "agora" da carga no relógio de São Paulo (igual ao `created_at` da linha no ETL antigo, que era Laravel no fuso de SP com o MySQL em UTC) |
| `vtex_order_details.marketplace_services_endpoint`  | `http://oms.vtexinternal.com.br/api/oms?an=<conta>`                                                                                         |
| `vtex_order_items.lockid`                           | `00-<order_id>`                                                                                                                             |
| `vtex_order_items.refid`                            | `-`                                                                                                                                         |
| `vtex_order_items.taxcode`                          | `''` (texto vazio)                                                                                                                          |
| `vtex_order_items.costprice`                        | `0` (_assumido_: veio sempre preenchido nas amostras)                                                                                       |

Nenhum painel do Power BI lê essas 7 colunas. Na paridade, `authorizeddate`/`invoiceddate` de pedido sem data na
VTEX não são comparadas (o "agora" nunca bate).

## Diferenças entre os bancos (doc da Mascavo × doc da Amobeleza)

As duas docs da WPP (levantamento de 05/10/2026) foram comparadas coluna a coluna (nome, tipo, nulo, chave) nas 14
tabelas. 12 são idênticas. A DDL de cada banco segue o seu dicionário:

| Tabela               | `mascavo_etl` | `amobeleza_etl`                                                                                                              |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `vtex_orders`        | 24 colunas    | + `seller_name` varchar(255) nulo ("nome do seller responsável pelo pedido"); índices também em `order_date` e `last_change` |
| `vtex_order_details` | igual         | índice também em `updated_at`                                                                                                |

**`seller_name`**: o Power BI da Amobeleza usa ("seller vazio = Amobeleza"; classifica o tipo de pedido por afiliado ou
seller, inclusive "Marketplace IN", de seller terceiro). A doc não diz de onde o ETL antigo tirava o valor, e a lista do
OMS não traz seller. O conector grava o nome do seller do detalhe (`sellers[]`) quando ele não é a própria loja (id `1`)
e nulo quando é. Como `vtex_orders` é regravada a cada carga e o detalhe só vem do que mudou, o valor dos pedidos que
não mudaram é lido do próprio `vtex_orders` antes de regravar. _Assumido, a confirmar na paridade._

**Só na Amobeleza, fora desta fase** (pendência):

- `vtex_produto_categoria` (23.576 linhas, ativa): dimensão de produto por SKU (`cod_produto`, `nome_produto`,
  `produto`, `barra_ean`, `marca`, `departamento`, `categoria`). O Power BI da Amobeleza não a lê (as consultas VTEX
  dele usam `vtex_orders`, `vtex_order_details`, `vtex_order_items`, `vtex_order_shipping_data` e
  `vtex_client_profile`). Entra numa fase de catálogo se alguém usar.
- Na Amobeleza, o `vtex-catalog` **não grava `vtex_products`** (decisão AMO-Q18, 24/11/2026). Na produção a tabela
  foi gravada uma única vez, em 02/09/2024 (16.358 produtos), e o ETL antigo nunca mais a atualizou; pela doc da WPP
  nenhum dos 5 relatórios da Amobeleza a lê (o Web Analytics pega produto do ERP). Sem ela, o job não lê o cadastro de
  cada produto (~27 mil chamadas/dia). Para voltar a gravar: `WRITES_PRODUCTS` em `catalog-job.ts`. Na Mascavo, o
  B2C usa a tabela e ela segue sendo gravada.

O que o Power BI da Amobeleza faz com os dados reforça duas convenções: `total_value ÷ 100` (centavos) e "subtrai 3 h"
(UTC); e em `vtex_client_profile` aplica "tipo em minúsculas → PF/PJ", compatível com `documentType` (`cpf`/`cnpj`).

## Fixtures

`src/connectors/vtex/fixtures/` — só exemplos públicos da documentação da VTEX (specs OpenAPI), nenhum dado da cliente.

- `vtex-orders.json`: `{ account, list, orders }` — resposta de List orders (15 pedidos) e de Get order (1 pedido, sem
  os campos de cartão e boleto do exemplo). Em modo fixture, a lista vai para `vtex_orders` e os detalhes para as demais
  tabelas, sem comparar `lastChange`.
- `vtex-catalog.json`: `{ productAndSkuIds, products, categoryTree }`.

```bash
npm run etl -- db:apply
npm run etl -- run vtex-orders --brand mascavo --fixture src/connectors/vtex/fixtures/vtex-orders.json
npm run etl -- run vtex-catalog --brand mascavo --fixture src/connectors/vtex/fixtures/vtex-catalog.json
```

## Pendências (dependem de chave, `schema:pull` ou paridade)

1. `check-access` real e primeira carga com chave (só no Docker local).
2. ~~`schema:pull`~~ feito em 24/11/2026: estrutura real aplicada; as 7 colunas NOT NULL usam o substituto do ETL antigo (acima).
3. Paridade (`parity` ainda não implementado no conector; entra quando houver usuário só leitura):
    - ~~centavos em itens, detalhes, pagamentos e logística~~ — medido em 24/11/2026: reais (ver Convenções);
    - o que o ETL antigo gravava em `invoiceddate`/`authorizeddate` de pedido sem data;
    - se a lista antiga incluía pedidos incompletos (a VTEX tem `incompleteOrders`; não passamos o filtro e o padrão da
      API não está documentado — comparar a contagem de `order_is_complete = 0`);
    - `department` em `vtex_category_tree` (`id` e `sub_category_id` já medidos em 24/11/2026). Na paridade do
      catálogo, `id` dessa tabela é dado de negócio (o Power BI liga por ele): não deixar no `DEFAULT_IGNORED`;
    - `vtex_client_profile.type` (`cpf`/`cnpj` ou outro texto);
    - formato de booleano em `varchar` (`vtex_products.show_without_stock`);
    - `amobeleza_etl.vtex_orders.seller_name` (origem e valor para a própria loja: nulo ou vazio);
    - item que muda de pedido por `uniqueId` repetido: hoje fica com o pedido alterado por último; ver nas notas se
      algum pedido cancelado "tomou" o item de um faturado e, se for o caso, desempatar a favor do não cancelado.
4. `vtex_produto_categoria` (só Amobeleza): fora desta fase, ver "Diferenças entre os bancos".
5. Núcleo (fora da pasta do conector, precisa de autorização): incluir `err.sql` / `*.sql` no `redact` do logger, para
   nenhum conector vazar o SQL com valores num erro de gravação.
6. ~~Dado pessoal no Docker local~~ — decidido (AMO-Q6): mascarado na gravação, cargas reais só no Docker da VPS (ver
   "Dado pessoal").
7. Testes de conector (vêm com as chaves): divisão de janela (inclusive data com 7 casas decimais), comparação de
   `lastChange`, transformações. Os testes de mesa desta fase (API falsa) não foram commitados.
