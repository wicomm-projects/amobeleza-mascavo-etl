-- Usuário de GRAVAÇÃO do ETL novo nos bancos da cliente (virada para produção).
-- Gerado da lista de tabelas que os jobs gravam (src/core/jobs/registry.ts) em 25/11/2026.
-- Quem roda: o administrador do MySQL da cliente. Antes, troque os dois marcadores:
--   <IP_DA_VPS>  o mesmo IP liberado para o wicomm_leitura
--   <SENHA>      senha gerada na hora (nunca colar em chat, e-mail ou repositório)
-- Só SELECT, INSERT, UPDATE e DELETE, tabela por tabela. Sem CREATE, ALTER, DROP, GRANT OPTION nem privilégio global.
-- Tabelas de fases futuras (metas, mídia, afiliados) ganham GRANT próprio quando o conector existir.

CREATE USER 'wicomm_etl'@'<IP_DA_VPS>' IDENTIFIED BY '<SENHA>' WITH MAX_USER_CONNECTIONS 10;

-- mascavo_etl
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`sheets_google_drive_category` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`sheets_google_drive_items` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`sheets_google_drive_trafego` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`sheets_google_drive_users` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`sheets_google_drive_vendas` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_category_tree` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_client_profile` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_details` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_items` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_logistics_delivery_ids` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_logistics_info` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_payment_gift_cards` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_payment_transactions` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_payment_transactions_payments` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_rates` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_order_shipping_data` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_orders` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_products` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.`vtex_skus_and_products_id` TO 'wicomm_etl'@'<IP_DA_VPS>';

-- amobeleza_etl
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_order_buyer` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_order_items` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_order_payments` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_order_shipping` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_order_tracking` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`anymarket_orders` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`sheets_google_drive_navegacao` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`sheets_google_drive_por_hora` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`sheets_google_drive_trafego` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`sheets_google_drive_transacoes` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_category_tree` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_client_profile` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_details` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_items` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_logistics_delivery_ids` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_logistics_info` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_payment_gift_cards` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_payment_transactions` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_payment_transactions_payments` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_rates` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_order_shipping_data` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_orders` TO 'wicomm_etl'@'<IP_DA_VPS>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `amobeleza_etl`.`vtex_skus_and_products_id` TO 'wicomm_etl'@'<IP_DA_VPS>';

-- Conferência (tem de listar só USAGE e os GRANTs acima):
SHOW GRANTS FOR 'wicomm_etl'@'<IP_DA_VPS>';

-- Para desfazer (remove o usuário e todas as permissões dele):
-- DROP USER 'wicomm_etl'@'<IP_DA_VPS>';
