# amobeleza-mascavo-etl

ETL que volta a alimentar os bancos MySQL `mascavo_etl` e `amobeleza_etl`, de onde os Power BI da Mascavo e da
Amobeleza leem. Substitui o ETL que a WPP desligou, gravando nas **mesmas tabelas e no mesmo formato**, sem mexer no
Power BI.

| Fonte                                     | Etapa | Grava em                                | Situação          |
| ----------------------------------------- | ----- | --------------------------------------- | ----------------- |
| VTEX (pedidos, catálogo, clientes)        | 1     | `mascavo_etl` e `amobeleza_etl`         | aguardando chaves |
| Google Analytics 4                        | 3     | `sheets_google_drive_*` dos dois bancos | aguardando acesso |
| AnyMarket (marketplaces, todas as contas) | 6     | `amobeleza_etl.anymarket_*`             | aguardando token  |

> **Segurança:** nesta etapa o ETL só grava no MySQL local (Docker). Veja `CLAUDE.md` e
> `docs/adr/2026-11-18-travas-de-escrita.md`.

## Rodar localmente

Requisitos: Node 24 (`.nvmrc`), Docker.

```bash
npm ci
cp .env.example .env          # preencha só o que já tiver; o resto fica "aguardando chave"
npm run db:up                 # MySQL local em 127.0.0.1:3307
npm run etl -- sources
npm run etl -- check-access
npm run dev                   # http://127.0.0.1:3000/health
```

## Quando as chaves chegarem

Siga `docs/runbooks/acessos.md`: onde cada chave entra no `.env` e como conferir com `check-access`.

## Desenvolvimento

```bash
npm run typecheck
npm run lint
npm test
```

Branches: trabalho em `feat/...` a partir de `develop`, PR para `develop`.
