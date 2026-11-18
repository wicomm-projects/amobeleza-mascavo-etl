-- PROVISÓRIO: escrito a partir do dicionário da WPP (docs/contrato/mascavo_etl.md, p. 14–15) até o
-- schema:pull trazer o DDL real da produção (índices, charset, colação). Só estrutura, sem dado.
CREATE TABLE `vtex_order_items` (
	`order_id` varchar(255) NOT NULL,
	`uniqueid` varchar(255) NOT NULL,
	`id` int NOT NULL,
	`productid` int NOT NULL,
	`ean` varchar(255) DEFAULT NULL,
	-- Relaxada para NULL (dicionário diz NOT NULL; a VTEX pode mandar nulo). Confirmar no schema:pull.
	`lockid` varchar(255) DEFAULT NULL,
	`quantity` int NOT NULL,
	`seller` int NOT NULL,
	`name` varchar(255) NOT NULL,
	-- Relaxada para NULL (dicionário diz NOT NULL; a VTEX pode mandar nulo). Confirmar no schema:pull. SKU sem código de referência.
	`refid` varchar(255) DEFAULT NULL,
	`price` decimal(10,2) NOT NULL,
	`listprice` decimal(10,2) NOT NULL,
	`manualprice` int DEFAULT NULL,
	`imageurl` varchar(255) DEFAULT NULL,
	`detailurl` varchar(255) DEFAULT NULL,
	`sellersku` varchar(255) NOT NULL,
	`commission` int NOT NULL,
	`tax` int NOT NULL,
	`presaledate` datetime DEFAULT NULL,
	`additionalinfo` json NOT NULL,
	`measurementunit` varchar(10) NOT NULL,
	`unitmultiplier` decimal(8,4) NOT NULL,
	`sellingprice` decimal(10,2) NOT NULL,
	`isgift` tinyint(1) NOT NULL,
	`shippingprice` decimal(10,2) DEFAULT NULL,
	`rewardvalue` int NOT NULL,
	`freightcommission` int NOT NULL,
	-- Relaxada para NULL (dicionário diz NOT NULL; a VTEX pode mandar nulo). Confirmar no schema:pull.
	`taxcode` varchar(255) DEFAULT NULL,
	-- Relaxada para NULL (dicionário diz NOT NULL; a VTEX pode mandar nulo). Confirmar no schema:pull.
	`costprice` decimal(10,2) DEFAULT NULL,
	`created_at` timestamp NULL DEFAULT NULL,
	`updated_at` timestamp NULL DEFAULT NULL,
	PRIMARY KEY (`uniqueid`),
	KEY `vtex_order_items_order_id_index` (`order_id`),
	KEY `vtex_order_items_id_index` (`id`),
	KEY `vtex_order_items_productid_index` (`productid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
