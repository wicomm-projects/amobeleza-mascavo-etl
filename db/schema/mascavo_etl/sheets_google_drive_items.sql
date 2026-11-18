-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Mascavo", p. 34-35) até o schema:pull trazer o DDL
-- real. Só estrutura. Sem id; a PK são as cinco colunas.
-- Charset utf8mb3 só aqui: com utf8mb4, três varchar(255) na PK passam do limite de 3072 bytes do InnoDB (dão 3075). A
-- tabela real deve ser utf8/utf8mb3 ou ter colunas menores; o schema:pull confirma.
CREATE TABLE `sheets_google_drive_items` (
	`Date` date NOT NULL,
	`Session_source` varchar(255) NOT NULL,
	`Item_name` varchar(255) NOT NULL,
	`Item_revenue` double NOT NULL,
	`Item_purchase_quantity` int NOT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`Date`, `Session_source`, `Item_name`, `Item_revenue`, `Item_purchase_quantity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
