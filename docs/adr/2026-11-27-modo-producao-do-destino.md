# Modo produção do destino: travas equivalentes às do Docker, com o wicomm_etl

- **Data:** 2026-11-27
- **Status:** aceita (substitui a seção "Consequências" de `2026-11-18-travas-de-escrita.md` no que diz respeito à
  liberação)

## Contexto

O ADR de 18/11 travou o destino no MySQL local do Docker até haver paridade, backup, autorização por escrito da
cliente e um usuário próprio. Em 27/11/2026: paridade OK nas quatro fontes da virada, autorização recebida pelo
WhatsApp (25/11) e usuário `wicomm_etl` criado no MySQL da cliente, só com `SELECT/INSERT/UPDATE/DELETE` tabela por
tabela e preso ao IP da VPS (`ops/mysql/usuario-wicomm-etl.sql`). Falta o código aceitar esse destino sem perder as
travas.

## Decisão

1. **Modo explícito:** `TARGET_MODE` = `local` (padrão) ou `production`. Valor desconhecido é erro na subida. Sem a
   variável, nada muda em relação ao ADR de 18/11.
2. **Identidade da produção no código, endereço fora do Git** (`src/config/production-target.ts`): porta, usuário,
   `@@hostname` e `@@server_uuid` da produção. O host fica só no `.env` da VPS, para o endereço de um MySQL aberto na
   internet não ficar no histórico do Git. Um `.env` apontando para outro servidor não grava: o uuid não bate. No modo
   produção o env exige porta e usuário de `PRODUCTION_TARGET` e recusa loopback: a gravação só sai da VPS, que é o
   IP liberado para o `wicomm_etl` (um túnel do computador do dev aparece como 127.0.0.1).
3. **Identidade conferida no servidor** (`assertProductionTarget`), na mesma conexão que vai gravar, antes da
   transação e do `GET_LOCK`:
    - `@@hostname` e `@@server_uuid` da produção;
    - sessão cifrada (`Ssl_cipher` preenchido). O pool do destino no modo produção e o do leitor da paridade pedem TLS
      1.2+ sem validar o certificado, porque o servidor usa o `server-cert.pem` padrão do MySQL (AMO-Q51): protege
      contra quem escuta a rede, não contra quem se passa pelo servidor. Com um certificado próprio da cliente, passar o
      CA e validar;
    - `CURRENT_USER()` = `wicomm_etl@<IPv4 literal>` (conta sem curinga);
    - `SHOW GRANTS` só com `USAGE ON *.*` e `SELECT/INSERT/UPDATE/DELETE` em `` `mascavo_etl|amobeleza_etl`.`tabela` ``,
      sem tabela do Laravel. Um usuário que pode mais é recusado: o ETL só funciona com permissão mínima.
4. **O que continua igual nos dois modos:** `root` recusado; lista de tabelas por job; tabelas do Laravel recusadas;
   `replaceAll`/`replaceDateWindow` recusam lote vazio; transação com ROLLBACK; ESLint sem `mysql2` fora de
   `src/core/db`; ref-reader só leitura.
5. **O que muda só no modo produção:**
    - `db:apply` é recusado antes de abrir conexão (ele apaga e recria tabelas);
    - `--fixture` só roda com `--dry-run` (dado de exemplo nunca vai para a cliente);
    - a máscara de dado pessoal (VTEX e AnyMarket) é desligada, porque o Power BI precisa do dado como o ETL antigo
      gravava. No modo local ela continua sempre ligada.

## Alternativas consideradas

- **Flag por fonte** (sugerida no ADR de 18/11): não foi preciso. As quatro fontes entram juntas e o limite por tabela
  já é feito pelos GRANTs do `wicomm_etl`: tabela de fase futura não tem GRANT e o MySQL recusa. Quando uma fase nova
  entrar, ela ganha GRANT próprio e paridade própria.
- **Conferir só o usuário e os grants:** um `.env` errado poderia apontar para outro servidor com um usuário de mesmo
  nome. Por isso o servidor é conferido por `@@server_uuid`.
- **Host também fixo no código:** foi a primeira versão deste PR. Saiu antes do push: com o uuid conferido no
  servidor, o IP no código quase não protegia mais nada e expunha no Git o endereço de um MySQL aberto na internet.
- **Prender o `CURRENT_USER()` ao IP exato da VPS:** trocar a região da VPS mudaria o IP e exigiria PR. A conta presa a
  um IPv4 qualquer, mais os grants mínimos, já impede o uso de uma conta aberta (`%`).

## Consequências

- O merge não grava nada. A primeira gravação só acontece quando o `.env` da VPS ganha `TARGET_MODE=production`
  (`docs/runbooks/vps.md`, seção 9), depois do backup e da última paridade.
- Se a cliente trocar só o IP, basta atualizar o `TARGET_DB_HOST` no `.env` da VPS. Se trocar o banco de máquina, o
  uuid muda e o ETL para de gravar (falha visível) até um PR atualizar `PRODUCTION_TARGET`.
- Se alguém colocar no `.env` um usuário com mais permissão (o `dbeaver` da WPP, por exemplo), o ETL recusa rodar.
