-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", p. 54) até o schema:pull trazer o DDL
-- real. Só estrutura. Sem id no dicionário da Amobeleza (o da Mascavo tem); índices nas colunas marcadas IDX.
CREATE TABLE `sheets_google_drive_transacoes` (
	`date` date DEFAULT NULL,
	`transaction_id` varchar(255) DEFAULT NULL,
	`source_medium` varchar(255) DEFAULT NULL,
	`campaign` varchar(255) DEFAULT NULL,
	`device_category` varchar(255) DEFAULT NULL,
	`mobile_device_brand` varchar(255) DEFAULT NULL,
	`transactions` int DEFAULT NULL,
	`transaction_revenue` decimal(10,2) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	KEY `sheets_google_drive_transacoes_source_medium_index` (`source_medium`),
	KEY `sheets_google_drive_transacoes_campaign_index` (`campaign`),
	KEY `sheets_google_drive_transacoes_device_category_index` (`device_category`),
	KEY `sheets_google_drive_transacoes_mobile_device_brand_index` (`mobile_device_brand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
