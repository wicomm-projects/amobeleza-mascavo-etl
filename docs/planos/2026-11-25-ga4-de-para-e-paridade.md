# Plano — GA4 da Mascavo: origem / mídia, De/Para de canal e paridade

Pergunta AMO-Q37 (25/11/2026). O objetivo é fazer o GA4 da Mascavo gravar como o pipeline antigo (Supermetrics →
planilhas) gravava, e provar isso com a paridade, como já foi feito na VTEX e no AnyMarket.

## O que a produção mostrou (só leitura, 25/11/2026)

- **A origem é "origem / mídia" nas 4 tabelas com data.**
    - `sheets_google_drive_trafego.session_source`: `google / cpc`, `(direct) / (none)`.
    - `sheets_google_drive_vendas.source`, `sheets_google_drive_users.Session_source` e
      `sheets_google_drive_items.Session_source` também.
    - O ETL novo pede só a origem (`sessionSource` / `source`). Precisa pedir `sessionSourceMedium` (tráfego, usuários
      e itens) e `sourceMedium` (vendas).
- **Maiúsculas:**
    - A tabela de **tráfego guarda origem e campanha em minúsculas**: 0 de 2.162 combinações têm maiúscula.
    - Vendas, usuários e itens guardam como o GA4 manda, por exemplo `RD Station / email` e `CB_0172_Mascavo_...`.
- **Canal (`vehicle_channel_no_pay`) e tipo (`type`):**
    - Desde 20/06/2026, cada "origem / mídia" caiu num canal só e cada canal tem sempre o mesmo tipo, nas duas tabelas.
    - Os textos são diferentes por tabela: no tráfego, `google ads` / `pago`; nas vendas, `Google Ads` / `Pago`.
- **O histórico termina em 19/08/2026** (tráfego e vendas) e **20/08/2026** (usuários e itens).

## Já feito nesta branch

- `src/connectors/ga4/de-para.json` foi gerado a partir do histórico, com o canal e o tipo vistos por último para cada
  "origem / mídia".
- O novo formato é `{ leiame, fonte, trafego: regra[], vendas: regra[] }`, com 645 regras para tráfego e 151 para (depois enxugado com a regra por mídia de referral: 212 e 104, ver o resultado)
  vendas.
- Cada regra é `{ origem, vehicle_channel_no_pay, type }`. A `campanha` continua aceita como opcional, para ajustes
  futuros.
- O código ainda lê o formato antigo (`regras: []`). Ajustar isso é a tarefa 1.

## Tarefas

### 1. `src/connectors/ga4/de-para.ts`: uma lista de regras por tabela

- Schema novo:

    ```ts
    { leiame?: string, fonte?: unknown, trafego: regra[], vendas: regra[] }
    ```

    A regra continua como hoje: `origem` obrigatória, `campanha` opcional, `vehicle_channel_no_pay` e `type`.

- Nova assinatura: `createChannelClassifier(table: 'trafego' | 'vendas', input = deParaFile)`.
- O resto continua como hoje:
    - comparação sem diferença de maiúscula e acento (`collationKey`);
    - a regra com campanha vence a regra só com origem;
    - regra repetida lança erro;
    - a lista `unmapped()` e o `ruleCount`.
- Atualizar o comentário do topo: as regras saem do histórico, uma lista por tabela, com os textos exatos.

### 2. `src/connectors/ga4/reports.ts`: "origem / mídia" e canal por tabela

- `iReportDefinition` ganha `channelRules?: 'trafego' | 'vendas'`.
- **`mascavoTrafego`:**
    - trocar `sessionSource` por `sessionSourceMedium`;
    - `session_source` passa a ser `sessionSourceMedium` em **minúsculas**;
    - `session_campaign_name` passa a ser `sessionCampaignName` em **minúsculas**;
    - `channelRules: 'trafego'`;
    - o classificador recebe a origem e a campanha já em minúsculas.
- **`mascavoVendas`:**
    - trocar `source` por `sourceMedium`;
    - `source` passa a ser `sourceMedium`, sem mudar maiúsculas;
    - `channelRules: 'vendas'`.
- **`mascavoUsers` e `mascavoItems`:** trocar `sessionSource` por `sessionSourceMedium`, sem mudar maiúsculas.
- **Coluna de texto curta.** Se o texto vier com mais de 255 caracteres, manter o corte que o `toRow` já faz. A
  mudança para minúsculas deve usar uma função nomeada, por exemplo `lowerText`, em `text.ts`.
