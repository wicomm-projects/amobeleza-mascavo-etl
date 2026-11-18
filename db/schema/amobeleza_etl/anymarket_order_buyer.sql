-- PROVISÓRIO: escrito a partir do dicionário da WPP ("Documentação Amobeleza", seção 2.5, p. 33–34) até o schema:pull trazer o
-- SHOW CREATE TABLE real da produção. Índices: as colunas marcadas IDX no dicionário, com nomes no padrão do Laravel.
-- Comprador (DADO PESSOAL: nome, e-mail, CPF/CNPJ). id = chave técnica da carga; liga no pedido por anymarket_order_id.
CREATE TABLE `anymarket_order_buyer` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `anymarket_order_id` bigint unsigned NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `document` varchar(255) DEFAULT NULL,
  `document_type` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `anymarket_order_buyer_anymarket_order_id_index` (`anymarket_order_id`),
  KEY `anymarket_order_buyer_document_type_index` (`document_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
