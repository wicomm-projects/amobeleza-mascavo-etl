# Conector GA4 (fase 3)

Antes, o Google Analytics chegava assim: **GA4 → Supermetrics → Google Sheets → ETL da WPP → `sheets_google_drive_*`**.
Agora o ETL chama direto a API de dados do GA4 (`runReport`) e grava **nas mesmas tabelas, com as mesmas colunas**
(inclusive a grafia com maiúsculas de `users` e `items`). O Power BI não muda.

Código: `src/connectors/ga4/`. Uma definição de relatório por tabela em `reports.ts`; o resto é infraestrutura
(cliente, validação, janela, De/Para, transformação).

| Arquivo           | O que faz                                                                             |
| ----------------- | ------------------------------------------------------------------------------------- |
| `index.ts`        | Fonte `ga4` (por marca) e o `check-access`                                            |
| `job.ts`          | Job `ga4`: lê todos os relatórios da marca e grava numa transação só                  |
| `reports.ts`      | **Mapa GA4 → colunas**, tabela por tabela, das duas marcas                            |
| `api.ts`          | Cliente da API (conta de serviço, paginação, timeout) ou a fixture no lugar dela      |
| `schemas.ts`      | zod na borda: resposta do `runReport`, metadata, `checkCompatibility`, fixture        |
| `transform.ts`    | Conversão de tipo de cada valor e junção de linhas que colidiriam na chave do MySQL   |
| `de-para.json`    | De/Para de canal (`vehicle_channel_no_pay` / `type`) da Mascavo, uma lista por tabela |
| `parity.ts`       | Paridade com o histórico da produção (só leitura): `parity ga4 --brand mascavo`       |
| `window.ts`       | Janela de datas (dia de São Paulo)                                                    |
| `fixtures/*.json` | Respostas de exemplo (formato REST da API, valores inventados) para testar sem chave  |

## Configurar

1. Conta de serviço com a **Google Analytics Data API** ativa (passo a passo em `docs/runbooks/acessos.md`). O JSON da
   chave fica **fora do repositório**.
2. A cliente adiciona o e-mail da conta de serviço como **Leitor** nas duas propriedades.
3. `.env`:

    ```env
    GA4_MASCAVO_PROPERTY_ID=      # provavelmente 460424464 (dataset analytics_460424464 do BigQuery) — confirmar
    GA4_AMOBELEZA_PROPERTY_ID=    # provavelmente 311781135 (dataset analytics_311781135 do BigQuery) — confirmar
    GOOGLE_APPLICATION_CREDENTIALS=/caminho/fora/do/repo/ga4-service-account.json
    ```

4. `npm run etl -- check-access --source ga4` — lê a metadata da propriedade e pergunta ao `checkCompatibility` se
   cada relatório pode ser montado (só metadado, nenhum dado). Sai `OK` ou a lista do que a propriedade não aceita.

A API de dados do GA4 só lê: não existe método que grave na propriedade.

## Comandos

```bash
npm run etl -- run ga4 --brand mascavo --dry-run                 # chama o GA4, conta, não grava
npm run etl -- run ga4 --brand mascavo                           # janela padrão (3 dias) no Docker local
npm run etl -- run ga4 --brand mascavo --from 2026-08-19 --to 2026-11-18   # carga retroativa
npm run etl -- run ga4 --brand mascavo --fixture src/connectors/ga4/fixtures/mascavo.json
npm run etl -- run ga4 --brand amobeleza --fixture src/connectors/ga4/fixtures/amobeleza.json
```

Pelo contrato, `trafego`, `vendas` e `items` da Mascavo pararam entre 19 e 21/08/2026; o resto, em 05/10/2026. Antes
da carga retroativa, confira a última data de cada tabela na produção (`SELECT MAX(date) ... LIMIT 1`, só leitura) e
carregue em janelas de ~1 mês (cota do GA4).

## Como o job grava