- **Comentários.** Atualizar os comentários das definições, sem tirar o "assumido, a confirmar na paridade" do
  `session_start`.

### 3. `src/connectors/ga4/job.ts`: classificador por tabela e leitura reaproveitável

- Criar os dois classificadores, `trafego` e `vendas`, e passar no `iRowContext.channel` o da `channelRules` da
  definição.
- Sem `channelRules`, passar um classificador que devolve sempre nulo e não conta como pendência (`NO_CHANNEL`).
- Notas de pendência: uma por tabela, só quando houver origem sem regra. O texto pode continuar o de
  `channelNotes`, com o nome da tabela.
- Exportar a função que lê e prepara os relatórios (`readReports`), para a paridade usar exatamente o mesmo caminho.
  Ela já recebe a janela por `options.from` / `options.to`. Se precisar, separar o `iJobContext` numa entrada menor
  (`{ options, logger }`), sem mudar o comportamento da carga.

### 4. `src/connectors/ga4/parity.ts` (novo): `ga4Parity(ctx, deps?)`

Use como molde `src/connectors/anymarket/parity.ts` e `src/connectors/vtex/orders-parity.ts`. Use os helpers de
`src/core/parity/helpers.ts`.

**`deps`**, para teste: `{ read?: (brand, from, to) => Promise<iPreparedTable[]>; writeReport? }`. O padrão de `read`
é a `readReports` da tarefa 3.

**Janela.**

- Com `--from` / `--to`, usar esses dois.
- Com um só, o outro fica a 6 dias de distância.
- Sem nenhum:
  `SELECT MAX(date) AS ultima FROM <banco>.sheets_google_drive_trafego WHERE date >= ? LIMIT 1`, com o parâmetro
  `'2025-01-01'` (assim a consulta usa o índice que começa por `date`).
    - `to` = `ultima − 7 dias` (os últimos dias do histórico podem ter sido gravados antes de o GA4 fechar os números);
    - `from` = `to − 6 dias` (7 dias ao todo).

**Novo.** Chamar `read(brand, from, to)`. Isso usa as mesmas definições, a mesma transformação e o mesmo `collapse`
da carga.

**Produção, por tabela, só leitura.**

- Tabelas com escopo `window`:
  `SELECT * FROM <banco>.<tabela> WHERE <coluna de data> BETWEEN ? AND ? LIMIT 200000`.
  A coluna de data vem de `scope.dateColumn` (`date` ou `Date`).
- `sheets_google_drive_category`, com escopo `since`: `SELECT * FROM <banco>.<tabela> LIMIT 50000`.
- Amobeleza: as mesmas regras, pelas definições dela. A propriedade ainda não tem permissão, e o erro do GA4 deve
  subir como `AppError` com a mensagem.

**Chaves de comparação.** Uma constante por tabela:

| Tabela                         | `keyColumns`                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `sheets_google_drive_trafego`  | `date`, `session_source`, `session_campaign_name`, `platform_device_category` |
| `sheets_google_drive_vendas`   | `date`, `source`, `event_campaign_name`, `platform_device_category`           |
| `sheets_google_drive_users`    | `Date`, `Session_source`                                                      |
| `sheets_google_drive_items`    | `Date`, `Session_source`, `Item_name`                                         |
| `sheets_google_drive_category` | `Item_category`, `Item_category_2`, `Item_name`                               |

- `ignoreColumns`: `id`, `created_at`, `updated_at`.
- Para as tabelas da Amobeleza, use o `collapse.keyColumns` da definição sem as métricas, ou deixe-as fora da
  paridade com uma nota clara. Escolha a mais simples e diga no relatório.

**Totais por tabela no `meta`.** Para cada coluna numérica da definição (`event_count`, `purchase_revenue`,
`conversions`, `First_time_purchasers`, `New_users`, `Item_revenue`, `Item_purchase_quantity`), somar os dois lados
e calcular a diferença em %. O GA4 pode diferir um pouco do Supermetrics, e o total mostra se a diferença é ruído ou
erro de regra.

**Diferenças aceitas.** `ACCEPTED_DIFFERENCES` começa vazio, com o comentário "preencher depois da paridade real",
como no AnyMarket.

