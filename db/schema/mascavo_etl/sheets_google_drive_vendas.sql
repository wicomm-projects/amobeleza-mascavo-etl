-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Mascavo", p. 32-33) até o schema:pull trazer o DDL
-- real. Só estrutura. Aqui ga4_property_id é varchar (no tráfego é int), como no dicionário.
CREATE TABLE `sheets_google_drive_vendas` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`date` date DEFAULT NULL,
	`ga4_property_id` varchar(255) DEFAULT NULL,
	`source` varchar(255) DEFAULT NULL,
	`event_campaign_name` varchar(255) DEFAULT NULL,
	`platform_device_category` varchar(255) DEFAULT NULL,
	`purchase_revenue` decimal(10,2) DEFAULT NULL,
	`conversions` decimal(10,2) DEFAULT NULL,
	`vehicle_channel_no_pay` varchar(255) DEFAULT NULL,
	`type` varchar(255) DEFAULT NULL,
	`investment` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `sheets_google_drive_vendas_date_index` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
