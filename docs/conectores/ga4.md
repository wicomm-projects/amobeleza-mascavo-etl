# Conector GA4 (fase 3)

Antes, o Google Analytics chegava assim: **GA4 → Supermetrics → Google Sheets → ETL da WPP → `sheets_google_drive_*`**.
Agora o ETL chama direto a API de dados do GA4 (`runReport`) e grava **nas mesmas tabelas, com as mesmas colunas**
(inclusive a grafia com maiúsculas de `users` e `items`). O Power BI não muda.

Código: `src/connectors/ga4/`. Uma definição de relatório por tabela em `reports.ts`; o resto é infraestrutura
(cliente, validação, janela, De/Para, transformação).

| Arquivo           | O que faz                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `index.ts`        | Fonte `ga4` (por marca) e o `check-access`                                                  |
| `job.ts`          | Job `ga4`: lê todos os relatórios da marca e grava numa transação só                        |
| `reports.ts`      | **Mapa GA4 → colunas**, tabela por tabela, das duas marcas                                  |
| `api.ts`          | Cliente da API (conta de serviço, paginação, timeout) ou a fixture no lugar dela            |
| `schemas.ts`      | zod na borda: resposta do `runReport`, metadata, `checkCompatibility`, fixture              |
| `transform.ts`    | Conversão de tipo de cada valor e junção de linhas que colidiriam na chave do MySQL         |
| `de-para.json`    | De/Para de canal (`vehicle_channel_no_pay` / `type`) da Mascavo — **vazio até o histórico** |
| `window.ts`       | Janela de datas (dia de São Paulo)                                                          |
| `fixtures/*.json` | Respostas de exemplo (formato REST da API, valores inventados) para testar sem chave        |

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
de São Paulo, moeda diferente de BRL, texto cortado em 255 caracteres e linhas juntadas por diferença só de maiúscula/acento.

### Por que juntar linhas

O GA4 separa `google` e `Google`; a collation do MySQL (`utf8mb4_unicode_ci`) não. Em `users` (PK `Date` +
`Session_source`) e `items` (PK das cinco colunas), as duas linhas colidiriam e a carga inteira cairia. O conector soma
as métricas das linhas com a mesma chave (os totais do Power BI ficam iguais). Em `category`, fica uma linha por
`Item_name` (o Power BI liga `items` → `category` por ele, N:1).

## Mapa GA4 → colunas

Nomes conferidos na doc do schema da API v1beta em 18/11/2026. O `conversions` do GA4 virou `keyEvents` em 2024.

### Mascavo (`mascavo_etl`, o que o B2C lê)

| Tabela      | Dimensões GA4 → coluna                                                                                                                              | Métricas GA4 → coluna                                                   | Observação                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `_trafego`  | `date`→`date`, `sessionSource`→`session_source`, `sessionCampaignName`→`session_campaign_name`, `platformDeviceCategory`→`platform_device_category` | `eventCount`→`event_count`                                              | Filtro `eventName = session_start` (_assumido_); `ga4_property_id` (int) da config; canal pelo De/Para |
| `_vendas`   | `date`, `source`→`source`, `campaignName`→`event_campaign_name`, `platformDeviceCategory`                                                           | `purchaseRevenue`→`purchase_revenue`, `keyEvents`→`conversions`         | `ga4_property_id` em texto; canal pelo De/Para; `investment` nulo (_a combinar_)                       |
| `_users`    | `date`→`Date`, `sessionSource`→`Session_source`                                                                                                     | `firstTimePurchasers`→`First_time_purchasers`, `newUsers`→`New_users`   | Soma linhas que colidem na PK                                                                          |
| `_items`    | `date`→`Date`, `sessionSource`→`Session_source`, `itemName`→`Item_name`                                                                             | `itemRevenue`→`Item_revenue`, `itemsPurchased`→`Item_purchase_quantity` | Soma linhas que colidem na PK                                                                          |
| `_category` | `itemCategory`→`Item_category`, `itemCategory2`→`Item_category_2`, `itemName`→`Item_name`                                                           | `itemsPurchased` (só ordena)                                            | Desde 2019-01-01, `keepEmptyRows`; item com 2 categorias fica com a de mais unidades                   |

### Amobeleza (`amobeleza_etl`, tabelas `h_*` do Web Analytics) — colunas da era Universal Analytics

| Tabela        | Dimensões GA4 → coluna                                                                                                                                            | Métricas GA4 → coluna                                                                                                                                              | Observação                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `_trafego`    | `date`, `sessionSourceMedium`→`source_medium`, `sessionCampaignName`→`campaign`, `deviceCategory`→`device_category`, `mobileDeviceBranding`→`mobile_device_brand` | `sessions`, `sessions − engagedSessions`→`bounces`, `newUsers`→`new_users`, `screenPageViews`→`pageviews`, `purchaseRevenue`→`transaction_revenue`, `transactions` | Sem `id`; "rejeição" no GA4 = sessão não engajada   |
| `_transacoes` | `date`, `transactionId`→`transaction_id`, `sessionSourceMedium`→`source_medium`, `sessionCampaignName`→`campaign`, `deviceCategory`, `mobileDeviceBranding`       | `transactions`, `purchaseRevenue`→`transaction_revenue`                                                                                                            | O Power BI cruza o pedido VTEX por `transaction_id` |
| `_navegacao`  | `date`, `deviceCategory`, `mobileDeviceBranding`                                                                                                                  | `sessions`                                                                                                                                                         | `segment` nulo: o GA4 não tem segmento do UA        |
| `_por_hora`   | `date`, `hour`→`hour` (0–23)                                                                                                                                      | `purchaseRevenue`→`transaction_revenue`, `transactions`, `sessions`                                                                                                | `replaceAll` dos últimos 4 dias (_assumido_)        |

