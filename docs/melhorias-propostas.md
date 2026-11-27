# Melhorias propostas para a cliente

Documento vivo, iniciado em 24/11/2026, para levar à cliente quando a integração terminar.

**O que foi entregue.** O ETL novo grava nas mesmas tabelas, com as mesmas colunas, tipos, convenções e
transformações de dados do ETL antigo. Isso inclui os pontos em que o desenho antigo tem defeito, para que os
relatórios do Power BI continuem iguais. Durante a reconstrução encontramos os pontos abaixo. **Nenhum deles foi
alterado**: ficam como proposta, separados por prioridade.

A exceção são defeitos de gravação do ETL antigo que o ETL novo não reproduz, porque eram erro de dado e não convenção.
Eles estão na seção "O que o ETL novo grava diferente do antigo", e a cliente precisa saber deles antes da virada.

Cada fase da integração acrescenta aqui o que encontrar. Os detalhes técnicos estão nas referências do fim.

## Como ler

**Prioridade**

- **Alta**: o usuário vê número errado, ou há risco de segurança.
- **Média**: risco de erro no futuro ou de manutenção difícil.
- **Baixa**: organização e clareza.

**Nível da mudança** (quanto custa e quem precisa participar)

- **1, só no ETL**: sem mexer no banco da cliente nem no Power BI.
- **2, no banco da cliente, só acrescentando** (comentário, índice, view): precisa de autorização e backup; os
  relatórios continuam iguais.
- **3, banco e Power BI juntos**: precisa de quem mantém o Power BI, de uma janela combinada, às vezes de migrar o
  histórico, e de um plano de volta.
- **Power BI**: mudança só no arquivo do relatório, fora do ETL.

## Resumo

| #   | Ponto                                                               | Onde             | Prioridade | Nível                        |
| --- | ------------------------------------------------------------------- | ---------------- | ---------- | ---------------------------- |
| 1   | Sessões e Taxa de conversão sempre em zero na Visão Geral           | Power BI         | Alta       | Power BI                     |
| 2   | Senhas em texto aberto nas documentações da WPP, inclusive root     | Segurança        | Alta       | Servidor e banco             |
| 3   | "Hoje" dos cartões depende da última atualização do Power BI        | Operação         | Alta       | Power BI                     |
| 4   | Pedidos de marketplace fora do TikTok aparecem como origem Site     | Power BI         | Média      | Power BI                     |
| 5   | Regras de status do AnyMarket em maiúsculas nunca se aplicam        | Power BI         | Média      | Power BI                     |
| 6   | Listas fixas digitadas dentro do Power BI                           | Power BI         | Média      | 2 ou 3                       |
| 7   | Total do pedido em centavos e o resto em reais                      | Banco            | Média      | 2 (3 não recomendado)        |
| 8   | Departamento da árvore de categorias gravado errado pelo ETL antigo | Banco            | Média      | 1, a confirmar               |
| 9   | `vtex_orders` sem chave primária aceita pedido duplicado            | Banco            | Média      | 2                            |
| 10  | Nome `sub_category_id` guarda o ID da categoria pai                 | Banco            | Baixa      | 3 (não recomendado)          |
| 11  | Consulta de produtos liga uma tabela que não usa (`vtex_skus`)      | Power BI         | Baixa      | Power BI                     |
| 12  | Tabelas sem uso: `vtex_products` da Amobeleza e as do Laravel       | Banco            | Baixa      | 2                            |
| 13  | Valores substitutos gravados quando a VTEX não manda o dado         | Banco            | Baixa      | 1                            |
| 14  | GA4 da Amobeleza com nomes de coluna do Universal Analytics         | Banco e Power BI | Baixa      | 3                            |
| 15  | Tipo de envio do AnyMarket nunca gravado                            | Banco            | Baixa      | 1                            |
| 16  | AnyMarket guarda só o último pagamento de cada pedido               | Banco e Power BI | Média      | 1 + Power BI                 |
| 17  | Seller do item gravado como 0 quando é seller terceiro              | Banco            | Média      | 2 (3 se algum relatório ler) |
| 18  | Usuário `dbeaver` com poder de administrador, aceito de qualquer IP | Segurança        | Alta       | Banco                        |
| 19  | Acesso remoto (RDP) à máquina do banco publicado na internet        | Segurança        | Alta       | Servidor                     |
| 20  | Logs do Laravel (Telescope) podem guardar chaves e dado pessoal     | Segurança        | Alta       | Banco, a confirmar           |
| 21  | Conexão com o MySQL sem cifra obrigatória, com certificado padrão   | Segurança        | Média      | Servidor e banco + 1         |
| 22  | Consultas do ETL sem tempo limite                                   | Operação         | Baixa      | 1                            |