**Dado pessoal.** O GA4 é agregado e não tem dado pessoal, então não precisa de `redactColumns`.

**Relatório.** `writeReport('ga4-<marca>', results, meta)`. O `meta` leva marca, janela, linhas de cada lado por
tabela, totais e as notas de pendência do De/Para.

**Retorno.** `{ reportPath, tables: summarize(results, ACCEPTED_DIFFERENCES), notes }`. As notas trazem a janela, os
totais por tabela (com a diferença em %), `extraNotes`, `acceptedNotes` e as pendências do De/Para.

### 5. `src/connectors/ga4/index.ts`

Registrar a paridade no job, como na VTEX e no AnyMarket.

### 6. Testes

- **`tests/connectors/ga4-de-para.test.ts`:**
    - Tráfego: `google / cpc` → `google ads` / `pago`; `Google / CPC` dá o mesmo resultado.
    - Vendas: `google / cpc` → `Google Ads` / `Pago`.
    - Origem sem regra devolve nulo e entra em `unmapped()`.
    - Regra com campanha vence a regra só com origem, num input de teste.
    - Regra repetida lança erro.
    - O `de-para.json` real carrega sem erro, e as duas listas não estão vazias.
- **`tests/connectors/ga4-reports.test.ts`**, ou estender um teste existente, se houver:
    - o `toRow` do tráfego com `sessionSourceMedium` = `RD Station / email` e campanha `CB_0172_X` grava
      `session_source` = `rd station / email`, `session_campaign_name` = `cb_0172_x` e o canal `crm` / `não pago`;
    - o `toRow` das vendas mantém as maiúsculas e grava `CRM` / `Não pago`.

    Leia como `toRows` e `row.text` funcionam em `transform.ts` para montar a linha de teste.

- **`tests/connectors/ga4-parity.test.ts`:** `read` e `refReader` falsos, e `writeReport` que guarda o resultado.
    - Produção igual ao novo → 0 divergentes.
    - Métrica diferente → divergente em `event_count`.
    - Toda consulta é `SELECT`, com `LIMIT` e parâmetro.
- Os testes existentes do GA4 (`tests/connectors/ga4-schemas.test.ts`) e o resto da suíte continuam verdes. Se uma
  fixture do GA4 usada em testes ou no `--fixture` não tiver `sessionSourceMedium` / `sourceMedium`, atualize
  `src/connectors/ga4/fixtures/*.json`, trocando o nome da dimensão (é exemplo público, sem dado da cliente).

### 7. Docs: `docs/conectores/ga4.md`

- Na tabela de mapeamento, trocar `sessionSource` por `sessionSourceMedium` (e `source` por `sourceMedium`), com a
  nota de minúsculas no tráfego.
- Reescrever a seção "De/Para de canal (Mascavo)":
    - as regras saem do histórico, uma lista por tabela, com textos exatos;
    - cada regra é por origem / mídia; a campanha é opcional;
    - origem sem regra grava nulo e aparece nas notas;
    - para regenerar, ler de novo o histórico, só leitura. O passo a passo fica no `leiame` do JSON.
- Registrar que o histórico de GA4 da produção termina em 19 e 20/08/2026.

## Limites para quem executar

- Não rodar nada que acesse rede, produção ou MySQL (nem o local), nem `npm run etl`.
- Não commitar.
- Não mexer em `src/core/db/**` nem em travas.
- Não editar `de-para.json`, que veio da produção. Se o formato não servir, explicar no relatório.

## Verificação

```bash
npx vitest run tests/connectors
npx vitest run
npm run typecheck
npm run lint
npm run format:check
```

Depois, na sessão principal: `check-access --source ga4` (para confirmar a compatibilidade de `sessionSourceMedium` e
`sourceMedium`), dry-run e a paridade real com o túnel aberto.

## Resultado (25/11/2026)

Implementado e rodado contra a produção (só leitura), Mascavo, de 06 a 12/08/2026. O resultado está em
`docs/conectores/ga4.md`, seção "Paridade". A paridade real pediu quatro correções a mais:

- `conversions` = `keyEvents:purchase`;
- `investment` = "0";
- receita de item com 2 casas;
- categorias com todas as combinações.

O critério do GA4 é o total por tabela, porque a atribuição do GA4 muda depois do dia.
