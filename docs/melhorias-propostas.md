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

| #   | Ponto                                                               | Onde             | Prioridade | Nível                 |
| --- | ------------------------------------------------------------------- | ---------------- | ---------- | --------------------- |
| 1   | Sessões e Taxa de conversão sempre em zero na Visão Geral           | Power BI         | Alta       | Power BI              |
| 2   | Senhas em texto aberto nas documentações da WPP, inclusive root     | Segurança        | Alta       | Servidor e banco      |
| 3   | "Hoje" dos cartões depende da última atualização do Power BI        | Operação         | Alta       | Power BI              |
| 4   | Pedidos de marketplace fora do TikTok aparecem como origem Site     | Power BI         | Média      | Power BI              |
| 5   | Regras de status do AnyMarket em maiúsculas nunca se aplicam        | Power BI         | Média      | Power BI              |
| 6   | Listas fixas digitadas dentro do Power BI                           | Power BI         | Média      | 2 ou 3                |
| 7   | Total do pedido em centavos e o resto em reais                      | Banco            | Média      | 2 (3 não recomendado) |
| 8   | Departamento da árvore de categorias gravado errado pelo ETL antigo | Banco            | Média      | 1, a confirmar        |
| 9   | `vtex_orders` sem chave primária aceita pedido duplicado            | Banco            | Média      | 2                     |
| 10  | Nome `sub_category_id` guarda o ID da categoria pai                 | Banco            | Baixa      | 3 (não recomendado)   |
| 11  | Consulta de produtos liga uma tabela que não usa (`vtex_skus`)      | Power BI         | Baixa      | Power BI              |
| 12  | Tabelas sem uso: `vtex_products` da Amobeleza e as do Laravel       | Banco            | Baixa      | 2                     |
| 13  | Valores substitutos gravados quando a VTEX não manda o dado         | Banco            | Baixa      | 1                     |
| 14  | GA4 da Amobeleza com nomes de coluna do Universal Analytics         | Banco e Power BI | Baixa      | 3                     |

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
      depois da troca.
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

## O que o ETL novo grava diferente do antigo

Medido na comparação com a produção (paridade, 24/11/2026, só leitura). Nas colunas que os relatórios usam, o ETL
novo grava igual ao antigo. As diferenças abaixo são defeitos do ETL antigo, e o novo grava o que a VTEX manda.

| Ponto                                                                                                                                                                                                                                         | Onde                                                                                | O que muda para a cliente                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pedidos da Mascavo nunca eram atualizados** depois da primeira gravação. Numa amostra de 200 pedidos de agosto, nenhum tinha o status de hoje: gravados como "em preparação", hoje faturados. Na Amobeleza, 199 de 200 estavam atualizados. | `vtex_orders`, `vtex_order_details` (Mascavo)                                       | O ETL novo atualiza o pedido quando ele muda na VTEX (janela de 45 dias). Pedido cancelado depois de aprovado passa a aparecer como cancelado. Na amostra de agosto isso não aconteceu, mas pode mudar números de períodos recentes. O histórico mais antigo continua como o ETL antigo gravou, a menos que se faça uma recarga. |
| Quantidade de itens do pedido sempre 0 na Mascavo                                                                                                                                                                                             | `vtex_orders.total_items`                                                           | Passa a ter a quantidade real. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                    |
| Descrição, descrição curta, palavras-chave e meta description dos produtos gravadas como "0" na Mascavo                                                                                                                                       | `vtex_products`                                                                     | Passam a ter o texto da VTEX. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                     |
| E-mail do cliente vazio em cerca de metade dos perfis                                                                                                                                                                                         | `vtex_client_profile.email`                                                         | Passa a ter o e-mail que a VTEX manda (um apelido, não o e-mail real). Nenhum relatório conhecido lê.                                                                                                                                                                                                                            |
| Departamento das categorias raiz com o nome da primeira raiz                                                                                                                                                                                  | `vtex_category_tree.department`                                                     | Ponto 8 acima: a confirmar no Power BI da Amobeleza.                                                                                                                                                                                                                                                                             |
| Colunas que o ETL antigo não preenchia: previsão de entrega do pedido e transação ativa                                                                                                                                                       | `vtex_orders.shipping_estimated_date*`, `vtex_order_payment_transactions.is_active` | Passam a ter o valor da VTEX. Nenhum relatório conhecido lê.                                                                                                                                                                                                                                                                     |

**Proposta:** apresentar à cliente antes da virada, principalmente o primeiro item. Se ela quiser o histórico da
Mascavo com o status atualizado, dá para fazer uma recarga dos pedidos antigos (nível 1, sem mudar o Power BI).

## Referências internas

- Mapa do Power BI B2C da Mascavo: `docs/contrato/powerbi-mascavo-b2c.md`
- Convenções gravadas (unidades, datas, chaves): `docs/contrato/convencoes.md`
- Conectores: `docs/conectores/vtex.md`, `docs/conectores/ga4.md`, `docs/conectores/anymarket.md`
