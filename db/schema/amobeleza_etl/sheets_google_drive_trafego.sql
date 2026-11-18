-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", p. 53-54) até o schema:pull trazer o
-- DDL real. Só estrutura. Diferente da Mascavo: colunas da era Universal Analytics, sem id e sem chave no dicionário.
CREATE TABLE `sheets_google_drive_trafego` (
	`date` date DEFAULT NULL,
	`source_medium` varchar(255) DEFAULT NULL,
	`campaign` varchar(255) DEFAULT NULL,
	`device_category` varchar(255) DEFAULT NULL,
	`mobile_device_brand` varchar(255) DEFAULT NULL,
	`sessions` int DEFAULT NULL,
	`bounces` int DEFAULT NULL,
	`new_users` int DEFAULT NULL,
	`pageviews` int DEFAULT NULL,
	`transaction_revenue` decimal(10,2) DEFAULT NULL,
	`transactions` int DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
