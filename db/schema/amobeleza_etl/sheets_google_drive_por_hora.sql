-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", p. 55) até o schema:pull trazer o DDL
-- real. Só estrutura. Sem PK.
CREATE TABLE `sheets_google_drive_por_hora` (
	`date` date DEFAULT NULL,
	`hour` int DEFAULT NULL,
	`transaction_revenue` decimal(10,2) DEFAULT NULL,
	`transactions` int DEFAULT NULL,
	`sessions` int DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
