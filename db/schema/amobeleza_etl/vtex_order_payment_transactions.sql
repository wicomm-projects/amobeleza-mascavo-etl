-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 17) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
CREATE TABLE `vtex_order_payment_transactions` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`order_id` varchar(255) NOT NULL,
	`is_active` tinyint(1) DEFAULT NULL,
	`transaction_id` varchar(255) DEFAULT NULL,
	`merchant_name` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_order_payment_transactions_order_id_index` (`order_id`),
	KEY `vtex_order_payment_transactions_is_active_index` (`is_active`),
	KEY `vtex_order_payment_transactions_transaction_id_index` (`transaction_id`),
	KEY `vtex_order_payment_transactions_merchant_name_index` (`merchant_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
