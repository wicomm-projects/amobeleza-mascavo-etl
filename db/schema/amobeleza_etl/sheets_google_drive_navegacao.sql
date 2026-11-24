-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `sheets_google_drive_navegacao` (
  `date` date DEFAULT NULL,
  `device_category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile_device_brand` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `segment` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sessions` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  KEY `sheets_google_drive_navegacao_device_category_index` (`device_category`),
  KEY `sheets_google_drive_navegacao_mobile_device_brand_index` (`mobile_device_brand`),
  KEY `sheets_google_drive_navegacao_segment_index` (`segment`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
