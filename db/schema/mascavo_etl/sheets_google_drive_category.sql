-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `sheets_google_drive_category` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `Item_category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '(not set)',
  `Item_category_2` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '(not set)',
  `Item_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_cat_cat2_name` (((`Item_category` collate utf8mb4_0900_as_cs)),((`Item_category_2` collate utf8mb4_0900_as_cs)),((`Item_name` collate utf8mb4_0900_as_cs)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