- Agenda: `15 */3 * * *` (a cada 3 h, aos 15 min, fuso de São Paulo). O agendador só liga com `SCHEDULER_ENABLED=true`.
- Janela padrão: **os últimos 3 dias, hoje incluído** (dia de São Paulo). O GA4 ainda ajusta os últimos dias (até 48 h
  de processamento); cada carga regrava a janela.
- Primeiro lê **todos** os relatórios da marca (nenhuma chamada de rede com transação aberta); depois grava tudo numa
  transação só. Erro em qualquer tabela → ROLLBACK, o Power BI continua vendo o dado anterior.
- Tabelas com data: `replaceDateWindow` (apaga a janela e insere). `category` (Mascavo) e `por_hora` (Amobeleza):
  `replaceAll`, sempre terminando **hoje** — mesmo numa carga retroativa com `--to` no passado, para não trocar o
  conteúdo atual por dado velho.
- **Relatório vazio não toca na tabela** (o writer recusa lote vazio: resposta vazia por falha apagaria dado) e vira
  aviso no resumo.
- Paginação: 100.000 linhas por página, até 20 páginas por relatório; acima disso, o job para e pede janela menor. O
  pedido sempre leva desempate por todas as dimensões, para a ordem ser a mesma de uma página para outra.

### Avisos no resumo (`notes`)

Aparecem no fim do `run` e no `/status`: De/Para faltando (lista das combinações origem/campanha sem regra), relatório
vazio, linha `(other)` do GA4 (cardinalidade alta), limiares de privacidade, amostragem, fuso da propriedade diferente
de São Paulo, moeda diferente de BRL, texto cortado em 255 caracteres e linhas juntadas por cair na mesma chave da tabela.

### Por que juntar linhas (regra de cada tabela na produção)

O GA4 separa `google` e `Google`. Cada tabela da produção compara texto de um jeito (estrutura real, `schema:pull` de
24/11/2026), e o conector junta as linhas exatamente pela regra da chave de cada uma, somando as métricas (os totais do
Power BI ficam iguais). Sem isso, a carga inteira cairia por chave duplicada.

| Tabela     | Chave na produção                                                                                                   | Como o conector junta                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `users`    | PK (`Date`, `Session_source`), `Session_source` em `utf8mb4_bin`                                                    | só o que é idêntico (maiúscula conta; espaço no fim não)                      |
| `items`    | PK das cinco colunas, `Session_source` e `Item_name` em `utf8mb4_bin`                                               | idem, por data + origem + item                                                |
| `trafego`  | índice único (data, propriedade, origem(100), campanha(100), dispositivo(100), canal(100), tipo(100)), `unicode_ci` | sem maiúscula/acento, nos primeiros 100 caracteres                            |
| `vendas`   | índice único com origem(100), campanha(100), dispositivo(50), canal(50), tipo(50) e as métricas, `unicode_ci`       | pelas colunas de texto (junta um pouco mais que o índice, nunca colide)       |
| `category` | índice único nas três colunas, sensível a maiúscula e acento                                                        | uma linha por `Item_name` (o Power BI liga `items` → `category` por ele, N:1) |

Canal e tipo vazios (De/Para sem regra) nunca colidem no índice único: nulo não é igual a nulo no MySQL.

## Mapa GA4 → colunas

Nomes conferidos na doc do schema da API v1beta em 18/11/2026. O `conversions` do GA4 virou `keyEvents` em 2024.

### Mascavo (`mascavo_etl`, o que o B2C lê)