## De/Para de canal (Mascavo)

`vehicle_channel_no_pay` (ex.: "google ads", "crm", "direto", "pesquisa orgânica") e `type` (pago / não pago) eram
colunas calculadas nas planilhas. O Power BI se relaciona por esses textos, então eles precisam ser **idênticos** ao
histórico. Formato de `de-para.json`:

```json
{
	"regras": [
		{
			"origem": "google",
			"campanha": "(organic)",
			"vehicle_channel_no_pay": "pesquisa orgânica",
			"type": "não pago"
		},
		{ "origem": "newsletter", "vehicle_channel_no_pay": "crm", "type": "não pago" }
	]
}
```

- Regra com `campanha` vence regra só com `origem`. Comparação sem diferença de maiúscula/acento.
- Sem regra: as duas colunas ficam nulas e a combinação entra no aviso "De/Para vazio/incompleto" do resumo.
- Como montar (quando o usuário só leitura chegar), uma consulta por tabela, com data e LIMIT:

    ```sql
    SELECT DISTINCT session_source, session_campaign_name, vehicle_channel_no_pay, type
    FROM sheets_google_drive_trafego WHERE date >= '2026-02-01' LIMIT 5000
    ```

    e o mesmo em `sheets_google_drive_vendas` (`source`, `event_campaign_name`). Se uma origem tiver sempre o mesmo
    canal, basta a regra só com `origem`.

## DDL provisória

`db/schema/mascavo_etl/sheets_google_drive_{trafego,vendas,users,items,category}.sql` e
`db/schema/amobeleza_etl/sheets_google_drive_{trafego,transacoes,navegacao,por_hora}.sql`, escritas a partir dos
dicionários da WPP (doc Mascavo p. 31–38, doc Amobeleza p. 53–55) até o `schema:pull`. `items` usa `utf8mb3`: com
`utf8mb4`, a PK de três `varchar(255)` passa do limite de 3.072 bytes do InnoDB — a tabela real deve ser `utf8`.
Consequência: `Item_name` ou `Session_source` com emoji (4 bytes) dá erro de gravação e ROLLBACK da carga. Se o
`schema:pull` confirmar `utf8mb3`, o conector precisa trocar esses caracteres nessa tabela (e contar no resumo).

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

- `trafego.event_count` (Mascavo) = contagem de `session_start` (o Power BI chama de "Sessões"). Se era o total de
  eventos, tirar o filtro em `reports.ts`.
- `vendas.conversions` = `keyEvents` (todos os eventos-chave). Se era só compra, trocar por `transactions`.
- `vendas.investment` nulo: era texto calculado na planilha; regra desconhecida.
- `vendas` usa as dimensões atribuídas ao evento-chave (`source`, `campaignName`); `trafego`, as da sessão.
- `por_hora` (Amobeleza) com só os últimos 4 dias: a tabela tinha 96 linhas (4 × 24 h) na produção.
- `category` desde 2019 com o item dominante: a planilha antiga tinha 1.073 itens; conferir a contagem.
- Datas no fuso da propriedade (o resumo do `run` avisa se não for São Paulo).

**Dependem de chave ou acesso:**

- IDs das propriedades (Mascavo provável 460424464, Amobeleza provável 311781135) e papel Leitor da conta de serviço.
- `checkCompatibility` real (combinações de escopo item × sessão em `items`; `transactionId` com dimensões de sessão).
- De/Para: `SELECT DISTINCT` na produção (só leitura).
- Cota: propriedade padrão tem 200.000 tokens/dia e 40.000/hora; 9 relatórios a cada 3 h ficam bem abaixo, mas a carga
  retroativa deve ser feita em janelas de ~1 mês.

**Limite do núcleo (AMO-Q3):** `iJob.tables` é uma lista só para as duas marcas, então o job declara as 8 tabelas (a
união). Duas consequências até o núcleo aceitar tabelas por marca:

- O writer de cada marca recebe as 8: o writer da Amobeleza aceitaria gravar em `sheets_google_drive_items`. Hoje quem
  impede é só `reports.ts` (cada marca só tem as suas definições); a trava "lista de tabelas" da ADR fica mais fraca
  para este job.
- O `schema:pull` lê as 8 nos dois bancos, e a Amobeleza não tem `vendas`, `users`, `items` nem `category`. O primeiro
  `SHOW CREATE TABLE` que falhar derruba **o comando inteiro**, inclusive o pull das tabelas VTEX e AnyMarket das
  outras fases.

Proposta: um PR pequeno no núcleo (`tables` por marca), revisado à parte, antes do primeiro `schema:pull`.
