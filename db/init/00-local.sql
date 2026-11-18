-- Inicialização do MySQL LOCAL (Docker). Roda uma vez, na criação do volume, como root do container.
-- NUNCA rodar este arquivo em outro servidor: ele cria o marcador que libera gravação.

CREATE DATABASE IF NOT EXISTS mascavo_etl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS amobeleza_etl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS etl_local_meta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Marcador do banco local. O writer só grava se encontrar esta linha (src/core/db/target-guard.ts).
CREATE TABLE IF NOT EXISTS etl_local_meta.marker (
  env VARCHAR(32) NOT NULL PRIMARY KEY,
  note VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO etl_local_meta.marker (env, note)
VALUES ('local-dev', 'Docker local do amobeleza-mascavo-etl. Nunca criar em produção.');

-- O usuário do ETL (MYSQL_USER do compose) grava nos dois bancos locais e só LÊ o marcador: o código não consegue
-- criar um marcador por conta própria.
GRANT ALL PRIVILEGES ON mascavo_etl.* TO 'etl_local'@'%';
GRANT ALL PRIVILEGES ON amobeleza_etl.* TO 'etl_local'@'%';
GRANT SELECT ON etl_local_meta.* TO 'etl_local'@'%';
FLUSH PRIVILEGES;