## Prioridade alta

### 1. Sessões e Taxa de conversão sempre em zero

- **O que é:** no Power BI B2C da Mascavo, as duas medidas estão fixas em 0. A fórmula original, que lia o BigQuery,
  está comentada no arquivo.
- **Impacto:** dois cartões da página principal mostram 0 para sempre, independentemente do ETL.
- **Proposta:** ligar as medidas a uma fonte de sessões. Pode ser o GA4, que o ETL já carrega, ou a fonte original. A
  escolha da fonte é da cliente.

### 2. Senhas em texto aberto nas documentações da WPP

- **O que é:** as documentações entregues pela WPP trazem hosts, usuários e senhas em texto aberto, inclusive do
  usuário `root` do MySQL.
- **Impacto:** qualquer pessoa com acesso a esses PDFs tem acesso total aos bancos.
- **Proposta:**
    - trocar a senha do `root` e das demais contas citadas;
    - revogar os acessos da WPP;
    - conferir que a porta do MySQL só aceita os IPs conhecidos;
    - manter o ETL com usuário próprio, com permissão só nas tabelas que ele grava.
- **Andamento:** o ETL novo já usa usuários próprios: `wicomm_leitura` (só leitura) e `wicomm_etl` (só
  SELECT/INSERT/UPDATE/DELETE tabela por tabela, preso ao IP da VPS). O `wicomm_etl` foi criado em 27/11/2026, a
  pedido da cliente, com o usuário `dbeaver` da documentação da WPP. Esse foi o único uso dele, e o ETL nunca o usa.
  Os pontos 18 e 19 detalham as contas da documentação que continuam abertas.

### 3. "Hoje" dos cartões depende da atualização do Power BI

- **O que é:** o Power BI decide o que é "hoje" no momento da atualização, e não quando o relatório é aberto. Em
  24/11/2026 a última atualização era de 04/11. Por isso os cartões da Visão Geral mostravam "(Em branco)" e −100%.
- **Impacto:** se a atualização falha ou atrasa, os cartões de "hoje" ficam vazios ou defasados, sem aviso.
- **Proposta:**
    - agendar a atualização do Power BI logo depois das cargas de pedidos do ETL;
    - ligar o alerta de falha de atualização do Power BI para alguém da cliente.

## Prioridade média

### 4. Pedidos de marketplace fora do TikTok aparecem como origem "Site"

- **O que é:** no Power BI B2C da Mascavo, os pedidos do AnyMarket só ganham "Tipo de pedido" quando são do TikTok
  Shop. Os outros ficam sem tipo. Existem regras de origem "Marketplace" para DRPACHECO, PANVEL, DRSAOPAULO e EPOCA,
  mas elas nunca se aplicam, porque dependem de um tipo que nunca é gerado.
- **Impacto:** se a Mascavo vender por outro marketplace via AnyMarket, esses pedidos aparecem como origem "Site".
- **Proposta:** confirmar com a cliente por quais marketplaces a Mascavo vende e ajustar as regras de tipo no Power BI.

### 5. Regras de status do AnyMarket em maiúsculas nunca se aplicam

- **O que é:** o Power BI passa o status para minúsculas antes de traduzir. Por isso, as regras escritas em
  maiúsculas nunca são usadas. Exemplo: `PAID_WAITING_SHIP` cai na regra em minúsculas ("Aprovado"), e não na de
  maiúsculas ("Em andamento").
- **Impacto:** pedidos pagos e ainda não enviados contam como "Aprovado". Pode ser a intenção, ou não.
- **Proposta:** confirmar com a cliente qual classificação vale e remover a regra que sobra.

### 6. Listas fixas digitadas dentro do Power BI

- **O que é:** o arquivo do relatório guarda listas digitadas à mão:
    - pedidos de fraude;
    - cerca de 30 trocas de código de SKU;
    - troca de código de cupom;
    - ajuste de tráfego de junho;
    - De/Para de clientes, empresas e filial;
    - regiões.
- **Impacto:** só quem edita o arquivo consegue atualizar, e é fácil esquecer. Uma lista desatualizada muda os números
  sem aviso.
