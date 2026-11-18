-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 19) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
-- Sem PK no dicionário (ratesAndBenefitsData).
CREATE TABLE `vtex_order_rates` (
	`order_id` varchar(255) NOT NULL,
	`featured` tinyint(1) NOT NULL,
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	KEY `vtex_order_rates_order_id_index` (`order_id`),
	KEY `vtex_order_rates_id_index` (`id`),
	KEY `vtex_order_rates_name_index` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
