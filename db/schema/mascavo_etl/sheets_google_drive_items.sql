-- Gerado por schema:pull em 2026-11-24. Só estrutura, sem dado.
CREATE TABLE `sheets_google_drive_items` (
  `Date` date NOT NULL,
  `Session_source` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `Item_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `Item_revenue` double NOT NULL,
  `Item_purchase_quantity` int NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`Date`,`Session_source`,`Item_name`,`Item_revenue`,`Item_purchase_quantity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
