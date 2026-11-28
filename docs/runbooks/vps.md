# VPS do ETL (Hostinger)

A VPS tem dois papéis. Ela é o **IP fixo** liberado no MySQL da cliente: daqui saem o `wicomm_leitura` e, depois da
virada, o `wicomm_etl`. E ela **roda o ETL**: hoje grava no MySQL local dela, em Docker; depois da liberação de
produção, grava no banco da cliente. Não tem domínio nem porta aberta para fora.

Montada em 26/11/2026 (hostname `srv2190791`), seguindo este roteiro. Cada bloco diz **onde rodar**: no PowerShell do
seu computador ou na VPS, e com qual usuário.

## 1. Criação (painel da Hostinger)

- Plano: o KVM 1 serve para as duas marcas.
- Local: **Brasil**, por latência e LGPD. Trocar a região depois muda o IP, e aí o MySQL da cliente precisa liberar
  o novo IP.
- Sistema: "Apenas SO" → **Ubuntu LTS**.
- Guarde a senha do root no gerenciador de senhas da empresa. Ela só serve até a chave SSH estar cadastrada.
- No painel, ligue o firewall da VPS liberando a porta 22. Restrinja a origem só se o IP da empresa for fixo. Ligue
  também o backup ou snapshot semanal.

## 2. Chave SSH (antes de desligar a senha)

**PowerShell (seu computador).** Uma chave pessoal já existente serve: confira com
`Test-Path "$env:USERPROFILE\.ssh\id_ed25519.pub"`. Se não houver, crie com `ssh-keygen -t ed25519`.

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh root@IP_DA_VPS "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
ssh -o BatchMode=yes root@IP_DA_VPS "echo chave ok"
```

O primeiro comando pede a senha do root uma última vez. O segundo tem de responder `chave ok`. Os comandos levam o IP
puro, sem os sinais `<` e `>`.

## 3. Primeira configuração (VPS, como `root`, uma vez)

```bash
apt update && apt -y upgrade
apt -y install git curl unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Usuário próprio do ETL, sem senha (só chave). O "usermod: no changes" do adduser é aviso normal.
adduser --disabled-password --gecos "" etl
mkdir -p /home/etl/.ssh && cp /root/.ssh/authorized_keys /home/etl/.ssh/
chown -R etl:etl /home/etl/.ssh && chmod 700 /home/etl/.ssh && chmod 600 /home/etl/.ssh/authorized_keys