- **Proposta:** mover essas listas para uma planilha ou tabela mantida pela cliente, que o Power BI lê (nível 2 ou 3).

### 7. Total do pedido em centavos, o resto em reais

- **O que é:** `vtex_orders.total_value` guarda centavos, embora a documentação o descreva como R$. As demais colunas
  de valor guardam reais: detalhes, itens, pagamentos, logística e o AnyMarket. O Power BI divide só o total por 100.
- **Impacto:** nos relatórios atuais, nenhum. Quem consultar o banco direto (analista, relatório novo, SQL avulso)
  soma errado sem perceber. A coluna também limita o valor do pedido a R$ 999.999,99.
- **Proposta:**
    - comentário "em centavos" na coluna (nível 2);
    - se houver relatórios novos, uma view com tudo em reais (nível 2).
    - Não recomendamos migrar a coluna para reais (nível 3). Seria preciso atualizar todo o histórico e mudar todos os
      relatórios no mesmo momento; se um lado mudar antes, os relatórios mostram valores 100 vezes errados.

### 8. Departamento da árvore de categorias gravado errado pelo ETL antigo

- **O que é:** na tabela `vtex_category_tree`, o ETL antigo gravava em `department` o nome da primeira raiz para
  todas as raízes ("Face" na Mascavo, "Cabelos" na Amobeleza), e também em parte das categorias de 3º nível. O ETL
  novo grava o valor correto: o nome do departamento raiz.
- **Impacto:** o Power BI B2C da Mascavo não lê essa coluna. Os relatórios da Amobeleza ainda serão conferidos. Se
  algum ler, os números por departamento mudam em relação ao ETL antigo.
- **Proposta:** a definir depois da conferência. Ou se mantém o valor correto avisando a cliente, ou se reproduz o
  valor antigo.

### 9. `vtex_orders` sem chave primária

- **O que é:** a tabela não tem chave única em `order_id` e aceita o mesmo pedido duas vezes. O Power BI remove os
  duplicados por conta própria.
- **Impacto:** qualquer consulta fora do Power BI pode contar o mesmo pedido duas vezes. O ETL novo não gera
  duplicados.
- **Proposta:** limpar os duplicados antigos e criar um índice único em `order_id` (nível 2, com backup).

## Prioridade baixa

### 10. Nome `sub_category_id` guarda o ID da categoria pai

- **O que é:** na árvore de categorias, a coluna guarda o ID do pai (0 na raiz). O jeito de guardar está certo, mas o
  nome sugere outra coisa.
- **Proposta:** manter e documentar (já feito). Renomear (nível 3) só se os relatórios forem refeitos.

### 11. Consulta de produtos liga uma tabela que não usa

- **O que é:** a consulta de produtos do Power BI B2C da Mascavo faz uma ligação com `vtex_skus` e não usa nenhuma
  coluna dela.
- **Proposta:** remover a ligação no Power BI. Depois disso, a tabela pode ser apagada.

### 12. Tabelas sem uso

- **O que é:**
    - `amobeleza_etl.vtex_products` foi gravada uma única vez, em 02/09/2024, e nenhum relatório a lê. O ETL novo não
      a grava.
    - As tabelas do Laravel do ETL antigo (`failed_jobs`, `telescope_*`, `migrations`, `users` e outras) ficam sem uso
      depois da troca. Elas podem guardar chaves e dado pessoal: ver o ponto 20.
- **Proposta:** apagar com backup (nível 2), ou manter como histórico.

### 13. Valores substitutos quando a VTEX não manda o dado

- **O que é:** em algumas colunas obrigatórias, o ETL antigo gravava um valor de preenchimento quando a VTEX vinha
  sem o dado. O ETL novo replica isso. Exemplos:
    - data de autorização e de faturamento com o horário da carga;
    - código de lock `00-<pedido>`;
    - referência `-`.
- **Impacto:** nenhum relatório lê essas colunas. Mesmo assim, o horário da carga pode ser confundido com uma data
  real do pedido.
- **Proposta:** se a cliente quiser, deixar essas colunas vazias quando não houver dado (nível 2: elas aceitarem
  vazio; nível 1: o ETL gravar vazio).

### 14. GA4 da Amobeleza com nomes de coluna do Universal Analytics

- **O que é:** as tabelas do Web Analytics da Amobeleza mantêm nomes e dimensões do Universal Analytics, embora o dado
  venha do GA4 desde 2023/2024. A tradução foi aceita para manter os relatórios iguais. `sheets_google_drive_navegacao`
  é gravada, mas nenhum relatório a lê.
