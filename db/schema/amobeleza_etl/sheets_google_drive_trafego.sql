-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `sheets_google_drive_trafego` (
  `date` date DEFAULT NULL,
  `source_medium` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `campaign` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile_device_brand` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sessions` int DEFAULT NULL,
  `bounces` int DEFAULT NULL,
  `new_users` int DEFAULT NULL,
  `pageviews` int DEFAULT NULL,
  `transaction_revenue` decimal(10,2) DEFAULT NULL,
  `transactions` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
