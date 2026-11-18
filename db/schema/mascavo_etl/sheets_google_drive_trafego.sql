-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Mascavo", p. 31-32) até o schema:pull trazer o DDL
-- real (índices, charset, collation). Só estrutura. Convenções do Laravel: id bigint unsigned, nome dos índices.
CREATE TABLE `sheets_google_drive_trafego` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`date` date DEFAULT NULL,
	`ga4_property_id` int DEFAULT NULL,
	`session_source` varchar(255) DEFAULT NULL,
	`session_campaign_name` varchar(255) DEFAULT NULL,
	`platform_device_category` varchar(255) DEFAULT NULL,
	`event_count` int DEFAULT NULL,
	`vehicle_channel_no_pay` varchar(255) DEFAULT NULL,
	`type` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `sheets_google_drive_trafego_date_index` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