- **Proposta:** quando o Web Analytics for refeito, usar os nomes do GA4 e remover a tabela sem leitor (nível 3).

### 15. Tipo de envio do AnyMarket nunca gravado

- **O que é:** a API do AnyMarket manda o tipo de envio no campo `ShippingTypeToSend`, com S maiúsculo, mas o ETL
  antigo procurava o campo com s minúsculo. Por isso `anymarket_orders.meta_data_shipping_type_to_send` ficou sempre
  vazio (0 de 100 pedidos, inclusive os da Amazon, que mandam o campo). O ETL novo grava igual ao antigo.
- **Proposta:** se algum relatório precisar do tipo de envio, passar a ler a grafia certa (nível 1). Hoje nenhum
  relatório conhecido lê.

### 16. AnyMarket guarda só o último pagamento de cada pedido

- **O que é:** o ETL antigo gravava um pagamento por pedido, o último da lista do AnyMarket. Pedidos do Mercado Livre
  costumam ter dois ou três (ex.: cartão + saldo da conta), e os outros se perdem. O ETL novo grava igual ao antigo
  (decisão de 25/11/2026), para os relatórios não mudarem.
- **Impacto:** a "forma de pagamento" dos pedidos com mais de um método mostra só o último (cerca de 1% numa amostra de
  200 pedidos), e qualquer soma de valor pago desses pedidos fica menor que o real.
- **Proposta:** gravar todos os pagamentos (nível 1) e, junto, ajustar os relatórios que leem a tabela para escolher o
  pagamento principal ou somar os valores (Power BI).

### 17. Seller do item gravado como 0 quando é seller terceiro

- **O que é:** em `vtex_order_items.seller`, a VTEX manda o código do seller que vendeu o item: `1` para a própria
  loja e um código de texto para sellers terceiros do marketplace (ex.: `CNL007`). A coluna é `int`, então o ETL
  antigo gravava `0` para todo seller terceiro, e o ETL novo grava igual (correção de 26/11/2026). Na produção da
  Amobeleza, desde 01/08/2026: 37.944 itens com `1` e 64 com `0`. Nos pedidos novos (desde 05/10), foram 782 pedidos
  com seller terceiro.
- **Impacto:** pelo item, não dá para saber **qual** seller terceiro vendeu (Kassio Perfumaria, Poderosa Beleza...):
  todos viram `0`. Na Amobeleza, `vtex_orders.seller_name` guarda o nome do seller do pedido, o que cobre parte da
  necessidade; na Mascavo, essa coluna não existe.
- **Proposta:** mudar a coluna para texto (`ALTER TABLE vtex_order_items MODIFY seller varchar(50) NOT NULL`, nas duas
  marcas, nível 2) e o ETL passar a gravar o código real (`1`, `CNL007`...). Antes, conferir nos Power BI das duas
  marcas se algum lê `seller`: se ler como número, o relatório precisa de ajuste junto (nível 3). O ALTER é feito pelo
  administrador do banco (o `wicomm_etl` não tem permissão de alterar tabela).

### 18. Usuário `dbeaver` com poder de administrador, aceito de qualquer IP

Prioridade alta, segurança. Encontrado em 27/11/2026, ao criar o `wicomm_etl`.

- **O que é:** a documentação da WPP traz o usuário MySQL `dbeaver`, com a senha em texto aberto. Ele existe como
  `dbeaver@%`: o MySQL aceita esse login vindo de **qualquer** IP. E tem praticamente todos os poderes de
  administrador: criar e apagar bancos e usuários, dar permissões (`CREATE USER` e `GRANT OPTION`), `SUPER`,
  `SHUTDOWN`, `FILE`, além das permissões administrativas do MySQL 8 (`*_ADMIN`).
- **Impacto:** quem tiver o PDF da WPP (ou descobrir a senha) pode apagar ou alterar os dois bancos inteiros, ler todo
  o dado pessoal e desligar o servidor. Se a porta do MySQL aceitar conexão da internet, basta o PDF. Não conferimos
  o firewall da cliente; o `wicomm_leitura` só funcionou depois que o IP da VPS foi liberado, o que indica que existe
  alguma lista de IPs, mas o `dbeaver@%` não depende dela no MySQL.
