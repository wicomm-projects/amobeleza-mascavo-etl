-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", p. 54) até o schema:pull trazer o DDL
-- real. Só estrutura. Sem PK; índices nas colunas marcadas IDX.
CREATE TABLE `sheets_google_drive_navegacao` (
	`date` date DEFAULT NULL,
	`device_category` varchar(255) DEFAULT NULL,
	`mobile_device_brand` varchar(255) DEFAULT NULL,
	`segment` varchar(255) DEFAULT NULL,
	`sessions` int DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	KEY `sheets_google_drive_navegacao_device_category_index` (`device_category`),
	KEY `sheets_google_drive_navegacao_mobile_device_brand_index` (`mobile_device_brand`),
	KEY `sheets_google_drive_navegacao_segment_index` (`segment`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
