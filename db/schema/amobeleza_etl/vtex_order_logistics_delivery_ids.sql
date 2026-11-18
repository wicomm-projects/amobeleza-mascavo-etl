-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 16) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
CREATE TABLE `vtex_order_logistics_delivery_ids` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`order_id` varchar(255) NOT NULL,
	`item_index` int NOT NULL,
	`courier_id` varchar(255) DEFAULT NULL,
	`courier_name` varchar(255) DEFAULT NULL,
	`dock_id` varchar(255) DEFAULT NULL,
	`quantity` int DEFAULT NULL,
	`warehouse_id` varchar(255) DEFAULT NULL,
	`account_carrier_name` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_order_logistics_delivery_ids_order_id_index` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
