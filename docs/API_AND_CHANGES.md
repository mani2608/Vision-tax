# API reference

All routes are under `/api`, JSON unless noted, session via httpOnly cookie `vt_session`. Errors: `{ "error": "message" }`.
List endpoints accept `page`, `limit` (10/25/50/100), `q` (search), `name` (name search), `sort`, `dir` and return `{ rows, total }`.

| Method & path | Access | Purpose |
|---|---|---|
| POST `/auth/register` | public (rate-limited) | `{firstName,lastName,email,countryCode,phone,password}` |
| POST `/auth/login` | public (rate-limited) | `{email,password,remember}` → sets cookie, returns `{user}` |
| POST `/auth/logout` | any | revokes token, clears cookie |
| GET `/auth/me` | signed in | current user |
| POST `/auth/change-password` | signed in | `{currentPassword,newPassword}`; clears forced-change flag |
| GET `/user/summary` | user | `{downloads,uploads,drafts,finals}` |
| GET `/user/forms` | user | own uploaded files (Tax Information Form page) |
| GET `/user/filings` | user | own filings + upload files |
| POST `/user/filings` | user | multipart: `name,type,year,contact`, `files[]` |
| GET `/user/drafts` | user | own filings that have draft files |
| GET `/user/finals` | user | own **completed** filings with final files |
| GET `/admin/summary` | admin | `{pending,inProgress,completed}` |
| GET `/admin/filings?group=pending\|ongoing\|completed` | admin | filings with all files |
| GET `/admin/filings/:id/history` | admin | status history |
| POST `/admin/filings/:id/draft` | admin | multipart `files[]`; status → `drafted` |
| POST `/admin/filings/:id/final` | admin | multipart `files[]` |
| PATCH `/admin/filings/:id/status` | admin | `{status,note?}`; `completed` needs a final file, `drafted` needs a draft |
| GET `/admin/users` | admin | users (no password data) |
| GET `/files/:id/download` | owner (released files) or admin | attachment download; 404 for anything else |

# Change log for existing files

The original folder is unchanged in `vision-tax2-original/`. The working copy lives in `client/public/`.

| File (working copy) | Change | Reason | Visual impact | Verify |
|---|---|---|---|---|
| `client/public/signin.html` | Submit handler now POSTs to `/api/auth/login` and redirects by role; failure re-enables the button | Original only faked sign-in with a timer + alert | None (markup and CSS untouched) | Sign in as user, admin, bad password |
| `client/public/signup.html` | Submit handler now POSTs to `/api/auth/register` (`async`); failure re-enables the button | Original only faked registration | None | Register, duplicate email/phone |
| all other pages, `assets/` | none (byte-identical copies) | – | – | `diff -r vision-tax2-original/assets client/public/assets` |
| `tax-calculator.zip` | not copied | old snapshot, not referenced by any page | – | – |

Not yet done: no `login.html`/`register.html` change (they redirect to the files above); no email delivery for "Forgot password"
(the original shows only an alert).