# Docker para o MySQL local. O grupo só vale numa sessão SSH nova do etl.
apt -y install docker.io docker-compose-v2
usermod -aG docker etl
docker compose version
```

**Teste antes de desligar a senha.** No PowerShell do seu computador, num terminal novo, rode
`ssh -o BatchMode=yes etl@IP_DA_VPS "echo etl ok"`. Ele tem de responder `etl ok`.

**Desligar a senha (VPS, como `root`).** A Hostinger põe `PasswordAuthentication yes` em
`/etc/ssh/sshd_config.d/50-cloud-init.conf`. Esse arquivo vale antes do principal, então é preciso trocar nos dois:

```bash
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/*.conf
systemctl restart ssh
sshd -T | grep -E "^passwordauthentication|^permitrootlogin"   # passwordauthentication no / permitrootlogin prohibit-password

# Firewall: só SSH entrando. O ETL só faz conexões de saída.
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw enable
ufw status
```

Depois disso, no PowerShell, `ssh -o BatchMode=yes etl@IP_DA_VPS "echo continua ok"` tem de continuar entrando.

## 4. Node e código (VPS, como `etl`)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24 && node -v
```

O repositório é privado, e o código entra por **deploy key**: uma chave só de leitura e só deste repositório. A
organização precisa permitir deploy keys; isso foi liberado em 26/11/2026.

```bash
ssh-keygen -t ed25519 -C "vps-etl-deploy" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

No GitHub, vá em repositório → **Settings → Deploy keys → Add deploy key**, cole a linha e **não** marque "Allow write
access". Depois, na VPS, como `etl`:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com            # "successfully authenticated"
git clone git@github.com:wicomm-projects/amobeleza-mascavo-etl.git ~/amobeleza-mascavo-etl
cd ~/amobeleza-mascavo-etl && npm ci && npm run build
cp .env.example .env && chmod 600 .env
```

## 5. Chave do GA4 e `.env`

**PowerShell (seu computador).** `CAMINHO_DA_CHAVE` é o caminho que está em `GOOGLE_APPLICATION_CREDENTIALS` no `.env`
do seu computador. A chave nunca passa por chat ou e-mail.

```powershell
ssh etl@IP_DA_VPS "mkdir -p ~/.config/amo-etl && chmod 700 ~/.config/amo-etl"
scp "CAMINHO_DA_CHAVE" etl@IP_DA_VPS:/home/etl/.config/amo-etl/ga4-service-account.json
ssh etl@IP_DA_VPS "chmod 600 ~/.config/amo-etl/ga4-service-account.json"
```

Senhas novas para o MySQL local, **PowerShell (seu computador)**, uma por vez. São 48 caracteres hexadecimais, sem
caractere especial:

```powershell
$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

**VPS, como `etl`:** `nano ~/amobeleza-mascavo-etl/.env`. Os valores são os mesmos do `.env` do seu computador,
menos estes:

| Variável                         | Valor na VPS                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `REF_DB_HOST` / `REF_DB_PORT`    | Banco da cliente direto, porta 3306. A VPS é o IP liberado, então não há túnel |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/home/etl/.config/amo-etl/ga4-service-account.json`                           |
| `TARGET_DB_*`                    | MySQL local da VPS: `127.0.0.1`, `3307`, `etl_local`, senha nova 1             |
| `LOCAL_MYSQL_ROOT_PASSWORD`      | Senha nova 2. Preencher **antes** do primeiro `db:up`                          |
| `SCHEDULER_ENABLED`              | `false` até a liberação de produção                                            |

## 6. MySQL local e primeira carga (VPS, como `etl`)

Toda sessão SSH nova começa em `/home/etl`, então entre na pasta antes: `cd ~/amobeleza-mascavo-etl`. Rode as cargas
longas dentro do `tmux` (`tmux new -s carga`). Para sair sem parar a carga: Ctrl+B e depois D. Para voltar:
`tmux attach -t carga`.

```bash
npm run db:up                    # permission denied? saia e entre de novo (grupo docker)
npm run etl -- db:apply
npm run etl -- sources
npm run etl -- check-access      # OK em tudo
npm run etl -- run vtex-catalog --brand mascavo
npm run etl -- run vtex-catalog --brand amobeleza
npm run etl -- run vtex-orders --brand mascavo --from 2026-10-05
npm run etl -- run vtex-orders --brand amobeleza --from 2026-10-05
npm run etl -- run anymarket-orders --from 2026-10-05
npm run etl -- run ga4 --brand mascavo --from 2026-08-20
npm run etl -- run ga4 --brand amobeleza --from 2026-10-01
```

Enquanto `TARGET_MODE=local`, tudo grava só no MySQL local da VPS, com o dado pessoal mascarado (AMO-Q6). A troca
para a produção está na seção 9.

## 7. Atualizar o código (depois de cada merge na `main`)

**VPS, como `etl`:**

```bash
cd ~/amobeleza-mascavo-etl && git pull && npm ci && npm run build
```

O `.env` não é tocado.

## 8. Túnel para as paridades (PowerShell, seu computador)

```powershell
ssh -N -L 3316:HOST_DO_BANCO:3306 etl@IP_DA_VPS
```

O túnel usa o `etl`, porque o root não entra mais por senha. No `.env` do seu computador: `REF_DB_HOST=127.0.0.1` e
`REF_DB_PORT=3316`.

## 9. Modo produção (depois do merge do PR de liberação, do backup e da última paridade)

Até aqui a VPS grava só no MySQL local dela. Para gravar no banco da cliente, o `.env` da VPS troca o destino. O resto
do `.env` (VTEX, AnyMarket, GA4, `REF_DB_*`) não muda.

**VPS, como `etl`:** `nano ~/amobeleza-mascavo-etl/.env` e troque o bloco do destino por:

| Variável             | Valor                                                            |
| -------------------- | ---------------------------------------------------------------- |
| `TARGET_MODE`        | `production`                                                     |
| `TARGET_DB_HOST`     | o mesmo valor do `REF_DB_HOST` deste `.env` (o banco da cliente) |
| `TARGET_DB_PORT`     | `3306`                                                           |
| `TARGET_DB_USER`     | `wicomm_etl`                                                     |
| `TARGET_DB_PASSWORD` | a do gerenciador de senhas (criada em 27/11/2026)                |

Depois, ainda na VPS:

```bash
cd ~/amobeleza-mascavo-etl && npm run etl -- sources        # "Destino das cargas: PRODUÇÃO da cliente (wicomm_etl)"
npm run etl -- check-access                                   # "Destino: PRODUÇÃO (cliente) OK: servidor, usuário..."
```

O que o ETL confere no modo produção (se algo falhar, ele não grava nada):

- no `.env`: porta e usuário iguais aos de `PRODUCTION_TARGET`; host nunca loopback; `root` recusado;
- no servidor, antes de cada carga e do lock: `@@hostname` e `@@server_uuid` da produção, sessão cifrada (TLS 1.2+),
  `CURRENT_USER()` = `wicomm_etl@<IP>` e `SHOW GRANTS` só com `SELECT/INSERT/UPDATE/DELETE` tabela por tabela.

A conexão com o MySQL da cliente (destino e leitor da paridade) sempre pede TLS. O certificado do servidor é o padrão
do MySQL e não é validado: a cifra protege contra quem escuta a rede, não contra quem se passa pelo servidor.

No modo produção, a máscara de dado pessoal é desligada (o Power BI precisa do dado), `db:apply` é recusado e
`--fixture` só roda com `--dry-run`.

**Para voltar ao MySQL local:** `TARGET_MODE=local` e o bloco antigo (`127.0.0.1`, `3307`, `etl_local`).

## 10. Serviço (depois da primeira carga em produção conferida)

Modelo em `ops/systemd/amobeleza-mascavo-etl.service`. Antes de instalar, ajuste o caminho do Node no `ExecStart`:
`which node` mostra a versão exata do nvm. Os logs ficam no journald (`journalctl -u amobeleza-mascavo-etl`).

No `.env` da VPS, antes de ligar: `SCHEDULER_ENABLED=true` e `TARGET_DATABASES` com os bancos liberados pela cliente.
Enquanto só a Mascavo estiver liberada, `TARGET_DATABASES=mascavo_etl`: o agendador só agenda VTEX (pedidos a cada
30 min, catálogo às 05:15) e GA4 (a cada 3 h, aos 15 min) da Mascavo; os jobs da Amobeleza e o AnyMarket ficam de fora,
e um `run` manual neles é recusado (dry-run continua livre). `npm run etl -- sources` mostra a linha "Bancos liberados".

```bash
sudo cp ops/systemd/amobeleza-mascavo-etl.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now amobeleza-mascavo-etl
curl -s http://127.0.0.1:3000/health
```

O `etl` não tem `sudo`: esses três comandos rodam como `root`. Do seu computador, o status fica acessível por túnel:
`ssh -N -L 3000:127.0.0.1:3000 etl@IP_DA_VPS`. O roteiro da virada está em
`docs/planos/2026-11-25-virada-producao.md`.

## Se a VPS receber outros projetos

Cada projeto fica no seu usuário Linux e na sua pasta, com o `.env` em `chmod 600`. O IP liberado no MySQL da cliente
vale para tudo que roda nesta VPS, então o acesso a ela fica restrito à equipe.
