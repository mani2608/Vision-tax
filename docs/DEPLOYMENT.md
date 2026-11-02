# Deployment guide

Architecture to deploy: **Next.js client (port 3000)** → proxies `/api/*` → **Express API (port 4000)** → **MySQL 8**, plus a private
**uploads directory**. The public website (`client/public/*.html`) is served by the same Next.js process.

> Your current live site (`vision-tax.com/admin/*.php`) is PHP. This app needs **Node 20+ and MySQL 8**, so it cannot run on
> PHP-only shared hosting. Use a VPS or a managed Node platform (options below).

---

## 0. Before you deploy — mandatory clean-up

| Item | Why |
|---|---|
| `server/.env` contains real values | Never upload or commit it. Create a fresh one on the server. |
| `server/storage/*.pdf` | These are test uploads from development. Do **not** ship them; production starts with an empty directory. |
| Seeded admin `admin@gmail.com / admin@1234` | A weak, publicly-guessable bootstrap. Use a real `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` for the first seed; the app forces a change at first login. |
| `.gitignore` | Confirm `.env`, `node_modules`, `.next`, `storage/` are ignored. |
| `JWT_SECRET` | Generate new: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |

---

## 1. Hosting options

| Option | Cost | Effort | Pick when |
|---|---|---|---|
| **A. Single VPS (Ubuntu) — recommended** | ~$6–12/mo (DigitalOcean, Hetzner, Lightsail, Vultr) | medium | You want everything in one place and full control; uploads stay on local disk |
| B. Managed PaaS (Render / Railway) + managed MySQL | ~$20–40/mo | low | You want zero server admin. Uploads need a persistent disk or move to S3 |
| C. Vercel (client) + VPS/PaaS (API) | varies | medium | Not advised here — you would lose the same-origin cookie proxy simplicity |

The rest of this guide is **Option A** on Ubuntu 22.04/24.04.

---

## 2. Server setup (Option A)

```bash
# as root, once
adduser deploy && usermod -aG sudo deploy
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable

# Node 20, Nginx, MySQL, Certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx mysql-server certbot python3-certbot-nginx
npm i -g pm2
```

### MySQL

```sql
-- sudo mysql
CREATE DATABASE vision_tax CHARACTER SET utf8mb4;
CREATE USER 'vt_app'@'localhost' IDENTIFIED BY 'LONG-RANDOM-PASSWORD';
GRANT ALL ON vision_tax.* TO 'vt_app'@'localhost';
```
MySQL listens on localhost only (default) — do not open port 3306.

### Application

```bash
sudo -u deploy -i
git clone <your-repo> /srv/vision-tax && cd /srv/vision-tax

# API
cd server && npm ci --omit=dev
mkdir -p /srv/vision-tax-uploads && chmod 700 /srv/vision-tax-uploads   # outside the code dir
cp .env.example .env && nano .env
```

`server/.env` (production)

```
PORT=4000
NODE_ENV=production                       # enables Secure cookies
CLIENT_ORIGIN=https://vision-tax.com      # EXACT browser origin, no trailing slash (CSRF check)
DB_HOST=127.0.0.1
DB_USER=vt_app
DB_PASSWORD=LONG-RANDOM-PASSWORD
DB_NAME=vision_tax
JWT_SECRET=<48-byte hex>
UPLOAD_DIR=/srv/vision-tax-uploads
ADMIN_EMAIL=you@yourdomain.com           # first admin only
ADMIN_PASSWORD=<strong temporary password>
```

```bash
npm run migrate && npm run seed          # then DELETE ADMIN_PASSWORD from .env
pm2 start src/index.js --name vt-api

# Client — API_ORIGIN is read at BUILD time (next.config rewrites)
cd ../client && npm ci
API_ORIGIN=http://127.0.0.1:4000 npm run build
pm2 start npm --name vt-web -- start     # serves on :3000
pm2 save && pm2 startup                  # restart on reboot
```

