-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", seção 2.5, p. 32) até o schema:pull trazer o
-- SHOW CREATE TABLE real da produção. Índices: as colunas marcadas IDX no dicionário, com nomes no padrão do Laravel.
-- Endereço de entrega (DADO PESSOAL). id = chave técnica da carga; liga no pedido por anymarket_order_id.
CREATE TABLE `anymarket_order_shipping` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `anymarket_order_id` bigint unsigned NOT NULL,
  `city` varchar(255) DEFAULT NULL,
  `state` varchar(255) DEFAULT NULL,
  `country` varchar(255) DEFAULT NULL,
  `country_acronym_normalized` varchar(255) DEFAULT NULL,
  `country_normalized` varchar(255) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `number` varchar(255) DEFAULT NULL,
  `neighborhood` varchar(255) DEFAULT NULL,
  `street` varchar(255) DEFAULT NULL,
  `zip_code` varchar(255) DEFAULT NULL,
  `receiver_name` varchar(255) DEFAULT NULL,
  `promised_shipping_time` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anymarket_order_shipping_anymarket_order_id_index` (`anymarket_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
