-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `anymarket_order_tracking` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `anymarket_order_id` bigint unsigned NOT NULL,
  `url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `number` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carrier` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date` datetime DEFAULT NULL,
  `estimate_date` datetime DEFAULT NULL,
  `shipped_date` datetime DEFAULT NULL,
  `delivered_date` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anymarket_order_tracking_carrier_index` (`carrier`),
  KEY `idx_any_track_number` (`number`),
  KEY `idx_anymarket_tracking_order` (`anymarket_order_id`),
  KEY `idx_aot_order_id` (`anymarket_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