| Tabela      | Dimensões GA4 → coluna                                                                                                                                    | Métricas GA4 → coluna                                                    | Observação                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_trafego`  | `date`→`date`, `sessionSourceMedium`→`session_source`, `sessionCampaignName`→`session_campaign_name`, `platformDeviceCategory`→`platform_device_category` | `eventCount`→`event_count`                                               | Filtro `eventName = session_start` (_assumido_); origem e campanha **em minúsculas** (como a produção); `ga4_property_id` (int) da config; canal pelo De/Para de tráfego |
| `_vendas`   | `date`, `sourceMedium`→`source`, `campaignName`→`event_campaign_name`, `platformDeviceCategory`                                                           | `purchaseRevenue`→`purchase_revenue`, `keyEvents:purchase`→`conversions` | `ga4_property_id` em texto; maiúsculas como o GA4 manda; canal pelo De/Para de vendas; `investment` = `"0"` (como o antigo)                                              |
| `_users`    | `date`→`Date`, `sessionSourceMedium`→`Session_source`                                                                                                     | `firstTimePurchasers`→`First_time_purchasers`, `newUsers`→`New_users`    | Soma linhas que colidem na PK; receita com 2 casas                                                                                                                       |
| `_items`    | `date`→`Date`, `sessionSourceMedium`→`Session_source`, `itemName`→`Item_name`                                                                             | `itemRevenue`→`Item_revenue`, `itemsPurchased`→`Item_purchase_quantity`  | Soma linhas que colidem na PK                                                                                                                                            |
| `_category` | `itemCategory`→`Item_category`, `itemCategory2`→`Item_category_2`, `itemName`→`Item_name`                                                                 | `itemsPurchased` (só ordena)                                             | Desde 2019-01-01, `keepEmptyRows`; uma linha por (categoria, categoria 2, item), diferenciando maiúscula/acento, como o índice da produção                               |

### Amobeleza (`amobeleza_etl`, tabelas `h_*` do Web Analytics) — colunas da era Universal Analytics

| Tabela        | Dimensões GA4 → coluna                                                                                                                                            | Métricas GA4 → coluna                                                                                                                                              | Observação                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `_trafego`    | `date`, `sessionSourceMedium`→`source_medium`, `sessionCampaignName`→`campaign`, `deviceCategory`→`device_category`, `mobileDeviceBranding`→`mobile_device_brand` | `sessions`, `sessions − engagedSessions`→`bounces`, `newUsers`→`new_users`, `screenPageViews`→`pageviews`, `purchaseRevenue`→`transaction_revenue`, `transactions` | Sem `id`; "rejeição" no GA4 = sessão não engajada   |
| `_transacoes` | `date`, `transactionId`→`transaction_id`, `sessionSourceMedium`→`source_medium`, `sessionCampaignName`→`campaign`, `deviceCategory`, `mobileDeviceBranding`       | `transactions`, `purchaseRevenue`→`transaction_revenue`                                                                                                            | O Power BI cruza o pedido VTEX por `transaction_id` |
| `_navegacao`  | `date`, `deviceCategory`, `mobileDeviceBranding`                                                                                                                  | `sessions`                                                                                                                                                         | `segment` nulo: o GA4 não tem segmento do UA        |
| `_por_hora`   | `date`, `hour`→`hour` (0–23)                                                                                                                                      | `purchaseRevenue`→`transaction_revenue`, `transactions`, `sessions`                                                                                                | `replaceAll` dos últimos 4 dias (_assumido_)        |

## De/Para de canal (Mascavo)

`vehicle_channel_no_pay` (ex.: "google ads", "crm", "direto") e `type` (pago / não pago) eram colunas calculadas nas
planilhas. O Power BI se relaciona por esses textos, então eles precisam ser **idênticos** ao histórico.

- As regras saem do histórico da produção (só leitura): `de-para.json` tem **uma lista por tabela**, `trafego` e
  `vendas`, com os textos exatos de cada uma. No tráfego tudo é em minúsculas (`google ads` / `pago`); nas vendas, não
  (`Google Ads` / `Pago`).
- Cada regra é por **origem / mídia** (ex.: `google / cpc`); a `campanha` é opcional, para ajustes futuros. Regra com
  `campanha` vence regra só com `origem`. Comparação sem diferença de maiúscula e acento.
- **Regra por mídia** (`{ "midia": "referral", ... }`): vale para qualquer origem com essa mídia sem regra própria. As
  493 origens de referral do tráfego viraram 1 regra geral (`referral` / `não pago`) e 59 exceções (buscadores, redes
  sociais, afiliados). Assim site novo de referral não vira pendência, e o arquivo não lista domínios que são
  endereços internos registrados pelo GA4 (IPs, ambientes de teste da VTEX, sistemas de parceiros). Hoje: 212 regras
  no tráfego e 104 nas vendas.
- Formato: `{ leiame, fonte, trafego: regra[], vendas: regra[] }`, com `regra = { origem, campanha?,
vehicle_channel_no_pay, type }` ou `{ midia, vehicle_channel_no_pay, type }`.
- Origem / mídia sem regra grava as duas colunas nulas e aparece nas notas do resumo ("De/Para incompleto (tabela)").
- Para regenerar, ler de novo o histórico, só leitura. O passo a passo fica no `leiame` do JSON.
- O histórico de GA4 da produção termina em **19/08/2026** (tráfego e vendas) e **20/08/2026** (usuários e itens).

## Paridade

`npm run etl -- parity ga4 --brand mascavo` roda o mesmo caminho da carga (`readReports`) numa janela antiga e compara
com a produção, tabela por tabela (só SELECT com LIMIT). Sem `--from`/`--to`, usa 7 dias que terminam 7 dias antes do
último dia de `sheets_google_drive_trafego`. O relatório e as notas trazem, por tabela, o total de cada coluna numérica
nos dois lados e a diferença em %: o GA4 pode diferir um pouco do Supermetrics, e o total mostra se é ruído ou erro de
regra. As chaves e os totais são por marca. Na produção, linhas repetidas (mesma chave gravada mais de uma vez)
ficam com a gravação mais recente, e a nota diz quantas eram. A `por_hora` da Amobeleza, que guarda só os últimos
dias, é comparada nos dias que a produção tem, lendo o GA4 um dia por vez.

**Resultado da Amobeleza (25/11/2026)**: tráfego e transações de 18 a 24/09/2026; por hora nos 4 dias da produção.

| Tabela       | Total produção (sem repetição) → novo                                                 | Leitura                    |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------- |
| `trafego`    | sessões −3,1%, novos usuários −2,0%, pageviews −2,3%, receita −1,7%, transações −1,3% | bate                       |
| `transacoes` | transações +1,8%, receita +3,0%; 2 de 433 pedidos divergem (origem mudou)             | bate                       |
| `por_hora`   | receita −6,9%, transações −5,6%, sessões −3,0%                                        | bate, com ruído            |
| `navegacao`  | produção vazia desde antes de 2025                                                    | o Power BI não lê a tabela |

**O pipeline antigo da Amobeleza gravava cada dia duas vezes** (às 11h do dia seguinte e de novo no outro dia,
acrescentando sem apagar). Na semana medida, eram 1.806 linhas repetidas no tráfego e 264 nas transações, e os totais
com repetição davam cerca de 1,5x a 1,9x o real. O ETL novo grava cada janela substituindo a anterior, sem repetir.
Se o Power BI da Amobeleza soma essas tabelas sem tirar a repetição, os números de GA4 dele **vão cair** para o valor
real na virada. Conferir quando chegar o `.pbit` da Amobeleza.

**Resultado de 25/11/2026** (06 a 12/08/2026, Mascavo):

| Tabela     | Total produção → novo                                               | Leitura                                                                        |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `trafego`  | `event_count` 230.439 → 229.024 (−0,6%)                             | bate: "Sessões" é a contagem de `session_start`                                |
| `items`    | receita 911.508 → 911.200 (−0,03%); quantidade 13.275 → 13.297      | bate                                                                           |
| `vendas`   | receita 862.599 → 911.110 (+5,6%); conversões 3.111 → 3.309 (+6,4%) | o novo bate com a receita de itens (antiga e nova); o antigo ficava ~5% abaixo |
| `users`    | novos usuários −3,3%; primeiros compradores −5,5%                   | métrica de usuário do GA4 (modelada); _a confirmar_                            |
| `category` | 20 de 1.039 combinações divergentes                                 | categorias editadas depois                                                     |

- Corrigido pela paridade: `conversions` = `keyEvents:purchase` (o total de `keyEvents` dava ~99x e criava linhas sem
  venda); `investment` = "0"; receita de item com 2 casas; categorias com todas as combinações.
- Diferença linha a linha esperada: o pipeline antigo leu cada dia logo depois, antes de o GA4 terminar a atribuição
  (muito `(data not available)` e origem vazia); lendo meses depois, a atribuição já está feita. Por isso o critério do
  GA4 é o total por tabela, não linha a linha. `ACCEPTED_DIFFERENCES` fica vazio.

## DDL provisória

`db/schema/mascavo_etl/sheets_google_drive_{trafego,vendas,users,items,category}.sql` e
`db/schema/amobeleza_etl/sheets_google_drive_{trafego,transacoes,navegacao,por_hora}.sql`: estrutura real, trazida
pelo `schema:pull` de 24/11/2026 (só leitura). As 4 tabelas da Amobeleza estavam iguais ao dicionário. Na Mascavo
vieram os índices únicos de `trafego`/`vendas`/`category` e a colação `utf8mb4_bin` de `users`/`items` (tabela acima);
`items` é `utf8mb4` (aceita emoji), então a pendência do `utf8mb3` caiu.

## Pendências e dúvidas

**Decidido (AMO-Q5, 18/11/2026): equivalência UA → GA4 da Amobeleza aceita, com validação na paridade antes de ligar a
produção.** O Web Analytics da Amobeleza lê `trafego`, `transacoes`, `por_hora` (e `ev_navegacao`, parada desde
08/09/2025) com colunas do Universal Analytics. A troca do UA pelo GA4 já tinha acontecido em 2023/2024, dentro do
Supermetrics: as tabelas seguiram recebendo dado do GA4 com nome de coluna do UA até 2026. A tradução está na tabela
acima: `bounces` = sessões não engajadas, `pageviews` = `screenPageViews`, `source_medium`/`campaign` da sessão,
`segment` nulo.

- O visual do painel não muda.
- Risco: degrau em rejeições ou visualizações, se a fórmula não bater com a do Supermetrics. A paridade compara um mês
  que a produção já tem (ex.: agosto/2026), só lendo.
- `sheets_google_drive_navegacao` não é lida pelo Power BI, mas continua sendo gravada (decisão da AMO-Q5).
- O GA4 recente ia também pelo BigQuery (`analytics_311781135`), que hoje só devolve um dia. Ele fica fora deste
  conector.

**Assumidas, a confirmar na paridade:**

- ~~`trafego.event_count` = contagem de `session_start`~~ — confirmado na paridade (−0,6% no total).
- ~~`vendas.conversions` e `investment`~~ — medidos na paridade: `keyEvents:purchase` e "0".
- `vendas` usa as dimensões atribuídas ao evento-chave (`sourceMedium`, `campaignName`); `trafego`, as da sessão.
- `por_hora` (Amobeleza) com só os últimos 4 dias: a tabela tinha 96 linhas (4 × 24 h) na produção.
- ~~`category` com o item dominante~~ — a produção guarda todas as combinações; corrigido.
- Datas no fuso da propriedade (o resumo do `run` avisa se não for São Paulo).

**Dependem de chave ou acesso:**

- IDs das propriedades (Mascavo provável 460424464, Amobeleza provável 311781135) e papel Leitor da conta de serviço.
- `checkCompatibility` real (combinações de escopo item × sessão em `items`; `transactionId` com dimensões de sessão).
- Cota: propriedade padrão tem 200.000 tokens/dia e 40.000/hora; 9 relatórios a cada 3 h ficam bem abaixo, mas a carga
  retroativa deve ser feita em janelas de ~1 mês.

**Tabelas por marca (AMO-Q3, resolvida pelo PR #2 do núcleo):** o job declara `tables` como função da marca, a
partir de `reports.ts`. O writer da Mascavo só aceita as 5 tabelas dela e o da Amobeleza só as 4 dela. O
`schema:pull` também pede a cada banco só as tabelas daquela marca, e a Amobeleza não tem `vendas`, `users`, `items`
nem `category`. Para conferir: `npm run etl -- jobs`.
