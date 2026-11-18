-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", seção 2.5, p. 33) até o schema:pull trazer o
-- SHOW CREATE TABLE real da produção. Índices: as colunas marcadas IDX no dicionário, com nomes no padrão do Laravel.
-- Rastreio do pedido. id = chave técnica da carga; liga no pedido por anymarket_order_id.
CREATE TABLE `anymarket_order_tracking` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `anymarket_order_id` bigint unsigned NOT NULL,
  `url` varchar(255) DEFAULT NULL,
  `number` varchar(255) DEFAULT NULL,
  `carrier` varchar(255) DEFAULT NULL,
  `date` datetime DEFAULT NULL,
  `estimate_date` datetime DEFAULT NULL,
  `shipped_date` datetime DEFAULT NULL,
  `delivered_date` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anymarket_order_tracking_anymarket_order_id_index` (`anymarket_order_id`),
  KEY `anymarket_order_tracking_number_index` (`number`),
  KEY `anymarket_order_tracking_carrier_index` (`carrier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
