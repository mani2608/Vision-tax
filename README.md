# Vision-Tax – full-stack tax filing portal

Next.js (client) + Express (server) + MySQL (database). The approved marketing site is preserved untouched.

```
vision-tax-project/
  vision-tax2-original/   untouched copy of the supplied folder (compare / restore from here)
  client/                 Next.js app: marketing site (public/) + user & admin dashboards (src/app)
  server/                 Express REST API (/api/*), auth, uploads, authorised downloads
  database/migrations/    versioned MySQL schema
  docs/                   API reference, audit and change log
```

## Run locally

Requirements: Node 20+, MySQL 8.

1. **Configure the API**: `cd server && cp .env.example .env`, then fill in `DB_USER`, `DB_PASSWORD`,
   `JWT_SECRET` (32+ random chars) and, for the first admin only, `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Create the schema and admin**: `npm install && npm run migrate && npm run seed`
3. **Start the API** (port 4000): `npm run dev`
4. **Start the client** (port 3000): `cd ../client && npm install && npm run dev`
5. Open http://localhost:3000

`client/next.config.mjs` proxies `/api/*` to `API_ORIGIN` (default `http://localhost:4000`), so the session
cookie is same-origin. `CLIENT_ORIGIN` in `server/.env` must equal the browser origin (CSRF check).

### Accounts
- **Admin**: the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `server/.env` (requested bootstrap: `admin@gmail.com` / `admin@1234`).
  The password is bcrypt-hashed in the DB, never in frontend code, and **a change is forced at first login**.
  Admin and users share `/signin.html`; the role decides where you land (`/admin` or `/dashboard`).
- **Users**: self-register at `/signup.html`.

## Pages
| User | Admin |
|---|---|
| `/dashboard` summary cards | `/admin` pending / in-progress / completed counts |
| `/dashboard/forms` Download Tax Information Form | `/admin/pending` review files, upload draft, start processing |
| `/dashboard/upload` Uploads Filing Documents | `/admin/ongoing` upload final, change status |
| `/dashboard/filings` View My Filings | `/admin/completed` manage final files and status |
| `/dashboard/drafts` Draft Copy | `/admin/users` user list (search, sort, pagination) |
| `/dashboard/finals` Final Copy | |

## Filing lifecycle
`pending` → (admin "Start Processing") `ongoing` → (draft uploaded) `drafted` → (final uploaded + status set) `completed`.
- Uploading a draft moves the filing to `drafted`; users can then download it.
- `completed` is refused unless a final file exists. Users can download final copies only once the filing is `completed`.
- Every transition is stored in `filing_status_history` with actor and time; uploads/logins are in `audit_logs`.

## Security notes
bcrypt (cost 12); JWT in an httpOnly SameSite=Lax cookie; logout revokes the token id server-side; login/register
rate-limited; role + ownership enforced in every API route; uploads validated by extension, MIME and content, stored
outside the web root under random names; every download goes through `/api/files/:id/download`.
Production: set `NODE_ENV=production` (secure cookies), serve over HTTPS, use a private `UPLOAD_DIR`, back up DB + uploads,
and consider malware scanning.

## Defaults I chose (please confirm)
Max 10 MB per file, 10 files per submission (`MAX_FILE_MB`, `MAX_FILES_PER_UPLOAD`); users may submit several filings per
year/type; no reject/comment workflow; open self-registration; "Tax Information Form" lists the user's own uploaded files;
"Total Uploads" = number of filings, "Total Downloads" = recorded downloads.

See [docs/API_AND_CHANGES.md](docs/API_AND_CHANGES.md).
