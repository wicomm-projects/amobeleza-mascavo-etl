# Plano — Virada para produção (VTEX, AnyMarket e GA4 das duas marcas)

Pergunta AMO-Q40 (25/11/2026). Este é o roteiro para o ETL novo começar a gravar nos bancos da cliente (`mascavo_etl` e
`amobeleza_etl`), que o Power BI lê. **Nada aqui foi executado.** Cada passo diz quem faz e o que confere.

## Pré-requisitos

| Item                                   | Situação                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Paridade com a produção                | OK: VTEX das duas marcas (PR #15), AnyMarket (#16) e GA4 da Mascavo (#18)                            |
| Autorização da cliente                 | **Recebida pelo WhatsApp**, segundo o Matheus em 25/11/2026. Guardar um print ou exportar a conversa |
| VPS                                    | Montada (`docs/runbooks/vps.md`); primeira carga real no MySQL local dela em 27/11/2026              |
| Usuário MySQL `wicomm_etl`             | **Criado em 27/11/2026** pelo Matheus, a pedido da cliente (43 comandos, login testado)              |
| Backup das tabelas                     | Na véspera (passo 4)                                                                                 |
| PR de liberação do destino de produção | Em revisão: `docs/planos/2026-11-27-liberacao-destino-producao.md` (passo 3)                         |

A mensagem de WhatsApp é a autorização por escrito que o `CLAUDE.md` pede. Por isso essa regra não muda.

## Escopo desta virada

- **Entram:**
    - VTEX das duas marcas (pedidos e catálogo);
    - AnyMarket (`amobeleza_etl`);
    - GA4 da Mascavo;
    - GA4 da Amobeleza (paridade no PR #20, 25/11/2026).
- **Ficam para depois**, cada um com a sua paridade e os seus GRANTs quando o conector existir:
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
4. Na VPS, preencher o `.env` só depois do merge do PR de liberação e do backup (passo 4): `docs/runbooks/vps.md`,
   seção "Modo produção". A senha só existe nesse `.env` e no gerenciador de senhas.

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

Com o `wicomm_leitura`, que só lê, um `mysqldump` das 42 tabelas do mapa (as mesmas do script do passo 2). Feito em
27/11/2026 às 14:10 com os comandos abaixo, que são os que funcionaram.

**Tudo na VPS, como `etl`, numa mesma janela do `tmux`** (as variáveis só valem na janela em que foram criadas). Fora
do horário de uso: o dump lê as tabelas inteiras do banco da cliente.

1. **Pasta e variáveis.** A VPS não tem `mysqldump` instalado; o do container do MySQL local é usado só como
   programa, apontando para o banco da cliente (sai pelo IP da VPS). Host, porta e usuário saem do `.env`. A **senha
   sai pelo `dotenv`**, o mesmo leitor do ETL: com `grep | cut`, aspas e caracteres especiais do `.env` vêm junto e o
   MySQL responde `Access denied`. As listas de tabelas saem do script do `wicomm_etl`, **sem crase** no comando (a
   crase se perde ao copiar de mensagem).

    ```bash
    cd ~/amobeleza-mascavo-etl
    mkdir -p ~/backup && chmod 700 ~/backup
    REF_DB_HOST=$(grep '^REF_DB_HOST=' .env | cut -d= -f2- | tr -d '\r')
    REF_DB_PORT=$(grep '^REF_DB_PORT=' .env | cut -d= -f2- | tr -d '\r')
    REF_DB_USER=$(grep '^REF_DB_USER=' .env | cut -d= -f2- | tr -d '\r')
    REF_DB_PASSWORD="$(node -e "require('dotenv').config(); process.stdout.write(process.env.REF_DB_PASSWORD || '')")"
    TABELAS_M=$(grep -oE 'mascavo_etl.{3}[a-z_0-9]+' ops/mysql/usuario-wicomm-etl.sql | sed -E 's/.*[^a-z_0-9]//' | tr '\n' ' ')
    TABELAS_A=$(grep -oE 'amobeleza_etl.{3}[a-z_0-9]+' ops/mysql/usuario-wicomm-etl.sql | sed -E 's/.*[^a-z_0-9]//' | tr '\n' ' ')
    echo "$TABELAS_M" | wc -w; echo "$TABELAS_A" | wc -w     # 19 e 23
    echo "[$REF_DB_USER] ${#REF_DB_PASSWORD} caracteres"       # sem mostrar a senha
    ```

2. **Dump.** `--single-transaction` tira uma foto consistente sem travar as tabelas; `--ssl-mode=REQUIRED` porque o
   dump tem dado pessoal; `--skip-triggers` e `--set-gtid-purged=OFF` deixam de fora o que o `wicomm_leitura` não lê e
   o que atrapalharia a restauração. A senha vai por variável de ambiente, não pela linha de comando.

    ```bash
    D=$(date +%Y%m%d-%H%M)
    for BANCO in mascavo_etl amobeleza_etl; do
      [ "$BANCO" = mascavo_etl ] && T="$TABELAS_M" || T="$TABELAS_A"
      MYSQL_PWD="$REF_DB_PASSWORD" docker exec -i -e MYSQL_PWD amo-etl-mysql mysqldump \
        --ssl-mode=REQUIRED --single-transaction --no-tablespaces --skip-lock-tables --skip-triggers --set-gtid-purged=OFF \
        -h "$REF_DB_HOST" -P "$REF_DB_PORT" -u "$REF_DB_USER" "$BANCO" $T > ~/backup/$BANCO-$D.sql
    done
    chmod 600 ~/backup/*.sql
    ```

3. **Conferência.** Cada arquivo tem de ter 19 e 23 `CREATE TABLE` e terminar em `-- Dump completed on ...`. A
   primeira linha `-- Host:` mostra que o dump veio do banco da cliente, não do local.

    ```bash
    ls -lh ~/backup/
    for f in ~/backup/*-$D.sql; do echo "$f: $(grep -c '^CREATE TABLE' "$f") tabelas | $(tail -1 "$f")"; done
    head -5 ~/backup/amobeleza_etl-$D.sql
    ```

    Em 27/11/2026: Mascavo 1,4 GB (19 tabelas) e Amobeleza 14 GB (23 tabelas), os dois completos.

4. **Comprimir e copiar para o computador do dev** (opcional, mesma foto em dois lugares). O `gzip -k` mantém o
   original; o `sha256sum` e o `Get-FileHash` provam que a cópia veio inteira.

    ```bash
    gzip -k ~/backup/*-$D.sql && sha256sum ~/backup/*.gz     # VPS, como etl
    ```

    ```powershell
    New-Item -ItemType Directory -Force "$env:USERPROFILE\Backups-amobeleza-mascavo"
    scp "etl@IP_DA_VPS:~/backup/*-AAAAMMDD-HHMM.sql.gz" "$env:USERPROFILE\Backups-amobeleza-mascavo\"
    Get-FileHash "$env:USERPROFILE\Backups-amobeleza-mascavo\*.gz" -Algorithm SHA256 | Format-List Path, Hash
    ```

    Em 27/11/2026: 187 MB e 2,4 GB comprimidos, com os hashes iguais nos dois lados. Depois de conferir, os `.sql`
    grandes podem sair da VPS (`rm ~/backup/*-$D.sql`).

- O backup tem dado pessoal: fica com `chmod 600` na VPS e, no computador do dev, fora do projeto e de pasta
  sincronizada (de preferência em disco com BitLocker). Os dois são apagados depois de 30 dias.
- Para restaurar, quem roda é o administrador: `mysql <banco> < arquivo.sql` (ou `gunzip -c arquivo.sql.gz | mysql
<banco>`). O arquivo recria as tabelas e os dados de antes.

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
npm run etl -- parity ga4 --brand amobeleza
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
| 6     | `npm run etl -- run ga4 --brand amobeleza --from 2026-10-01`            | O GA4 da Amobeleza parou em 30/09 e 01/10                     |

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

- Fases 2, 4 e 5: cada conector com a sua paridade e um adendo de GRANTs em `ops/mysql/`.
- Levar à cliente o `docs/melhorias-propostas.md`.
