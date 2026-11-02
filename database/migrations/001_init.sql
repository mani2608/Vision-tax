-- Vision-Tax schema v1 (MySQL 8, InnoDB, utf8mb4)

CREATE TABLE IF NOT EXISTS users (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  first_name           VARCHAR(80)  NOT NULL,
  last_name            VARCHAR(80)  NOT NULL DEFAULT '',
  email                VARCHAR(190) NOT NULL,
  phone                VARCHAR(24)  NOT NULL,
  password_hash        VARCHAR(100) NOT NULL,
  role                 ENUM('user','admin') NOT NULL DEFAULT 'user',
  status               ENUM('active','disabled') NOT NULL DEFAULT 'active',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role_created (role, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS filings (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  name         VARCHAR(150) NOT NULL,
  type         VARCHAR(30)  NOT NULL,
  filing_year  SMALLINT UNSIGNED NOT NULL,
  contact      VARCHAR(30)  NOT NULL,
  status       ENUM('pending','ongoing','drafted','completed') NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_filings_user (user_id, submitted_at),
  KEY idx_filings_status (status, submitted_at),
  CONSTRAINT fk_filings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Metadata only; bytes live in the private upload directory under stored_name.
CREATE TABLE IF NOT EXISTS filing_files (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filing_id     INT UNSIGNED NOT NULL,
  kind          ENUM('upload','draft','final') NOT NULL,
  stored_name   VARCHAR(80)  NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  uploaded_by   INT UNSIGNED NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_stored (stored_name),
  KEY idx_files_filing_kind (filing_id, kind),
  CONSTRAINT fk_files_filing   FOREIGN KEY (filing_id)   REFERENCES filings(id) ON DELETE CASCADE,
  CONSTRAINT fk_files_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS filing_status_history (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filing_id   INT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status   VARCHAR(20) NOT NULL,
  changed_by  INT UNSIGNED NOT NULL,
  note        VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hist_filing (filing_id, created_at),
  CONSTRAINT fk_hist_filing FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_actor  FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS file_downloads (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  file_id    INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dl_user (user_id),
  CONSTRAINT fk_dl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_file FOREIGN KEY (file_id) REFERENCES filing_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Logout revokes the token id until it would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        CHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (jti),
  KEY idx_revoked_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Never store passwords or tokens in details.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    INT UNSIGNED NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(30) NULL,
  entity_id   INT UNSIGNED NULL,
  details     VARCHAR(500) NULL,
  ip          VARCHAR(45) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
