-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 20–21) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
-- id é o ID do produto na VTEX (não é auto incremento).
CREATE TABLE `vtex_products` (
	`id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`department_id` int NOT NULL,
	`category_id` int NOT NULL,
	`brand_id` int NOT NULL,
	`link_id` varchar(255) NOT NULL,
	`ref_id` varchar(255) NOT NULL,
	`is_visible` tinyint(1) NOT NULL,
	`description` varchar(255) DEFAULT NULL,
	`description_short` varchar(255) DEFAULT NULL,
	`release_date` varchar(255) DEFAULT NULL,
	`key_words` varchar(255) DEFAULT NULL,
	`title` varchar(255) DEFAULT NULL,
	`is_active` tinyint(1) NOT NULL,
	`tax_code` varchar(255) DEFAULT NULL,
	`meta_tag_description` varchar(255) DEFAULT NULL,
	`supplier_id` varchar(255) DEFAULT NULL,
	`show_without_stock` varchar(255) DEFAULT NULL,
	`ad_words_remarketing_code` varchar(255) DEFAULT NULL,
	`lomadee_campaign_code` varchar(255) DEFAULT NULL,
	`score` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`),
	KEY `vtex_products_department_id_index` (`department_id`),
	KEY `vtex_products_category_id_index` (`category_id`),
	KEY `vtex_products_brand_id_index` (`brand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
