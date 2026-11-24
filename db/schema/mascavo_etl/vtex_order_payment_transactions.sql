-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `vtex_order_payment_transactions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `transaction_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `merchant_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `vtex_order_payment_transactions_order_id_index` (`order_id`),
  KEY `vtex_order_payment_transactions_is_active_index` (`is_active`),
  KEY `vtex_order_payment_transactions_transaction_id_index` (`transaction_id`),
  KEY `vtex_order_payment_transactions_merchant_name_index` (`merchant_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
