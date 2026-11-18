-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 19) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
CREATE TABLE `vtex_order_payment_gift_cards` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`order_id` varchar(255) NOT NULL,
	`gift_card_id` varchar(255) NOT NULL,
	`redemption_code` varchar(255) DEFAULT NULL,
	`name` varchar(255) DEFAULT NULL,
	`caption` varchar(255) DEFAULT NULL,
	`value` decimal(10,2) DEFAULT NULL,
	`balance` decimal(10,2) DEFAULT NULL,
	`provider` varchar(255) DEFAULT NULL,
	`group_name` varchar(255) DEFAULT NULL,
	`in_use` tinyint(1) DEFAULT NULL,
	`is_special_card` tinyint(1) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_order_payment_gift_cards_order_id_index` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
