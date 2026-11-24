-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `sheets_google_drive_trafego` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `date` date DEFAULT NULL,
  `ga4_property_id` int DEFAULT NULL,
  `session_source` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `session_campaign_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_device_category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_count` int DEFAULT NULL,
  `vehicle_channel_no_pay` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_trafego` (`date`,`ga4_property_id`,`session_source`(100),`session_campaign_name`(100),`platform_device_category`(100),`vehicle_channel_no_pay`(100),`type`(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
