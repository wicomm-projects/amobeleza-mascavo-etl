# VPS do ETL (Hostinger)

A VPS tem dois papéis: (1) ser o **IP fixo** liberado no firewall do MySQL da cliente — o dev acessa o banco por túnel
SSH através dela; (2) depois, rodar o ETL a cada 30 minutos. Não tem domínio nem porta aberta para fora.

## Criação (painel da Hostinger → VPS)

- Plano: KVM 1 serve para as duas marcas (KVM 2 se for receber serviços de outros clientes).
- Local: **Brasil** (latência e LGPD).
- Sistema: "Apenas SO" → **Ubuntu LTS** mais recente.
- Senha de root longa, guardada no gerenciador de senhas da empresa. Adicionar a chave SSH pública do dev.
- Anotar o IP dedicado: é ele que vai no pedido de acesso ao MySQL da cliente.

## Primeira configuração (como root, uma vez)

```bash
apt update && apt -y upgrade
apt -y install git curl unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Usuário próprio do ETL, sem senha (só chave SSH)
adduser --disabled-password --gecos "" etl
mkdir -p /home/etl/.ssh && cp /root/.ssh/authorized_keys /home/etl/.ssh/
chown -R etl:etl /home/etl/.ssh && chmod 700 /home/etl/.ssh && chmod 600 /home/etl/.ssh/authorized_keys

# SSH só por chave, sem root
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: só SSH entrando. O ETL só faz conexões de saída.
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw enable
```

No painel da Hostinger, ativar também o firewall da VPS com a mesma regra (porta 22, de preferência só do IP da
empresa) e os backups/snapshots semanais.

## Node e código (como `etl`)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24
git clone https://github.com/wicomm-projects/amobeleza-mascavo-etl.git ~/amobeleza-mascavo-etl
cd ~/amobeleza-mascavo-etl && npm ci && npm run build
cp .env.example .env && chmod 600 .env   # preencher na VPS; nunca copiar de/para chat
```

Para o `git clone` de repositório privado, usar uma **deploy key só leitura** cadastrada no GitHub do repositório.

## Serviço (depois da liberação de produção)

Modelo em `ops/systemd/amobeleza-mascavo-etl.service`. Os logs ficam no journald (`journalctl -u amobeleza-mascavo-etl`),
que já faz rotação.

```bash
sudo cp ops/systemd/amobeleza-mascavo-etl.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now amobeleza-mascavo-etl
curl -s http://127.0.0.1:3000/health
```

Do computador do dev, o status fica acessível por túnel: `ssh -N -L 3000:127.0.0.1:3000 etl@<ip-da-vps>`.

## Se a VPS receber outros projetos

Cada projeto no seu usuário Linux e na sua pasta, `.env` com `chmod 600`. Lembre: o IP liberado no MySQL da cliente vale
para tudo que roda nesta VPS — o acesso a ela fica restrito à equipe.
