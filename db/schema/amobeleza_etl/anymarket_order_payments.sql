-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", seção 2.5, p. 32) até o schema:pull trazer o
-- SHOW CREATE TABLE real da produção. Índices: as colunas marcadas IDX no dicionário, com nomes no padrão do Laravel.
-- Pagamentos do pedido. id = chave técnica da carga; liga no pedido por anymarket_order_id.
CREATE TABLE `anymarket_order_payments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `anymarket_order_id` bigint unsigned NOT NULL,
  `method` varchar(255) DEFAULT NULL,
  `status` varchar(255) DEFAULT NULL,
  `value` decimal(10,2) DEFAULT NULL,
  `market_place_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anymarket_order_payments_anymarket_order_id_index` (`anymarket_order_id`),
  KEY `anymarket_order_payments_method_index` (`method`),
  KEY `anymarket_order_payments_status_index` (`status`),
  KEY `anymarket_order_payments_market_place_id_index` (`market_place_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
