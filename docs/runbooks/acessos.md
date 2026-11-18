# Acessos: o que pedir, onde cada chave entra, como conferir

Regra: toda chave vai só no `.env` (fora do Git), nunca em código, doc, commit ou chat. Depois de preencher, rode
`npm run etl -- check-access`. Fonte sem chave aparece como "aguardando chave" e não atrapalha as outras.

## Situação em 18/11/2026

Nenhum acesso chegou. A VPS está sendo criada. O único acesso ao MySQL que existe é o root que veio na doc da WPP —
**nunca usar**.

## Pedidos à cliente (etapas 0, 1, 3 e 6)

| Etapa | Pedido                                                                                                      | Variáveis no `.env`                                                                         | Conferência                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0     | Usuário MySQL **só leitura** em `amobeleza_etl` e `mascavo_etl`, com o IP da VPS liberado no firewall       | `REF_DB_HOST` (127.0.0.1 com túnel), `REF_DB_PORT`, `REF_DB_USER`, `REF_DB_PASSWORD`        | `check-access` → "OK: usuário só leitura". Se o usuário puder gravar (ou tiver role), o ETL recusa usá-lo e o comando sai com erro |
| 0     | Acesso aos workspaces do Power BI das duas marcas                                                           | —                                                                                           | Ver histórico de refresh e gateway do B2C                                   |
| 1     | AppKey/AppToken das duas lojas VTEX, perfil só leitura (OMS, catálogo, Master Data), e o nome de cada conta | `VTEX_MASCAVO_ACCOUNT`, `VTEX_MASCAVO_APP_KEY`, `VTEX_MASCAVO_APP_TOKEN` (idem `AMOBELEZA`) | `check-access --source vtex`                                                |
| 3     | ID numérico das propriedades GA4 das duas marcas + papel **Leitor** para o e-mail da conta de serviço       | `GA4_MASCAVO_PROPERTY_ID`, `GA4_AMOBELEZA_PROPERTY_ID`, `GOOGLE_APPLICATION_CREDENTIALS`    | `check-access --source ga4`                                                 |
| 6     | Token de API do AnyMarket de produção, cobrindo todas as contas                                             | `ANYMARKET_TOKEN`                                                                           | `check-access --source anymarket`                                           |

A permissão de escrita no MySQL (INSERT/UPDATE/DELETE só nas tabelas do mapa) **não** é pedida agora: só na virada de
cada fonte, depois da paridade (ver `docs/adr/2026-11-18-travas-de-escrita.md`).

## GA4: conta de serviço

1. Num projeto Google Cloud da Wicomm, ativar a **Google Analytics Data API**.
2. Criar uma conta de serviço (sem papel no projeto) e gerar uma chave JSON.
3. Guardar o JSON **fora do repositório** (ex.: `~/.config/amo-etl/ga4-service-account.json`; na VPS,
   `/home/etl/.config/amo-etl/`, `chmod 600`) e apontar `GOOGLE_APPLICATION_CREDENTIALS` para ele.
4. Pedir à cliente para adicionar o e-mail da conta de serviço como **Leitor** nas duas propriedades.

## Banco da cliente pelo túnel SSH

O IP liberado é o da VPS. Do computador do dev, o acesso passa por um túnel (porta local 3316, para não confundir com o
Docker na 3307):

```bash
ssh -N -L 3316:<host-mysql-cliente>:3306 etl@<ip-da-vps>
```

E no `.env`: `REF_DB_HOST=127.0.0.1`, `REF_DB_PORT=3316`. O destino (`TARGET_DB_*`) continua no Docker: mesmo que alguém
aponte o destino para o túnel, o writer recusa (não há marcador local na produção).

## Primeiro uso do banco de referência

```bash
npm run etl -- check-access        # confirma conexão só leitura
npm run etl -- schema:pull         # traz o DDL real das tabelas dos jobs para db/schema/
git diff db/schema                 # compare com o DDL provisório (dicionário da WPP)
npm run etl -- db:apply            # recria as tabelas no Docker local com o DDL real
```
