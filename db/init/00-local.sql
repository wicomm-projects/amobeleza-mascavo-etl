-- Inicialização do MySQL LOCAL (Docker). Roda uma vez, na criação do volume, como root do container.
-- NUNCA rodar este arquivo em outro servidor: ele cria o marcador que libera gravação.

-- Trava: só segue no container do docker-compose (hostname fixo). Em qualquer outro servidor, o subselect devolve duas
-- linhas, o MySQL dá erro e o cliente mysql aborta o script aqui, antes de criar qualquer coisa.
DO IF(@@hostname = 'amo-etl-mysql-local', 0, (SELECT 1 UNION ALL SELECT 2));

CREATE DATABASE IF NOT EXISTS mascavo_etl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS amobeleza_etl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS etl_local_meta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- O usuário do ETL (MYSQL_USER do compose) grava nos dois bancos locais e só LÊ o marcador: o código não consegue
-- criar um marcador por conta própria. Os GRANTs vêm antes do marcador: se o usuário não existir (outro servidor), o
-- script para aqui e o marcador nunca é criado.
GRANT ALL PRIVILEGES ON mascavo_etl.* TO 'etl_local'@'%';
GRANT ALL PRIVILEGES ON amobeleza_etl.* TO 'etl_local'@'%';
GRANT SELECT ON etl_local_meta.* TO 'etl_local'@'%';
FLUSH PRIVILEGES;

-- Marcador do banco local, por último. O writer só grava se encontrar esta linha (src/core/db/target-guard.ts).
CREATE TABLE IF NOT EXISTS etl_local_meta.marker (
  env VARCHAR(32) NOT NULL PRIMARY KEY,
  note VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO etl_local_meta.marker (env, note)
VALUES ('local-dev', 'Docker local do amobeleza-mascavo-etl. Nunca criar em produção.');
