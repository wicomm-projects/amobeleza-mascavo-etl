# Plano — Virada para produção (VTEX, AnyMarket e GA4 da Mascavo)

Pergunta AMO-Q40 (25/11/2026). Este é o roteiro para o ETL novo começar a gravar nos bancos da cliente (`mascavo_etl` e
`amobeleza_etl`), que o Power BI lê. **Nada aqui foi executado.** Cada passo diz quem faz e o que confere.

## Pré-requisitos

| Item                                   | Situação                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Paridade com a produção                | OK: VTEX das duas marcas (PR #15), AnyMarket (#16) e GA4 da Mascavo (#18)                            |
| Autorização da cliente                 | **Recebida pelo WhatsApp**, segundo o Matheus em 25/11/2026. Guardar um print ou exportar a conversa |
| VPS                                    | Pendente: seguir `docs/runbooks/vps.md`                                                              |
| Usuário MySQL `wicomm_etl`             | Pendente: `ops/mysql/usuario-wicomm-etl.sql` (passo 2)                                               |
| Backup das tabelas                     | Na véspera (passo 4)                                                                                 |
| PR de liberação do destino de produção | A escrever (passo 3), com revisão por agente                                                         |

A mensagem de WhatsApp é a autorização por escrito que o `CLAUDE.md` pede. Por isso essa regra não muda.

## Escopo desta virada

- **Entram:**
    - VTEX das duas marcas (pedidos e catálogo);
    - AnyMarket (`amobeleza_etl`);
    - GA4 da Mascavo.
- **Ficam para depois**, cada um com a sua paridade e os seus GRANTs quando o conector existir:
    - GA4 da Amobeleza, que espera a permissão na propriedade;
    - fase 2 (planilhas e ERP);
    - fase 4 (mídia);
    - fase 5 (afiliados);
    - fase 7, se entrar.

## Passo 1 — VPS (Matheus)

Seguir `docs/runbooks/vps.md`:

- usuário `etl` só com chave SSH;
- firewall só com SSH de entrada;
- Node 24 e o código instalados.

Na VPS, o `.env` não leva a chave do GA4 junto do código: ela fica em `/home/etl/.config/amo-etl/`, com
`chmod 600`.

## Passo 2 — Usuário `wicomm_etl` (administrador do MySQL da cliente)

**Script:** `ops/mysql/usuario-wicomm-etl.sql`, gerado da lista de tabelas que os jobs gravam. Tem 42 GRANTs: 19 em
`mascavo_etl` e 23 em `amobeleza_etl`.

**O que o usuário pode fazer:**

- só `SELECT`, `INSERT`, `UPDATE` e `DELETE`, tabela por tabela;
- só a partir do IP da VPS;
- no máximo 10 conexões.

**O que ele não pode:** `CREATE`, `ALTER`, `DROP`, `GRANT OPTION`, privilégio global, tabelas do Laravel nem
qualquer tabela fora do mapa.

**O ETL não precisa de mais nada:**

- o writer usa `INSERT` (com `ON DUPLICATE KEY UPDATE`), `DELETE` (nunca `TRUNCATE`) e `SELECT`;
- o `GET_LOCK` da trava de execução não pede privilégio.

**Passos:**

1. Gerar a senha na máquina de quem vai rodar o script. São 48 caracteres hexadecimais, sem caractere especial, para
   não quebrar o `.env`:

    ```powershell
    $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
    ```

2. Trocar `<IP_DA_VPS>` (o mesmo IP do `wicomm_leitura`) e `<SENHA>` no script, e rodar como administrador.
3. Conferir com `SHOW GRANTS FOR 'wicomm_etl'@'<IP_DA_VPS>';`. Tem de listar só `USAGE` e os 42 GRANTs.
4. Na VPS, preencher o `.env`: `TARGET_DB_HOST`/`TARGET_DB_PORT` do banco da cliente, `TARGET_DB_USER=wicomm_etl` e
   `TARGET_DB_PASSWORD`. A senha só existe nesse `.env` e com o administrador.

**Para desfazer:** `DROP USER 'wicomm_etl'@'<IP_DA_VPS>';`.

## Passo 3 — PR de liberação (código, sessão principal + revisão por agente)

Hoje o código **recusa** qualquer destino que não seja o MySQL local do Docker. A liberação é um PR próprio, revisado,
que troca as travas sem tirá-las:

- **`env`**: um modo explícito, por exemplo `TARGET_MODE=production`, com o host da produção numa lista fechada.
  Sem esse modo, continua só o loopback. O `root` continua recusado sempre.
- **`target-guard`**: em produção, em vez do marcador do Docker, exigir:
    - `CURRENT_USER()` = `wicomm_etl@<IP>`;
    - `SHOW GRANTS` só com `SELECT`/`INSERT`/`UPDATE`/`DELETE` nas tabelas do mapa, recusando privilégio global,
      `ALL`, `DROP`, `ALTER`, `CREATE` e `GRANT OPTION`;
    - o host do servidor batendo com o esperado.
- **Lista de tabelas do writer** e recusa das tabelas do Laravel: continuam iguais.
- **`db:apply`**: continua proibido fora do Docker local.
- **Máscara de dado pessoal** (`MASK_PERSONAL_DATA` na VTEX e no AnyMarket): desligada **só** no modo produção.
- **Agendador:** `SCHEDULER_ENABLED=true` só na VPS. O serviço é o `ops/systemd/amobeleza-mascavo-etl.service`.
- **Testes:**
    - produção sem o modo explícito é recusada;
    - usuário com privilégio a mais é recusado;
    - o `root` é recusado;
    - a máscara só desliga em produção.
- **Revisão:** pelo agente `orquestracao:revisor`, porque o PR mexe em permissão, dado pessoal e dado que não volta.

## Passo 4 — Backup (véspera, pela VPS, só leitura)

Com o `wicomm_leitura`, que só lê, um `mysqldump` das 42 tabelas do mapa (as mesmas do script do passo 2):

```bash
mysqldump --single-transaction --no-tablespaces --skip-lock-tables -h <host do banco> -u wicomm_leitura -p \
  mascavo_etl <tabelas de mascavo_etl> > /home/etl/backup/mascavo_etl-AAAAMMDD.sql
mysqldump --single-transaction --no-tablespaces --skip-lock-tables -h <host do banco> -u wicomm_leitura -p \
  amobeleza_etl <tabelas de amobeleza_etl> > /home/etl/backup/amobeleza_etl-AAAAMMDD.sql
chmod 600 /home/etl/backup/*.sql
```

- O backup tem dado pessoal: fica só na VPS, com `chmod 600`, e é apagado depois de 30 dias.
- Para restaurar, quem roda é o administrador, com `mysql <banco> < arquivo.sql`. O arquivo recria as tabelas e os
  dados de antes.

## Passo 5 — Última paridade (véspera, só leitura)

Rodar de novo, contra a produção, **antes** da primeira gravação. Depois dela, a produção passa a ter os dados do ETL
novo e a comparação perde o sentido.

```bash
npm run etl -- parity vtex-orders --brand mascavo --sample 200
npm run etl -- parity vtex-orders --brand amobeleza --sample 200
npm run etl -- parity vtex-catalog --brand mascavo --sample 200
npm run etl -- parity vtex-catalog --brand amobeleza --sample 200
npm run etl -- parity anymarket-orders --sample 200
npm run etl -- parity ga4 --brand mascavo
```

Critério: nenhuma divergência fora das aceitas. No GA4, os totais dentro do que já foi medido.

## Passo 6 — Primeira carga real, com janela retroativa (dia D)

| Ordem | Comando (na VPS)                                                        | Por quê                                                       |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | `npm run etl -- run vtex-catalog --brand mascavo` e `--brand amobeleza` | Catálogo e árvore de categorias                               |
| 2     | `npm run etl -- run vtex-orders --brand mascavo --from 2026-10-05`      | O ETL antigo parou em 05/10                                   |
| 3     | `npm run etl -- run vtex-orders --brand amobeleza --from 2026-10-05`    | Idem                                                          |
| 4     | `npm run etl -- run anymarket-orders --from 2026-10-05`                 | Pega também o que mudou depois que o ETL antigo parou         |
| 5     | `npm run etl -- run ga4 --brand mascavo --from 2026-08-20`              | O histórico do GA4 parou em 19/08 (usuários e itens em 20/08) |

- Rodar uma de cada vez, conferindo o resumo de cada uma (linhas por tabela, notas e falhas) antes da próxima.
- **Opcional, a decidir com a cliente:** recarregar os pedidos **antigos** da Mascavo (`--from 2026-01-01`, por
  exemplo). O ETL antigo nunca atualizava o status deles (ver `docs/melhorias-propostas.md`).

## Passo 7 — Conferência (dia D)

1. Atualizar o Power BI à mão. A cliente faz, ou o Matheus pela conta da cliente.
2. Na Visão Geral, "hoje" e ontem devem mostrar pedidos e receita, sem "(Em branco)".
3. Conferir com a cliente 2 ou 3 números de outubro e novembro na VTEX e no Power BI.
4. Na página de canais, conferir se os canais aparecem (De/Para) e se as pendências das notas do GA4 foram
   classificadas.

## Passo 8 — Ligar o agendamento

- **Na VPS:** instalar e ligar o serviço (`docs/runbooks/vps.md`, seção "Serviço"), com `SCHEDULER_ENABLED=true`.
- **Horários:**
    - VTEX e AnyMarket: a cada 30 min;
    - catálogo: 1x/dia;
    - GA4: a cada 3 h.
- **Power BI (cliente):** agendar a atualização logo depois das cargas e ligar o alerta de falha de atualização.
- **Alertas do ETL (fase 8):** falha de job por e-mail. Os destinatários ainda serão definidos.

## Plano de volta

1. Parar o serviço na VPS: `sudo systemctl stop amobeleza-mascavo-etl`.
2. O administrador restaura o backup do passo 4 nas tabelas afetadas.
3. Se for preciso, remover o usuário: `DROP USER 'wicomm_etl'@'<IP_DA_VPS>';`.
4. Atualizar o Power BI. Ele volta a mostrar o que tinha antes da virada.

## Depois da virada

- GA4 da Amobeleza: permissão, paridade e GRANTs, se houver tabela nova.
- Fases 2, 4 e 5: cada conector com a sua paridade e um adendo de GRANTs em `ops/mysql/`.
- Levar à cliente o `docs/melhorias-propostas.md`.
