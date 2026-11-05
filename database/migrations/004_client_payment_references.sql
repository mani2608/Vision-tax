-- Vision-Tax schema v4: payment references linked to a client + Completed filing, manual (QR/UPI) payment claims,
-- notifications and payment history. Requires 001, 002 and 003.
--
-- SAFE TO REVIEW AND RE-RUN: every structural change is guarded by an information_schema check, so applying this file
-- twice (or on a database where part of it already exists) changes nothing the second time. No existing row is
-- modified or deleted; every new column is NULLable, so existing users, filings, documents, payments and the legacy
-- (client-less) payment references keep working unchanged.
-- Apply manually with:  cd server && npm run migrate        (the runner also skips files it has already applied)

-- ---- payment_references: link to client + filing, add Pending / Expired statuses -----------------------------
-- user_id / filing_id stay NULL for references created before this migration (legacy "custom plan" references).
-- ON DELETE RESTRICT: a client or filing that has payment references can never be deleted by accident.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_references' AND COLUMN_NAME = 'user_id') = 0,
  'ALTER TABLE payment_references
     MODIFY COLUMN status ENUM(''open'',''pending'',''paid'',''expired'',''cancelled'') NOT NULL DEFAULT ''open'',
     ADD COLUMN user_id INT UNSIGNED NULL AFTER code,
     ADD COLUMN filing_id INT UNSIGNED NULL AFTER user_id,
     ADD COLUMN paid_payment_id INT UNSIGNED NULL,
     ADD KEY idx_ref_user (user_id, status),
     ADD KEY idx_ref_filing (filing_id, status),
     ADD CONSTRAINT fk_ref_client FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
     ADD CONSTRAINT fk_ref_filing FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE RESTRICT',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- payments: one ledger for Razorpay AND manual QR/UPI payments ---------------------------------------------
-- A manual claim has no Razorpay order, so razorpay_order_id becomes NULLable (the UNIQUE key still allows many NULLs).
--   method        : card / upi / netbanking / ... for Razorpay, 'qr' or 'upi' for manual claims
--   utr           : bank/UPI transaction reference the client submits for a manual payment (unique: no re-use)
--   status        : manual claim -> pending (= submitted, NOT verified) -> successful (admin verified) or failed (rejected)
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'reference_code') = 0,
  'ALTER TABLE payments
     MODIFY COLUMN razorpay_order_id VARCHAR(40) NULL,
     ADD COLUMN reference_code VARCHAR(24) NULL,
     ADD COLUMN user_id INT UNSIGNED NULL,
     ADD COLUMN filing_id INT UNSIGNED NULL,
     ADD COLUMN source ENUM(''razorpay'',''manual'') NOT NULL DEFAULT ''razorpay'',
     ADD COLUMN utr VARCHAR(40) NULL,
     ADD COLUMN reviewed_by INT UNSIGNED NULL,
     ADD COLUMN reviewed_at TIMESTAMP NULL,
     ADD COLUMN review_note VARCHAR(255) NULL,
     ADD UNIQUE KEY uq_pay_utr (utr),
     ADD KEY idx_pay_ref (reference_code),
     ADD KEY idx_pay_user (user_id, created_at),
     ADD CONSTRAINT fk_pay_ref FOREIGN KEY (reference_code) REFERENCES payment_references(code) ON DELETE RESTRICT,
     ADD CONSTRAINT fk_pay_client FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
     ADD CONSTRAINT fk_pay_filing FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE RESTRICT,
     ADD CONSTRAINT fk_pay_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- notifications (admin + client dashboards) ----------------------------------------------------------------
-- audience 'admin' is shared by all administrators; audience 'user' belongs to user_id only.
-- dedupe_key is UNIQUE, so a repeated webhook / retry can never create a second notification for the same event.
CREATE TABLE IF NOT EXISTS notifications (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  audience       ENUM('admin','user') NOT NULL,
  user_id        INT UNSIGNED NULL,
  type           VARCHAR(40)  NOT NULL,
  title          VARCHAR(150) NOT NULL,
  message        VARCHAR(500) NOT NULL,
  data           TEXT NULL,
  payment_id     INT UNSIGNED NULL,
  reference_code VARCHAR(24)  NULL,
  dedupe_key     VARCHAR(100) NOT NULL,
  read_at        TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notif_dedupe (dedupe_key),
  KEY idx_notif_user (audience, user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