> If you change `API_ORIGIN`, you must **rebuild** the client.

### Nginx + HTTPS

`/etc/nginx/sites-available/vision-tax`

```nginx
server {
  server_name vision-tax.com www.vision-tax.com;
  client_max_body_size 110m;             # 10 files × 10 MB uploads (+ overhead)

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
ln -s /etc/nginx/sites-available/vision-tax /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d vision-tax.com -d www.vision-tax.com   # free TLS + auto-renew
```

Only Nginx faces the internet; ports 3000/4000 stay bound to localhost (the firewall above already blocks them).

---

## 3. Moving from the current PHP site

1. Keep the PHP site live while you test the new one on a staging subdomain (`staging.vision-tax.com`, its own
   `CLIENT_ORIGIN`).
2. **Existing data**: the PHP database is a different schema. Export users and filings and write a one-off import script
   mapping to `users` / `filings` / `filing_files`. Users' old password hashes will not match bcrypt cost‑12 — plan a
   "set your password" / reset flow for imported accounts, and copy old uploaded files into `UPLOAD_DIR` with rows in
   `filing_files`.
3. Cut over DNS (lower TTL a day earlier), then keep the PHP server for a week as a rollback.
4. Old links such as `/admin/pending_filing.php` should 301 to `/admin/pending` (Nginx `rewrite` rules).

---

## 4. Backups and monitoring

| What | How |
|---|---|
| Database | Nightly `mysqldump --single-transaction vision_tax \| gzip` via cron → copy off-server (S3/Backblaze) |
| Uploads | `rsync`/`restic` of `/srv/vision-tax-uploads` nightly, off-server |
| Restore drill | Test a restore to staging once, before launch |
| Process health | `pm2 monit`, `pm2 logs`; uptime check on `https://vision-tax.com/api/health` (UptimeRobot, free) |
| Logs | `pm2 install pm2-logrotate` |
| OS updates | `unattended-upgrades` enabled |

---

## 5. Updating the app

```bash
cd /srv/vision-tax && git pull
cd server && npm ci --omit=dev && npm run migrate && pm2 restart vt-api
cd ../client && npm ci && API_ORIGIN=http://127.0.0.1:4000 npm run build && pm2 restart vt-web
```

## 6. Go-live checklist

- [ ] `NODE_ENV=production`, HTTPS on, `CLIENT_ORIGIN` exactly matches the site URL
- [ ] Fresh `JWT_SECRET`; strong admin password changed at first login; test admin account removed
- [ ] `.env` readable only by the deploy user (`chmod 600`)
- [ ] Uploads dir outside web root, `chmod 700`, backed up
- [ ] Sign up → upload → admin draft → admin final → user download tested end to end on production
- [ ] Wrong role cannot open the other portal (`/admin` as a user, and vice versa)
- [ ] Back-button after logout does not show portal pages
- [ ] Backups run and a restore was tested
- [ ] Uptime monitor on `/api/health`
- [ ] Privacy policy, terms and refund policy pages published (needed before taking payments)
- [ ] Payment gateway: see [PAYMENT_GATEWAY.md](PAYMENT_GATEWAY.md) — go live only after test-mode checks pass
- [ ] Consider: email delivery (SMTP/SES) for password reset and "your draft is ready" notices; malware scanning of uploads (ClamAV)

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login works, then immediately signed out | `NODE_ENV=production` without HTTPS (Secure cookie dropped), or Nginx missing `X-Forwarded-Proto` |
| `Cross-origin request blocked` on any POST | `CLIENT_ORIGIN` ≠ the browser's origin (http vs https, www vs apex) |
| `413 Request Entity Too Large` on upload | Nginx `client_max_body_size` too small |
| All `/api/*` calls 404/500 | Client was built with wrong `API_ORIGIN` — rebuild |
| Uploads vanish after redeploy | `UPLOAD_DIR` points inside the code directory that gets replaced |
