-- Vision-Tax schema v3: admin-created payment references for custom / invoice payments.
-- Adds ONE new table. No existing table, column or row is altered or removed. Requires 001 and 002.
-- Review, then apply manually with:  cd server && npm run migrate   (already-applied files are skipped)
--
-- Why: the public "Pay Now" form must never let a visitor choose their own amount. Fixed plans use the server-side
-- price list (server/src/plans.js). The "Other / Custom" plan can only be paid with a reference code that an
-- administrator created here, which fixes the amount on the server.
CREATE TABLE IF NOT EXISTS payment_references (
  code              VARCHAR(24)  NOT NULL,
  amount_paise      INT UNSIGNED NOT NULL,
  note              VARCHAR(190) NULL,
  status            ENUM('open','paid','cancelled') NOT NULL DEFAULT 'open',
  expires_at        DATETIME NULL,
  razorpay_order_id VARCHAR(40) NULL,
  paid_at           TIMESTAMP NULL,
  created_by        INT UNSIGNED NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  KEY idx_ref_status (status, created_at),
  KEY idx_ref_order (razorpay_order_id),
  CONSTRAINT fk_ref_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
