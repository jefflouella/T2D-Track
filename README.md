# T2D Track

Self-hosted medication and health tracking web app (Release 1: Personal MVP).

## Product promise

1. Know what is due.
2. Record what happened.
3. Trust what remains.
4. Bring a useful summary to a medical visit.

See [Docs/t2d-track-product-plan.md](Docs/t2d-track-product-plan.md) for the full product contract.

## Stack

- Node.js 22+, Express, Prisma, PostgreSQL
- Vanilla HTML/CSS/JS (esbuild bundles Chart.js and the client app)
- Web Push (VAPID), Resend email, PDFKit doctor reports
- One Railway web service + Postgres

## Local setup

### Prerequisites

- Node.js 22+
- Docker (for local Postgres)

### Install

```bash
cp .env.example .env
# Local Postgres (Docker Compose plugin, or plain docker run):
docker compose up -d
# If port 5432 is already in use:
# docker run -d --name t2d-track-pg -e POSTGRES_USER=t2d -e POSTGRES_PASSWORD=t2d \
#   -e POSTGRES_DB=t2d_track -p 5433:5432 postgres:16-alpine
# then set DATABASE_URL=postgresql://t2d:t2d@localhost:5433/t2d_track

npm install
npx prisma migrate dev --name init
npm run build
npm run dev
```

Open http://localhost:3000 (or the `PORT` in `.env`) and register the first user (`REGISTRATION_MODE=first_user_only`).

Generate VAPID keys when you want push reminders:

```bash
npx web-push generate-vapid-keys
```

### Useful commands

```bash
npm run build              # bundle client assets
npm start                  # production-style start
npm test                   # unit tests
RUN_INTEGRATION=1 npm test # also runs DB integration tests
npm run reconcile-stock    # rebuild stock caches from the ledger
npx prisma migrate deploy  # apply migrations (CI / Railway)
```

### Environment variables

Copy from `.env.example`. Important keys:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Cookie/session HMAC secret (16+ chars) |
| `APP_URL` | Public origin, e.g. `https://t2d.example.com` |
| `RESEND_API_KEY` / `FROM_EMAIL` | Transactional email (optional locally) |
| `VAPID_*` | Web Push keys (`npx web-push generate-vapid-keys`) |
| `REGISTRATION_MODE` | `first_user_only` (default), `invite_only`, or `open` |
| `SCHEDULER_*` | In-process reminder loop settings |

Without Resend or VAPID keys, the app still runs; emails and push are logged/skipped.

## Releases

- **Release 1:** Personal MVP (Today, meds, stock, health, reports, push)
- **Release 1.1:** Household, invitations, multi-profile, caregiver missed-dose alerts
- **Release 1.2:** Drug catalog seed/import, supplies, labs, wallet card, interval schedules, holds, refill workflow, BS CSV import, symptoms, offline write queue, TOTP
- **Release 1.3:** Daily wellness notes (mood check-in + journal), supplements as scheduled intakes alongside medications

### Drug catalog

```bash
npm run catalog:seed                 # ships a T2D-focused starter catalog (v2)
npm run catalog:import -- ./RxTerms.csv   # optional full RxTerms-style import
```

On Add medication, type a name to search the local catalog (no external API calls). Brand names like Mounjaro, Synjardy, and Crestor are included as synonyms. If a drug is missing, free-text entry still works; re-run `npm run catalog:seed` after pulling catalog updates, or import a full RxTerms file for broader coverage.


- **Today:** due / upcoming / overdue / completed / skipped dose events; daily how-I-feel check-in
- **Medications:** schedules, inventory ledger, refill, manual count, waste
- **Supplements:** same scheduling and stock as meds, without pharmacy fields
- **Notes:** mood check-ins, feeling tags, journal history
- **Health:** blood sugar, weight, blood pressure, A1C, personal targets
- **Reports:** on-demand PDF / CSV / JSON for visit ranges
- **Settings:** units, timezone, push devices, test reminder, export/delete

## Deploy on Railway

1. Create a Railway project with one web service and one Postgres plugin.
2. Set the environment variables above (`DATABASE_URL` from the plugin).
3. Build command: `npm install && npx prisma generate && npm run build`
4. Deploy / release command: `npx prisma migrate deploy && npm start`
5. Keep **one** web replica so the in-process scheduler stays simple.
6. Enable Postgres backups or PITR; follow [Docs/ops-backup-restore.md](Docs/ops-backup-restore.md).
7. Point a custom domain at the service and verify HTTPS, manifest, and push.

`railway.toml` in this repo documents the suggested start command.

## Security notes

- Sessions are HttpOnly cookies stored as hashes in Postgres.
- CSRF protection is required on state-changing API routes.
- Profile access is checked on the server for every resource.
- Health values and secrets are redacted from structured logs.
- The app does not give clinical advice or interpret readings as dangerous.

## Tests

Unit tests cover supply estimates, weekly schedule matching, and time-in-range math.

Integration tests (opt-in) cover dose take idempotency and undo against a real database.
