-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 17) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
-- Sem PK no dicionário.
CREATE TABLE `vtex_order_shipping_data` (
	`order_id` varchar(255) NOT NULL,
	`address_id` varchar(255) NOT NULL,
	`address_type` varchar(255) DEFAULT NULL,
	`neighborhood` varchar(255) DEFAULT NULL,
	`postal_code` varchar(255) DEFAULT NULL,
	`city` varchar(255) DEFAULT NULL,
	`state` varchar(255) DEFAULT NULL,
	`country` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	KEY `vtex_order_shipping_data_order_id_index` (`order_id`),
	KEY `vtex_order_shipping_data_address_type_index` (`address_type`),
	KEY `vtex_order_shipping_data_neighborhood_index` (`neighborhood`),
	KEY `vtex_order_shipping_data_postal_code_index` (`postal_code`),
	KEY `vtex_order_shipping_data_city_index` (`city`),
	KEY `vtex_order_shipping_data_state_index` (`state`),
	KEY `vtex_order_shipping_data_country_index` (`country`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
