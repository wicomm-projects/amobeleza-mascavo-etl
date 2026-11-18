-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Mascavo", p. 35) até o schema:pull trazer o DDL
-- real. Só estrutura. Carimbos em datetime NOT NULL (o writer preenche).
CREATE TABLE `sheets_google_drive_category` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`Item_category` varchar(255) NOT NULL,
	`Item_category_2` varchar(255) NOT NULL,
	`Item_name` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