- **Proposta (servidor e banco, feito pelo administrador da cliente):**
    - antes de tudo, descobrir quem usa o `dbeaver` hoje (o Power BI ou o gateway dele, por exemplo), para não
      derrubar nada;
    - trocar a senha;
    - restringir o host a IPs conhecidos (`RENAME USER 'dbeaver'@'%' TO 'dbeaver'@'<ip>'`), ou apagar o usuário se
      ninguém mais usa;
    - deixar a porta do MySQL aberta só para os IPs que precisam (a VPS do ETL e o gateway do Power BI).

### 19. Acesso remoto (RDP) à máquina do banco publicado na internet

Prioridade alta, segurança, a confirmar.

- **O que é:** a documentação da WPP traz um acesso de área de trabalho remota (RDP) à máquina Windows que roda o
  MySQL, num endereço público e numa porta alternativa, com usuário e senha em texto aberto.
- **Impacto:** RDP aberto na internet é um dos alvos mais atacados (tentativa de senha em massa, falhas do próprio
  RDP). Quem entra na máquina tem o banco, os arquivos e os backups. Não testamos se a porta continua aberta.
- **Proposta (servidor, feito pela cliente ou por quem cuida da máquina):**
    - trocar a senha do usuário da documentação e revogar o acesso da WPP;
    - deixar o RDP só por VPN, ou só para IPs conhecidos;
    - conferir se a máquina recebe as atualizações de segurança do Windows.

### 20. Logs do Laravel (Telescope) podem guardar chaves e dado pessoal

Prioridade alta, segurança, a confirmar.

- **O que é:** o ETL antigo era uma aplicação Laravel com o Telescope ligado em produção. O Telescope é uma ferramenta
  de depuração que grava em `telescope_entries` as requisições, as consultas ao banco com os valores e as chamadas
  feitas a outras APIs. Essa tabela tem 193 GB na Amobeleza. Pela regra do projeto, o ETL novo nunca leu as tabelas do
  Laravel, então não sabemos o que há lá dentro.
- **Impacto:** se o Telescope gravou as chamadas à VTEX e ao AnyMarket com os cabeçalhos, as chaves de API (AppKey,
  AppToken, token do AnyMarket) estão no banco, em texto aberto. As consultas gravadas podem ter dado pessoal de
  clientes. As tabelas `users`, `password_resets` e `personal_access_tokens` também guardam credenciais da aplicação
  antiga.
- **Proposta:**
    - trocar as chaves da VTEX e do AnyMarket que o ETL antigo usava, se ainda forem as mesmas (o ETL novo pode ganhar
      chaves próprias, só de leitura);
    - fazer backup e esvaziar as tabelas do Laravel (ponto 12), começando pela `telescope_entries`; isso também libera
      os 193 GB (nível 2, feito pelo administrador do banco).

### 21. Conexão com o MySQL sem cifra obrigatória, com certificado padrão

Prioridade média, segurança. Encontrado em 27/11/2026.

- **O que é:** o MySQL da cliente aceita TLS 1.2 e 1.3, mas não exige (`require_secure_transport = OFF`). Uma sessão do
  DBeaver aberta sem configuração especial ficou sem cifra (`Ssl_cipher` vazio). O certificado é o padrão que o MySQL
  gera sozinho (`server-cert.pem`), então nenhum cliente consegue conferir, pelo certificado, que está falando com o
  servidor certo. Não sabemos se o ETL antigo usava TLS.
- **Impacto:** quem conecta sem pedir TLS manda usuário, consultas e dado pessoal em texto aberto pela internet. O ETL
  novo pede TLS 1.2+ e recusa gravar sem cifra, mas, com o certificado padrão, isso protege só contra quem escuta a
  rede, não contra quem se passa pelo servidor.
- **Proposta:**
    - instalar um certificado próprio no MySQL (ou passar ao ETL o CA que o MySQL gerou) e o ETL passar a validar o
      certificado (nível 1, depois do certificado);
    - depois de confirmar que todos os clientes conectam com TLS (gateway do Power BI, DBeaver), ligar
      `require_secure_transport = ON` (servidor).

### 22. Consultas do ETL sem tempo limite

Prioridade baixa, operação.

- **O que é:** o ETL tem tempo limite para abrir a conexão com o banco (10 s), mas não para cada consulta. Se a rede
  entre a VPS e o banco da cliente cair no meio de uma carga, a conexão fica presa até o MySQL derrubá-la.
