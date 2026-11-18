# Stack do ETL: Node.js + TypeScript, MySQL existente, Express só para status

- **Data:** 2026-11-18
- **Status:** aceita

## Contexto

A WPP desligou o ETL Laravel que alimentava `mascavo_etl` e `amobeleza_etl`, e não vai compartilhar o código. A cliente
quer o Power BI atual de volta, sem dashboard novo, atualizando a cada 30 minutos. O dicionário de dados da WPP descreve
cada tabela. O time domina TypeScript, Node.js e Express, e a Wicomm já tem um molde de projeto (bff-givex).

## Decisão

- Reescrever o ETL em **Node.js 24 + TypeScript (ESM)**, um projeto para as duas marcas, com uma configuração por marca.
- Gravar **no MySQL que já existe**, nas mesmas tabelas e colunas (o dicionário da WPP é o contrato).
- **Express** só com `GET /health` e `GET /status`, em loopback. O ETL é batch: roda pelo agendador interno (node-cron)
  ou pelo CLI; nenhuma rota grava ou dispara carga.
- Bibliotecas: mysql2, zod, axios, pino, node-cron, @google-analytics/data. Vitest nos testes. Configs de lint e
  formatação copiadas do bff-givex.
- Rodar numa VPS Linux própria (Hostinger, IP dedicado), que é o IP liberado no firewall do MySQL da cliente.

## Alternativas consideradas

- **BigQuery + Looker (Plano 1):** trocaria a cadeia inteira; a cliente recusou camada nova.
- **Reaproveitar o Laravel:** a WPP não entrega o código.
- **Supermetrics para mídia/GA:** economiza horas, mas tem licença mensal; fica como opção da etapa 4.
- **Hospedagem Node gerenciada da Hostinger:** IP compartilhado com outros clientes (abriria o banco da cliente para
  eles) e sem controle de processo agendado.

## Consequências

- O formato das tabelas não pode "melhorar": qualquer mudança quebra o Power Query. Paridade antes de cada carga.
- As duas marcas compartilham conectores; uma falha numa marca não pode travar a outra (job por marca).
- Sem código antigo, regras como o De/Para de canais do GA4 são deduzidas do histórico (só leitura).
