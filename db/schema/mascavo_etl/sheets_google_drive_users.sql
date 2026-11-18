-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Mascavo", p. 36) até o schema:pull trazer o DDL
-- real. Só estrutura. Grafia original com maiúsculas; PK composta; carimbos em datetime (não timestamp).
CREATE TABLE `sheets_google_drive_users` (
	`Date` date NOT NULL,
	`Session_source` varchar(255) NOT NULL,
	`First_time_purchasers` int NOT NULL,
	`New_users` int NOT NULL,
	`created_at` datetime DEFAULT NULL,
	`updated_at` datetime DEFAULT NULL,
	PRIMARY KEY (`Date`, `Session_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
