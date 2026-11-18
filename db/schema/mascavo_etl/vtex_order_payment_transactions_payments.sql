-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 18) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
-- `group` é palavra reservada: sempre entre crases.
CREATE TABLE `vtex_order_payment_transactions_payments` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`order_id` varchar(255) NOT NULL,
	`transaction_id` varchar(255) NOT NULL,
	`payment_id` varchar(255) NOT NULL,
	`payment_system` varchar(255) NOT NULL,
	`payment_system_name` varchar(255) NOT NULL,
	`value` decimal(10,2) DEFAULT NULL,
	`installments` int DEFAULT NULL,
	`reference_value` decimal(10,2) DEFAULT NULL,
	`redemption_code` varchar(255) DEFAULT NULL,
	`gift_card_id` varchar(255) DEFAULT NULL,
	`gift_card_name` varchar(255) DEFAULT NULL,
	`gift_card_caption` varchar(255) DEFAULT NULL,
	`gift_card_as_discount` tinyint(1) DEFAULT NULL,
	`gift_card_provider` varchar(255) DEFAULT NULL,
	`group` varchar(255) DEFAULT NULL,
	`tid` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_order_payment_transactions_payments_order_id_index` (`order_id`),
	KEY `vtex_order_payment_transactions_payments_transaction_id_index` (`transaction_id`),
	KEY `vtex_order_payment_transactions_payments_payment_id_index` (`payment_id`),
	KEY `vtex_order_payment_transactions_payments_payment_system_index` (`payment_system`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
