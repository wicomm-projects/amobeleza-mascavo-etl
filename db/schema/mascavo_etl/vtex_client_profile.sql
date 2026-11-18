-- PROVISÓRIO: escrito a partir do dicionário da WPP (doc da Mascavo da WPP, seção vtex_client_profile (colunas ainda fora de docs/contrato/mascavo_etl.md)) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
-- Perfil do cliente dos pedidos (clientProfileData, dado pessoal, mascarado pela VTEX). id = userProfileId.
CREATE TABLE `vtex_client_profile` (
	`id` varchar(255) NOT NULL,
	`type` varchar(10) NOT NULL,
	`first_name` varchar(255) DEFAULT NULL,
	`last_name` varchar(255) DEFAULT NULL,
	`document` varchar(255) DEFAULT NULL,
	`home_phone` varchar(255) DEFAULT NULL,
	`email` varchar(255) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
