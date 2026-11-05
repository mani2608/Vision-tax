-- Vision-Tax schema v2: site settings (QR code / UPI ID) and Razorpay payments.
-- Adds NEW tables only. No existing table, column or row is altered or removed.
-- Review, then apply with:  cd server && npm run migrate   (already-applied files are skipped)

-- Key/value settings managed from the admin dashboard.
--   qr_file : stored file name of the active payment QR image (bytes live in the private upload directory)
--   qr_mime : its content type
--   upi_id  : the active UPI ID shown under the QR code on the homepage
-- A missing key means "not configured" and the homepage shows an empty state.
CREATE TABLE IF NOT EXISTS site_settings (
  setting_key   VARCHAR(50)  NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_by    INT UNSIGNED NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per Razorpay order. Amounts are stored in paise (INR minor units) as integers.
-- Never stores card numbers, CVV or any other sensitive payment credential.
CREATE TABLE IF NOT EXISTS payments (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan                 VARCHAR(40)  NOT NULL,
  amount_paise         INT UNSIGNED NOT NULL,
  currency             CHAR(3)      NOT NULL DEFAULT 'INR',
  payer_name           VARCHAR(100) NOT NULL,
  payer_email          VARCHAR(190) NOT NULL,
  payer_phone          VARCHAR(24)  NOT NULL,
  razorpay_order_id    VARCHAR(40)  NOT NULL,
  razorpay_payment_id  VARCHAR(40)  NULL,
  method               VARCHAR(30)  NULL,
  status               ENUM('created','pending','successful','failed','cancelled','refunded') NOT NULL DEFAULT 'created',
  verified_at          TIMESTAMP NULL,
  failure_reason       VARCHAR(255) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_order (razorpay_order_id),
  UNIQUE KEY uq_pay_payment (razorpay_payment_id),
  KEY idx_pay_status (status, created_at),
  KEY idx_pay_email (payer_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Razorpay retries webhooks; remembering each event id makes repeated deliveries harmless.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  event_id    VARCHAR(100) NOT NULL,
  event_type  VARCHAR(60)  NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
