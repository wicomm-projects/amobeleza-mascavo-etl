-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 23) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
CREATE TABLE `vtex_category_tree` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`name` varchar(255) NOT NULL,
	`department` varchar(255) DEFAULT NULL,
	`has_children` tinyint(1) NOT NULL,
	`url` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`meta_tag_description` varchar(255) NOT NULL,
	`sub_category_id` int DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_category_tree_department_index` (`department`),
	KEY `vtex_category_tree_sub_category_id_index` (`sub_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
