# Backup and restore

T2D Track stores all durable state in Postgres. Treat the database as the source of truth.

## Railway backups

1. In the Railway project, open the Postgres service.
2. Enable daily and/or weekly backups, or point-in-time recovery if available on your plan.
3. Record the retention window in your runbook (example: 7 daily, 4 weekly).
4. Restrict who can access the Railway project and the database credentials.

## Restore test checklist

Perform once before relying on the app for important history, and after major schema changes.

1. Create a separate empty Postgres instance (local Docker or a temporary Railway DB).
2. Restore the latest backup into that instance using Railway restore UI or `pg_restore` / SQL dump import.
3. Point a local `.env` `DATABASE_URL` at the restored database.
4. Run `npx prisma migrate deploy` only if the restore is from an older schema and migrations are required; prefer restoring a backup that already matches production schema.
5. Start the app: `npm run build && npm start`.
6. Log in and verify:
   - Medications and stock balances match expectations
   - Recent dose events appear on Today
   - Inventory ledger sums equal `current_stock_cache` (or run `npm run reconcile-stock`)
   - Health readings load for the restored profile
7. Record the date of the restore test and the backup identifier used.

## Off-platform backup (optional)

If the data matters beyond a single Railway project, periodically export an encrypted dump:

```bash
pg_dump "$DATABASE_URL" | gzip | openssl enc -aes-256-cbc -pbkdf2 -out t2d-track-$(date +%F).sql.gz.enc
```

Store the file and passphrase outside Railway. Test decryption and restore on a spare database.

## Application-level export

Users can download their own data from Settings (account JSON export) or Reports (CSV/JSON). These are not a substitute for database backups.