- **Impacto:** a carga demora a falhar. O agendador não começa outra carga do mesmo job enquanto essa não termina,
  então não há dado duplicado nem gravação pela metade (a transação desfaz), só atraso no aviso.
- **Proposta:** tempo limite por consulta no gravador (nível 1).

## O que o ETL novo grava diferente do antigo

Medido na comparação com a produção (paridade, 24 e 25/11/2026, só leitura). Nas colunas que os relatórios usam, o
ETL novo grava igual ao antigo. As diferenças abaixo são defeitos do ETL antigo, e o novo grava o que a VTEX ou o
AnyMarket mandam.

| Ponto                                                                                                                                                                                                                                         | Onde                                                                                                | O que muda para a cliente                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pedidos da Mascavo nunca eram atualizados** depois da primeira gravação. Numa amostra de 200 pedidos de agosto, nenhum tinha o status de hoje: gravados como "em preparação", hoje faturados. Na Amobeleza, 199 de 200 estavam atualizados. | `vtex_orders`, `vtex_order_details` (Mascavo)                                                       | O ETL novo atualiza o pedido quando ele muda na VTEX (janela de 45 dias). Pedido cancelado depois de aprovado passa a aparecer como cancelado. Na amostra de agosto isso não aconteceu, mas pode mudar números de períodos recentes. O histórico mais antigo continua como o ETL antigo gravou, a menos que se faça uma recarga. |
| Quantidade de itens do pedido sempre 0 na Mascavo                                                                                                                                                                                             | `vtex_orders.total_items`                                                                           | Passa a ter a quantidade real. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                    |
| Descrição, descrição curta, palavras-chave e meta description dos produtos gravadas como "0" na Mascavo                                                                                                                                       | `vtex_products`                                                                                     | Passam a ter o texto da VTEX. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                     |
| E-mail do cliente vazio em cerca de metade dos perfis                                                                                                                                                                                         | `vtex_client_profile.email`                                                                         | Passa a ter o e-mail que a VTEX manda (um apelido, não o e-mail real). Nenhum relatório conhecido lê.                                                                                                                                                                                                                            |
| Departamento das categorias raiz com o nome da primeira raiz                                                                                                                                                                                  | `vtex_category_tree.department`                                                                     | Ponto 8 acima: a confirmar no Power BI da Amobeleza.                                                                                                                                                                                                                                                                             |
| Colunas que o ETL antigo não preenchia: previsão de entrega do pedido e transação ativa                                                                                                                                                       | `vtex_orders.shipping_estimated_date*`, `vtex_order_payment_transactions.is_active`                 | Passam a ter o valor da VTEX. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                     |
| AnyMarket: campos que a gravação antiga deixou vazios (nome e EAN do SKU, IDs do pedido e do pagamento no marketplace, país normalizado, "precisa de XML da nota")                                                                            | `anymarket_order_items`, `anymarket_order_payments`, `anymarket_order_shipping`, `anymarket_orders` | Passam a ter o valor do AnyMarket. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                |

| GA4 da Amobeleza: cada dia gravado duas vezes pelo pipeline antigo (acrescentava sem apagar); numa semana de setembro, 1.806 linhas repetidas no tráfego e 264 nas transações | `amobeleza_etl.sheets_google_drive_trafego` e `_transacoes` | Se o Power BI da Amobeleza soma sem tirar a repetição, as sessões, transações e receita de GA4 dele **caem** para o valor real (os totais repetidos davam cerca de 1,5x a 1,9x). A confirmar no Power BI da Amobeleza. |
| GA4: receita e conversões da tabela de vendas cerca de 5% abaixo do total do GA4 (numa semana de agosto: 862 mil contra 911 mil, que é o total da tabela de itens, antiga e nova) | `sheets_google_drive_vendas` | O ETL novo grava o total do GA4: a receita e as conversões "por canal" do GA4 sobem cerca de 5%. Os pedidos e a receita da VTEX não mudam. |

**Proposta:** apresentar à cliente antes da virada, principalmente o primeiro item. Se ela quiser o histórico da
Mascavo com o status atualizado, dá para fazer uma recarga dos pedidos antigos (nível 1, sem mudar o Power BI).

## Referências internas

- Mapa do Power BI B2C da Mascavo: `docs/contrato/powerbi-mascavo-b2c.md`
- Convenções gravadas (unidades, datas, chaves): `docs/contrato/convencoes.md`
- Conectores: `docs/conectores/vtex.md`, `docs/conectores/ga4.md`, `docs/conectores/anymarket.md`
