# T2D Track: Product Plan

Version 2.3, updated July 2026

T2D Track is a self-hosted, responsive medication and health web app for desktop, tablet, and mobile use, with household and caregiver support added in a follow-up release. It runs in a normal browser, can optionally be installed as a PWA, and uses Postgres as the durable source of truth.

The product promise is simple:

1. Know what is due.
2. Record what happened.
3. Trust what remains.
4. Bring a useful summary to a medical visit.

## 1. Product definition

The primary experience is a **Today** screen, not an inventory list. It shows scheduled medication doses, their current state, quick health-reading actions, and stock warnings. The same product works in desktop and mobile browsers; installation is never required for core tracking or reporting.

T2D Track should answer these questions without requiring the user to reconstruct events from separate logs:

- What medication is due now?
- What did I take, skip, miss, or postpone?
- How much medication remains?
- When should I start the refill process?
- What changed in my blood sugar, weight, blood pressure, or A1C?
- Can I produce a clear record for myself or a clinician?

The initial interface is optimized for one person managing their own care. The data model supports multiple people and caregivers from the beginning so household sharing can be added without migrating household-owned medication into person-owned medication later.

Desktop and mobile layouts serve different moments without splitting into separate products:

- **Desktop:** wider dashboards, comparison charts, history tables, inventory review, report preview, and PDF generation
- **Tablet:** adaptive two-column layouts where space allows
- **Mobile:** stacked cards, touch-friendly dose actions, quick health logging, reminders, and camera-ready future features

## 2. Product principles

### Trust beats automation

Every stock-changing action must be explainable, reversible, and attributable. The app may calculate balances and estimates, but the underlying transactions remain visible.

### A reminder is not proof

Sending a push notification does not mean a dose was taken. A scheduled dose becomes a dose event with an explicit outcome: pending, taken, skipped, missed, or snoozed.

### Health data belongs to a person

Medication, dose history, and health readings are owned by a `PersonProfile`. Household membership grants access; it does not define ownership.

### Clinical settings come from the user

The app does not prescribe targets, interpret symptoms, recommend dose changes, or decide when a reading is dangerous. Optional target ranges are entered by the user based on their care plan.

### Failure should be visible

The app should show when reminders are disabled, a device subscription is stale, data is waiting to sync, or a scheduled job has not run recently.

## 3. Goals and non-goals

### Goals

- Provide a fast Today view for due, overdue, completed, skipped, and snoozed doses
- Track medication name, strength, form, instructions, stock unit, and remaining quantity
- Connect each reminder to a scheduled dose event and explicit outcome
- Keep a reversible inventory ledger for doses, refills, corrections, and waste
- Estimate days of supply from active schedules rather than a fixed `doses_per_day`
- Alert users before stock runs out, using a configurable threshold and refill lead time
- Log blood sugar, weight, blood pressure, and A1C results
- Preserve useful context such as fasting, before meal, after meal, bedtime, exercise, or illness
- Show trends and generate on-demand CSV and PDF reports for 30 days, 3 months, 6 months, 1 year, all time, or a custom range
- Provide a responsive web app that works in current desktop and mobile browsers
- Install optionally as a PWA on supported desktop and mobile platforms and send push reminders when the platform permits
- Run as one persistent Railway web service with one Postgres service for the first release
- Keep the schema ready for household members, caregivers, and multiple profiles

### Non-goals for the first release

- No diagnosis, clinical interpretation, emergency monitoring, or dose-adjustment advice
- No drug interaction checker or medication recommendation engine
- No automatic escalation based on glucose or blood-pressure thresholds
- No pharmacy, insurer, or electronic health record integration
- No CGM, glucose-meter, Apple Health, or Health Connect import
- No barcode or photo-based medication recognition
- No automatic A1C estimate from sparse manual blood-sugar readings
- No food, calorie, or carbohydrate diary
- No promise that web push behaves like a guaranteed alarm
- No streak counters, badges, or gamified adherence pressure; completion percentages remain plain descriptive numbers
- No public multi-tenant launch or clinical use claim

## 4. Users, profiles, and access

### User

A `User` is an authenticated account. A user can eventually belong to more than one household.

### Household

A `Household` is an access and collaboration boundary. It does not own medication or health readings directly.

### Person profile

A `PersonProfile` represents the person whose medication and health information is being tracked. In the first release, registration creates one household and one profile linked to the registering user.

### Membership roles

- **Owner:** manages household settings, members, invitations, and all profiles
- **Member:** manages profiles explicitly shared with them
- **Caregiver:** can view or manage selected profiles, based on granted access

The household and caregiver interface ships after the personal MVP, but these ownership and permission relationships exist in the schema from the start.

### Profile permissions

- `owner`: full access, including sharing and deletion
- `manage`: view and change medication, doses, stock, and readings
- `view`: read-only access and reports

Every API route that accepts a profile, medication, schedule, dose event, inventory transaction, or health-reading ID must verify profile access on the server.

## 5. Release strategy

### Release 1: Personal MVP

- Registration, login, logout, and account recovery
- One user, household, and person profile created during onboarding
- Responsive desktop, tablet, and mobile layouts for all core workflows
- Today screen and dose-event workflow
- Medication, schedule, stock, refill, and correction workflows
- Push setup, test reminder, and delivery health
- Fixed and variable dose entry, with the amount recorded at logging time for variable-dose medication such as insulin
- Blood sugar, weight, blood pressure, and A1C logging
- Trends, recent history, CSV export, and on-demand doctor PDF reports
- Time-in-range and dose-completion summaries measured against user-entered settings
- Database backups, restore instructions, audit history, and basic observability

### Release 1.1: Household and caregiver

- Expiring invitations
- Owner, member, and caregiver roles
- Multiple person profiles
- Profile-specific access
- Targeted reminders
- Optional caregiver notification after a missed dose
- Member removal, household departure, and invitation revocation

### Release 1.2: Convenience and integration

- Offline write queue
- Flexible interval schedules and temporary medication holds
- Refill workflow states, including a last-refill prompt to contact the prescriber
- Symptom and illness notes
- Blood-sugar CSV import for spreadsheet and paper-log history, prioritized ahead of device or platform imports
- Better adherence and context summaries
- Supplies tracking for test strips, lancets, pen needles, CGM sensors, and similar consumables
- Drug catalog picker backed by locally imported RxTerms data, with brand and generic autocomplete and strength or form prefill
- General lab results beyond A1C, such as lipid panel, eGFR, creatinine, and urine microalbumin
- Injection-site logging for insulin and GLP-1 medication
- Printable emergency wallet card generated from active medication data
- TOTP two-factor authentication and optional passkey sign-in

## 6. Core workflows

### 6.1 Onboarding

1. Register with name, email, and password.
2. Verify the email address used for account recovery.
3. Create the initial household and person profile automatically.
4. Select timezone, preferred glucose unit, and weight unit.
5. Add the first medication.
6. Add one or more schedules.
7. Confirm that the browser app is ready to use on the current device.
8. If the user wants installation and the platform supports it, guide them through optional PWA installation.
9. Ask for notification permission only after a user gesture.
10. Send a test reminder and show whether it succeeded.

### 6.2 Today and dose logging

The Today screen groups dose events into:

- Due now
- Upcoming
- Overdue
- Completed
- Skipped

Each event supports:

- Mark taken
- Snooze
- Skip
- Edit time or amount after the fact
- Undo the most recent action
- Add a note

Marking a dose as taken writes a `DoseEvent` outcome and an `InventoryTransaction` in one database transaction. An idempotency key prevents a double tap from decrementing stock twice.

For medication configured for variable dose entry, such as sliding-scale or correction insulin, the reminder fires at the scheduled time but the amount is entered at logging time. The entered amount drives the inventory decrement. The schedule's `units_per_dose` acts only as an optional prefill.

For medication with injection-site tracking enabled, marking a dose taken offers a one-tap site picker (abdomen left or right, thigh left or right, arm left or right, other). The site is stored on the dose event and shown in history so the user can rotate sites. The app records the site; it does not tell the user where to inject.

### 6.3 Early, late, and missed doses

- A user can log a dose before its scheduled time and connect it to the upcoming event.
- A due event becomes overdue after a configurable grace period.
- An overdue event becomes missed at the end of its allowed window or local day.
- A missed event does not decrement stock.
- The user can correct a missed event later by marking it taken and supplying the actual time.
- The app records who made the change and when.

The app does not tell the user whether to take a late or missed dose. It records the user's decision.

### 6.4 Refill and stock correction

- Refill adds stock through an inventory transaction.
- Manual count records the observed quantity and creates an adjustment for the difference.
- Waste or loss records a negative transaction without creating a dose event.
- Undo creates a reversing transaction rather than deleting history.
- Stock cannot silently become negative. The app requires confirmation and shows a reconciliation warning.

### 6.5 Health logging

The Health screen provides quick forms for:

- Blood sugar
- Weight
- Blood pressure and pulse
- A1C lab result

The user can log a current or past timestamp, add context, edit an entry, or delete it. Deletion is auditable and can use a short recovery window before permanent removal.

### 6.6 Reports

The user can generate a report whenever requested, without waiting for a scheduled email or background batch. Preset ranges are:

- Last 30 days
- Last 3 months
- Last 6 months
- Last 1 year
- All time
- Custom start and end dates

The date range uses the person's timezone and appears clearly on the cover page and every detailed table. Before downloading, the user can preview the report, enter an optional recipient such as the doctor's name, and choose a summary or complete version.

The complete doctor report can include:

- Cover page with person name, optional date of birth, generated date, report range, and optional recipient
- Active medication list and instructions
- Medication change timeline showing starts, stops, strength changes, and schedule changes, built from replacement records and effective-dated schedules
- Dose-event history and completion summary
- Time-in-range summary for blood sugar, measured against user-entered target ranges and labeled as personal settings
- Refill and inventory adjustments
- Blood-sugar readings grouped by context
- Weight trend
- Blood-pressure and pulse trend
- A1C history
- Lab result history when available (Release 1.2)
- User-entered target ranges, clearly labeled as personal settings
- Notes selected for inclusion
- Detailed appendices containing individual readings and dose events

The PDF is the human-readable doctor report. CSV and JSON remain available for complete raw data. The server generates the PDF on demand and streams it to the browser; it does not retain a permanent report file by default.

## 7. MVP functional requirements

1. Register, recover account, log in, and log out
2. Create and edit the current person profile
3. Add, edit, pause, resume, and deactivate medication
4. Create daily and weekly schedules with start and optional end dates
5. Generate dose events and show them on Today
6. Mark events taken, skipped, snoozed, missed, or corrected
7. Record stock changes through an inventory ledger
8. Show quantity remaining and schedule-derived estimated days of supply
9. Reconcile stock with a manual count
10. Send low-stock email according to user preferences
11. Use all core features in desktop, tablet, and mobile browsers without installing the app, with optional PWA installation where supported
12. Send a test push and show subscription health
13. Send medication reminders with deduplication, retry, and restart catch-up
14. Log and edit blood sugar, weight, blood pressure, pulse, and A1C
15. Show trends by date range and reading context
16. Preview and generate summary or complete PDF doctor reports for 30 days, 3 months, 6 months, 1 year, all time, or a custom range
17. Show a concise audit trail for important changes
18. Export account data and request account deletion
19. Back up Postgres and document a tested restore procedure
20. Record the actual amount at logging time for medication configured as variable dose entry
21. Show time-in-range against user-entered target ranges, plus 7-day and 30-day dose completion percentages, as plain descriptive summaries

## 8. Data model

Use Postgres `numeric` or Prisma `Decimal` for medication quantities, strengths, and blood-sugar values that may require decimals. Do not use floating-point storage for inventory.

### Identity and access

```text
Household
  id                    cuid, primary key
  name                  string
  default_timezone      IANA timezone
  created_at            timestamp
  updated_at            timestamp

User
  id                    cuid, primary key
  email                 string, unique
  password_hash         string
  name                  string
  email_verified_at     timestamp, nullable
  created_at            timestamp
  updated_at            timestamp

AccountToken
  id                    cuid, primary key
  user_id               fk -> User
  token_hash            string, unique
  purpose               verify_email | password_reset
  expires_at            timestamp
  used_at               timestamp, nullable
  created_at            timestamp

Session
  id                    cuid, primary key
  user_id               fk -> User
  token_hash            string, unique
  expires_at            timestamp
  revoked_at            timestamp, nullable
  last_seen_at          timestamp, nullable
  created_at            timestamp

HouseholdMembership
  id                    cuid, primary key
  household_id          fk -> Household
  user_id               fk -> User
  role                  owner | member | caregiver
  created_at            timestamp
  unique                (household_id, user_id)

PersonProfile
  id                    cuid, primary key
  household_id          fk -> Household
  linked_user_id        fk -> User, nullable
  display_name          string
  date_of_birth         date, nullable
  timezone              IANA timezone
  glucose_unit          mg_dL | mmol_L
  weight_unit           lb | kg
  created_by_user_id    fk -> User
  created_at            timestamp
  updated_at            timestamp

ProfileAccess
  id                    cuid, primary key
  person_profile_id     fk -> PersonProfile
  user_id               fk -> User
  permission            owner | manage | view
  created_at            timestamp
  unique                (person_profile_id, user_id)

Invitation
  id                    cuid, primary key
  household_id          fk -> Household
  token_hash            string, unique
  role                  member | caregiver
  person_profile_id     fk -> PersonProfile, nullable
  permission            manage | view, nullable
  expires_at            timestamp
  max_uses              integer, default 1
  use_count             integer, default 0
  revoked_at            timestamp, nullable
  created_by_user_id    fk -> User
  created_at            timestamp
```

Invitation tokens are random, stored as hashes, expiring, and revocable. The raw token appears only in the invitation link.

Verification and recovery tokens follow the same rule: store only a hash, make each token single-use, and expire it.

### Medication and schedule

```text
Medication
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  name                   string
  rxcui                  string, nullable; RxNorm concept identifier captured when the catalog picker is used
  form                   string, nullable
  strength_value         decimal, nullable
  strength_unit          string, nullable
  stock_unit             string
  default_units_per_dose decimal, default 1
  track_injection_site   boolean, default false
  instructions           string, nullable
  refill_threshold_days  integer, default 7
  refill_lead_time_days  integer, default 3
  pharmacy               string, nullable
  prescription_number    string, nullable
  refills_remaining      integer, nullable
  refill_eligible_on     date, nullable
  prescriber             string, nullable
  notes                  string, nullable
  start_date             date, nullable
  end_date               date, nullable
  status                 active | paused | stopped
  current_stock_cache    decimal, default 0
  created_at             timestamp
  updated_at             timestamp

MedicationSchedule
  id                     cuid, primary key
  medication_id          fk -> Medication
  label                  string, nullable
  schedule_type          daily | weekly | as_needed
  time_of_day            local time, nullable
  days_of_week           string[], nullable
  dose_entry             fixed | variable, default fixed
  units_per_dose         decimal, nullable when dose_entry is variable; used as an optional prefill
  start_date             date
  end_date               date, nullable
  grace_period_minutes   integer, default 120
  active                 boolean, default true
  created_at             timestamp
  updated_at             timestamp
```

Daily and weekly schedules cover the first release. Interval, cycle, taper, and monthly rules wait until Release 1.2 because they need stronger recurrence semantics.

Changing a medication's strength, form, or stock unit after dose history exists should stop the old medication and create a replacement record. Editing those fields in place would rewrite the meaning of historical events. Schedule changes that affect recurrence close the old schedule and create a new effective-dated schedule; completed events remain linked to the original.

As-needed medication can be logged without a scheduled event. It does not receive a days-of-supply estimate unless the user explicitly configures an expected rate.

The medication form lets the user enter multiple times of day, such as 8:00 AM and 8:00 PM, in a single step; the app creates one schedule row per time. Twice-daily medication is the most common T2D prescription, so the user should never need to think in schedule rows.

Until the medication-container model ships, insulin and other multi-dose pens are tracked in units, with priming recorded as `waste` transactions. This is the sanctioned workaround; document it in the medication-entry help text so early users have a clear path.

### Drug catalog (Release 1.2)

The catalog makes medication entry faster and more consistent. It is built from RxTerms, the National Library of Medicine's public-domain drug interface terminology derived from RxNorm. RxTerms is designed specifically for pick lists: it splits each drug into a name-plus-route display name and a separate list of strength and form combinations, includes brand and generic names with common synonyms and tall-man lettering, and excludes obsolete US drugs.

```text
DrugCatalogEntry
  id                     cuid, primary key
  display_name           string; drug name plus route, e.g. Metformin (Oral-pill)
  synonyms               string[]; common abbreviations and alternate names
  is_brand               boolean
  generic_display_name   string, nullable; links a brand entry to its generic
  strengths_and_forms    jsonb; array of { strength, form, rxcui }
  source_version         string; RxTerms release identifier
  created_at             timestamp
  updated_at             timestamp
```

Catalog rules:

- The catalog is imported locally from the monthly RxTerms release zip by a CLI import command. The app never queries an external drug API at runtime, so medication searches stay on the user's server and the picker works offline once the shell is cached.
- The import is idempotent and versioned. Re-running it replaces the catalog atomically and records `source_version`; user medication records are never modified by an import.
- Picking a catalog entry prefills `name`, `form`, `strength_value`, `strength_unit`, and `rxcui` on the medication form. The user can edit every prefilled field.
- The picker is a convenience, not a constraint. Free-text entry remains fully supported for supplements, compounded medication, and anything the catalog misses, and creates a medication with a null `rxcui`.
- The catalog provides names and strengths only. It does not enable interaction checking, dosing suggestions, or any clinical interpretation, which remain explicit non-goals.
- RxTerms is tailored to US prescribing. Deployments outside the US can skip the import and use free-text entry; document this limitation.

Storing `rxcui` from the start keeps future options open, such as device or platform imports and the deferred interaction checker, without a fragile name-matching step later.

### Dose events and inventory

```text
DoseEvent
  id                     cuid, primary key
  medication_id          fk -> Medication
  schedule_id            fk -> MedicationSchedule, nullable
  person_profile_id      fk -> PersonProfile
  scheduled_for          timestamp with timezone, nullable
  local_scheduled_date   date, nullable
  status                 pending | snoozed | taken | skipped | missed
  snoozed_until          timestamp, nullable
  taken_at               timestamp, nullable
  amount_taken           decimal, nullable
  injection_site         string, nullable
  logged_by_user_id      fk -> User, nullable
  source                 app | notification | backfill | import
  notes                  string, nullable
  created_at             timestamp
  updated_at             timestamp
  unique                 (schedule_id, scheduled_for)

InventoryTransaction
  id                     cuid, primary key
  medication_id          fk -> Medication
  dose_event_id          fk -> DoseEvent, nullable
  kind                   opening | dose | refill | adjustment | waste | reversal
  quantity_delta         decimal
  balance_after          decimal
  occurred_at            timestamp
  recorded_by_user_id    fk -> User
  idempotency_key        string, nullable, unique
  reverses_transaction_id fk -> InventoryTransaction, nullable
  notes                  string, nullable
  created_at             timestamp
```

The inventory ledger is authoritative. `current_stock_cache` is updated inside the same transaction and can be recalculated from the ledger.

The unique constraint on `(schedule_id, scheduled_for)` intentionally permits as-needed events because Postgres treats NULL schedule IDs as distinct; leave a code comment so no one "fixes" it.

### Supplies (Release 1.2)

Consumables such as test strips, lancets, pen needles, and CGM sensors have stock, refills, and run-out risk, but no dose schedule. They reuse the same ledger.

```text
SupplyItem
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  name                   string
  stock_unit             string
  refill_threshold_days  integer, nullable
  expected_daily_use     decimal, nullable
  status                 active | archived
  current_stock_cache    decimal, default 0
  created_at             timestamp
  updated_at             timestamp
```

`InventoryTransaction` gains a nullable `supply_item_id`, with a check constraint requiring exactly one of `medication_id` or `supply_item_id`. Supply transactions never link to dose events. Estimated supply comes from `expected_daily_use` when set; otherwise the app shows quantity only. Supplies participate in the same low-stock digest.

### Notifications

```text
NotificationPreference
  id                     cuid, primary key
  user_id                fk -> User
  dose_push_enabled      boolean, default true
  low_stock_email_enabled boolean, default true
  caregiver_alert_enabled boolean, default false
  private_preview        boolean, default false
  quiet_hours_start      local time, nullable
  quiet_hours_end        local time, nullable
  created_at             timestamp
  updated_at             timestamp
  unique                 (user_id)

ProfileNotificationSetting          release 1.1
  id                     cuid, primary key
  user_id                fk -> User
  person_profile_id      fk -> PersonProfile
  dose_push_enabled      boolean, default true
  caregiver_alert_enabled boolean, default false
  created_at             timestamp
  updated_at             timestamp
  unique                 (user_id, person_profile_id)

PushSubscription
  id                     cuid, primary key
  user_id                fk -> User
  endpoint               string, unique
  p256dh                 string
  auth                   string
  device_label           string, nullable
  active                 boolean, default true
  last_success_at        timestamp, nullable
  last_failure_at        timestamp, nullable
  failure_count          integer, default 0
  created_at             timestamp
  updated_at             timestamp

NotificationDelivery
  id                     cuid, primary key
  user_id                fk -> User
  push_subscription_id   fk -> PushSubscription, nullable
  dose_event_id          fk -> DoseEvent, nullable
  medication_id          fk -> Medication, nullable
  channel                push | email
  type                   dose_due | dose_follow_up | low_stock | caregiver_missed
  dedupe_key             string, unique
  status                 pending | sent | failed | suppressed
  attempt_count          integer, default 0
  last_error_code        string, nullable
  sent_at                timestamp, nullable
  created_at             timestamp
  updated_at             timestamp
```

Quiet hours never suppress the initial dose reminder. They apply to follow-up reminders, low-stock digests, and caregiver alerts. Silencing medication reminders is only available as a separate explicit opt-in with a clear warning.

Global preferences live on `NotificationPreference`. When Release 1.1 introduces multiple profiles, `ProfileNotificationSetting` overrides the global values per profile so a caregiver can receive dose pushes for one person and not another. The table exists in the schema from the start to avoid a later migration.

### Health readings

```text
BloodSugarReading
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  value                  decimal
  unit                   mg_dL | mmol_L
  context                fasting | before_meal | after_meal | bedtime | exercise | illness | random | other
  taken_at               timestamp
  notes                  string, nullable
  recorded_by_user_id    fk -> User
  deleted_at             timestamp, nullable
  deleted_by_user_id     fk -> User, nullable
  created_at             timestamp
  updated_at             timestamp

WeightReading
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  value                  decimal
  unit                   lb | kg
  taken_at               timestamp
  notes                  string, nullable
  recorded_by_user_id    fk -> User
  deleted_at             timestamp, nullable
  deleted_by_user_id     fk -> User, nullable
  created_at             timestamp
  updated_at             timestamp

BloodPressureReading
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  systolic               integer
  diastolic              integer
  pulse                  integer, nullable
  context                morning | evening | resting | before_exercise | after_exercise | illness | other
  taken_at               timestamp
  notes                  string, nullable
  recorded_by_user_id    fk -> User
  deleted_at             timestamp, nullable
  deleted_by_user_id     fk -> User, nullable
  created_at             timestamp
  updated_at             timestamp

A1CReading
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  value_percent          decimal
  taken_at               date
  laboratory             string, nullable
  notes                  string, nullable
  recorded_by_user_id    fk -> User
  deleted_at             timestamp, nullable
  deleted_by_user_id     fk -> User, nullable
  created_at             timestamp
  updated_at             timestamp

LabResult                            release 1.2
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  test_name              string
  value                  decimal
  unit                   string
  taken_at               date
  laboratory             string, nullable
  notes                  string, nullable
  recorded_by_user_id    fk -> User
  deleted_at             timestamp, nullable
  deleted_by_user_id     fk -> User, nullable
  created_at             timestamp
  updated_at             timestamp

HealthTarget
  id                     cuid, primary key
  person_profile_id      fk -> PersonProfile
  metric_type            blood_sugar | systolic | diastolic | weight | a1c
  context                string, default any (sentinel; never null)
  low_value              decimal, nullable
  high_value             decimal, nullable
  unit                   string
  label                  string, nullable
  created_by_user_id     fk -> User
  created_at             timestamp
  updated_at             timestamp
  unique                 (person_profile_id, metric_type, context)
```

Keep the reading tables separate. Their validation, fields, and report treatment differ enough that a single generic measurements table would move complexity into every query. `LabResult` is the exception: quarterly and annual labs such as lipid panel, eGFR, creatinine, and urine microalbumin share a simple name-value-unit shape and stay purely descriptive, so one table with a suggested-name picker is enough.

`HealthTarget.context` uses the sentinel value `any` instead of NULL. Postgres treats NULLs as distinct in unique constraints, so a nullable context would allow duplicate no-context targets. A partial unique index is the alternative if a nullable column is preferred.

### Audit history

```text
AuditEvent
  id                     cuid, primary key
  household_id           fk -> Household
  person_profile_id      fk -> PersonProfile, nullable
  actor_user_id          fk -> User, nullable
  action                 string
  entity_type            string
  entity_id              string
  summary                string
  metadata               jsonb, nullable
  created_at             timestamp
```

Audit metadata must avoid password material, session IDs, push credentials, or unnecessary health-value duplication.

### Scheduler state

```text
SchedulerCheckpoint
  name                   string, primary key
  last_successful_at     timestamp
  last_started_at        timestamp, nullable
  last_error_code        string, nullable
  updated_at             timestamp
```

Postgres advisory locks provide single-run exclusion. The checkpoint provides restart catch-up and visible scheduler health.

## 9. Calculation rules

### Stock balance

`stock balance = sum(InventoryTransaction.quantity_delta)`

The cached balance is a performance convenience. A reconciliation command can rebuild it from the ledger.

### Estimated days of supply

For scheduled medication, calculate upcoming consumption from active schedules in the profile's timezone.

- Daily medication: count scheduled occurrences and dose quantities.
- Weekly medication: count weekly occurrences rather than converting to a fragile fractional daily rate.
- Paused or stopped medication: do not forecast consumption during the inactive period.
- Variable-dose medication: forecast from a trailing average of actual `amount_taken` over the last 30 days, falling back to `units_per_dose` when history is sparse. Label the basis in the UI.
- As-needed medication: show quantity only unless an expected rate is explicitly set.
- Supplies: forecast from `expected_daily_use` when set; otherwise show quantity only.

The dashboard should label the result **estimated supply**, since actual use can differ from the schedule.

### Stock states

- **Available:** estimated supply exceeds the threshold
- **Refill soon:** within `refill_threshold_days`
- **Urgent refill:** within `refill_lead_time_days` or below the next scheduled dose requirement
- **Out:** stock is zero or below
- **Needs reconciliation:** balance is negative or contradicted by a manual count
- **Last refill:** `refills_remaining` is 0 or 1; surface a prompt to contact the prescriber, since the pharmacy cannot refill without a new prescription (Release 1.2 refill workflow)

These are inventory states, not clinical severity labels.

## 10. API design

### Conventions

- All routes except initial registration, email verification, login, recovery, and invitation acceptance require a valid session.
- Every state-changing route requires CSRF protection.
- Every resource lookup enforces profile access on the server.
- Dose logging, inventory changes, and notification creation accept or generate idempotency keys.
- Validation errors identify the field and preserve the user's form input.
- Dates and times are stored with timezone information; schedules preserve their intended local time.
- List endpoints support date filters and pagination where history can grow indefinitely.

### Auth and account

```text
POST   /api/auth/register
POST   /api/auth/verify-email
POST   /api/auth/verification/resend
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/recovery/request
POST   /api/auth/recovery/complete
GET    /api/account/export
POST   /api/account/delete-request
```

The deployment defaults to `first_user_only` registration. The first successful registration creates the owner account; later registration requires an invitation unless the operator deliberately enables open registration.

### Household and profiles

```text
GET    /api/households
GET    /api/households/:id
PUT    /api/households/:id
GET    /api/profiles
POST   /api/profiles                         release 1.1
GET    /api/profiles/:id
PUT    /api/profiles/:id
GET    /api/profiles/:id/access             release 1.1
PUT    /api/profiles/:id/access/:userId     release 1.1
POST   /api/households/:id/invitations      release 1.1
DELETE /api/invitations/:id                 release 1.1
POST   /api/invitations/:token/accept       release 1.1
```

### Medication

```text
GET    /api/profiles/:profileId/medications
POST   /api/profiles/:profileId/medications
GET    /api/medications/:id
PUT    /api/medications/:id
POST   /api/medications/:id/pause
POST   /api/medications/:id/resume
DELETE /api/medications/:id                 soft deactivate

GET    /api/medications/:id/schedules
POST   /api/medications/:id/schedules
PUT    /api/schedules/:id
DELETE /api/schedules/:id                   deactivate, preserve events

GET    /api/drug-catalog/search?q=&limit=   release 1.2; local RxTerms lookup, no external calls
```

### Today and dose events

```text
GET    /api/profiles/:profileId/today?date=
GET    /api/profiles/:profileId/dose-events?from=&to=&status=&cursor=
POST   /api/dose-events/:id/taken
POST   /api/dose-events/:id/skipped
POST   /api/dose-events/:id/snooze
PUT    /api/dose-events/:id
POST   /api/dose-events/:id/undo
POST   /api/medications/:id/as-needed-dose
```

### Inventory

```text
GET    /api/medications/:id/inventory
GET    /api/medications/:id/inventory-transactions?cursor=
POST   /api/medications/:id/refills
POST   /api/medications/:id/adjustments
POST   /api/medications/:id/manual-counts
POST   /api/inventory-transactions/:id/reverse
```

### Health

Each metric supports create, list, update, and delete. This keeps the API consistent with the requirement that readings are editable.

```text
POST   /api/profiles/:profileId/health/blood-sugar
GET    /api/profiles/:profileId/health/blood-sugar?from=&to=&context=&cursor=
PUT    /api/health/blood-sugar/:id
DELETE /api/health/blood-sugar/:id

POST   /api/profiles/:profileId/health/weight
GET    /api/profiles/:profileId/health/weight?from=&to=&cursor=
PUT    /api/health/weight/:id
DELETE /api/health/weight/:id

POST   /api/profiles/:profileId/health/blood-pressure
GET    /api/profiles/:profileId/health/blood-pressure?from=&to=&context=&cursor=
PUT    /api/health/blood-pressure/:id
DELETE /api/health/blood-pressure/:id

POST   /api/profiles/:profileId/health/a1c
GET    /api/profiles/:profileId/health/a1c
PUT    /api/health/a1c/:id
DELETE /api/health/a1c/:id

POST   /api/profiles/:profileId/health/labs                          release 1.2
GET    /api/profiles/:profileId/health/labs?from=&to=&test=&cursor=  release 1.2
PUT    /api/health/labs/:id                                          release 1.2
DELETE /api/health/labs/:id                                          release 1.2
```

### Supplies (Release 1.2)

```text
GET    /api/profiles/:profileId/supplies
POST   /api/profiles/:profileId/supplies
GET    /api/supplies/:id
PUT    /api/supplies/:id
POST   /api/supplies/:id/refills
POST   /api/supplies/:id/adjustments
POST   /api/supplies/:id/manual-counts
```

### Health target settings

```text
GET    /api/profiles/:profileId/health-targets
PUT    /api/profiles/:profileId/health-targets
```

### Reports and export

```text
POST   /api/profiles/:profileId/reports/doctor.pdf
       body: { range: 30d | 90d | 180d | 1y | all | custom,
               from?, to?, detail: summary | complete,
               recipient?, includedSections? }
GET    /api/profiles/:profileId/export.csv?range=&from=&to=
GET    /api/profiles/:profileId/export.json
POST   /api/profiles/:profileId/reports/wallet-card.pdf              release 1.2
```

The PDF endpoint generates and streams a file without persisting it. Using a POST body keeps optional recipient information and report configuration out of URLs and ordinary access logs.

### Notification settings

```text
POST   /api/push/subscribe
DELETE /api/push/subscriptions/:id
POST   /api/push/test
GET    /api/push/subscriptions
PUT    /api/user/notification-preferences
```

## 11. Reminder architecture

### Why exact-minute matching is insufficient

A process can restart, deploy, pause, or overlap another instance during the scheduled minute. Comparing the current clock to `HH:MM` can lose reminders permanently or send duplicates.

### First-release scheduler

The one persistent Railway web service can run a scheduler loop, provided Postgres owns the durable state.

1. Acquire a Postgres advisory lock or scheduler lease.
2. Read the last successful scheduler checkpoint.
3. Generate missing dose events from the checkpoint through a short future window.
4. Find due, unsent events between the last checkpoint and now.
5. Insert one `NotificationDelivery` per destination with a unique dedupe key. Push delivery rows identify the device subscription; email delivery rows identify the user.
6. Send the notification.
7. Record success or retryable failure.
8. Advance the checkpoint after the database work succeeds.
9. Release the lock.

The scheduler catches up after a restart instead of requiring an exact clock match. The unique event and delivery constraints protect against deployment overlap and accidental horizontal scaling.

Catch-up is capped: events older than `SCHEDULER_STALE_NOTIFY_MINUTES` at send time are advanced through their normal overdue and missed transitions without a notification. An outage should never release a burst of stale reminders when the service returns; that burst is the fastest way to teach a user to ignore the app.

### Follow-up reminders

- Initial reminder at the scheduled time
- Optional follow-up after a configurable delay if the event remains pending
- Stop follow-ups when the event becomes taken, skipped, or missed
- Do not claim guaranteed delivery

### Push-subscription health

- Disable subscriptions that return a permanent invalid-endpoint response.
- Retain the device label and last successful delivery timestamp.
- Show the user when a device has not received a successful push recently.
- Provide a test push from Settings.

### Notification privacy

Normal preview:

- Title: medication name
- Body: schedule label and prescribed amount

Private preview:

- Title: T2D Track
- Body: Medication reminder

Notification action buttons remain a later enhancement because browser support is inconsistent. Clicking the notification opens the specific Today event.

## 12. Low-stock alerts

- Calculate estimated supply after any inventory or schedule change.
- Send one digest per user, not one email per medication.
- Respect `low_stock_email_enabled` separately from push preferences.
- Include quantity, estimated supply, threshold, and pharmacy details when available.
- Use a user-and-date digest dedupe key.
- Allow the user to acknowledge or snooze an alert without changing stock.
- Send again when the snooze expires or stock crosses a more urgent inventory state.

`NotificationDelivery` records each user's actual email attempt. Medication IDs included in a digest can be stored in delivery metadata or a child table.

## 13. Health trends and reports

### Doctor report

The report builder is a first-release feature available on desktop and mobile. Desktop uses a settings panel beside the preview. Mobile places the same controls above the preview.

The user selects:

- 30 days, 3 months, 6 months, 1 year, all time, or custom dates
- Summary or complete detail
- Optional recipient name
- Which notes and sections to include

The summary begins with the active medication list, report range, health-reading counts, key charts, A1C history, and dose-event totals. The complete version adds paginated tables of individual readings, dose events, refills, and inventory adjustments.

Every PDF includes:

- Person name and optional date of birth
- Generated timestamp and profile timezone
- Selected date range
- Units used for each metric
- Page numbers and repeated table headers
- Clear labels when data is missing or sparse
- A statement that targets are user-entered and the report does not provide medical advice

The user can preview, download, save, or print the PDF. Directly emailing a doctor from T2D Track is deferred; the first release downloads the file so the user can send it through their preferred secure channel.

### Emergency wallet card (Release 1.2)

A one-page, wallet-foldable PDF listing the person's name, active medications with strength and schedule, allergies or critical notes the user chooses to include, and an optional emergency contact. It is generated on demand from existing data, streams without server retention like the doctor report, and includes a generated date so an outdated card is recognizable.

### Charts

- Blood sugar: line or scatter plot with context markers
- Weight: line chart
- Blood pressure: systolic and diastolic lines, with pulse available
- A1C: point-and-line history over longer date ranges

### Summaries

- Count of readings
- Average, minimum, and maximum for the selected range
- Blood-sugar summary grouped by context
- Share of readings within user-entered target ranges, labeled as measured against personal settings and shown only when targets exist
- Medication completion counts by taken, skipped, and missed
- Seven-day and thirty-day dose completion percentages, presented as plain numbers without streaks or judgment language
- Stock and refill history

Summaries describe the recorded data. They do not diagnose patterns or recommend treatment changes.

### Personal target ranges

Target ranges are optional profile settings entered by the user. The UI must label them as personal settings and never silently substitute general clinical thresholds.

### Input validation

- Accept the profile's selected units.
- Convert only for display or export when requested.
- Warn about likely typing mistakes or internally inconsistent values.
- Allow the user to confirm and save an unusual reading.
- Keep validation language factual and non-diagnostic.

## 14. Responsive web app, PWA, and offline behavior

### Responsive web application

The browser application is the primary product. PWA installation adds convenience and push capabilities on supported platforms, but no core workflow requires installation.

Target browser experiences:

- Current Chrome, Edge, Firefox, and Safari on desktop
- Safari on current iPhone and iPad versions
- Chrome on current Android versions

Layout behavior:

- Desktop widths use persistent navigation, multi-column dashboards, larger charts, and sortable history tables.
- Tablet widths use one or two columns based on available space.
- Mobile widths use stacked cards, compact charts, bottom or compact navigation, and touch targets sized for one-handed use.
- Forms, tables, charts, and reports remain usable with keyboard navigation, browser zoom, and screen-reader labels.
- Core actions must never exist only as hover interactions, swipe gestures, or notification actions.

### Installability

- Web app manifest with `name`, `short_name`, `id`, `start_url`, `display`, colors, and icons
- 192x192, 512x512, and maskable icons
- Apple touch icon and appropriate iOS metadata
- HTTPS on the Railway domain and custom domain
- In-app installation guidance for supported desktop, iOS, and Android browsers

### Service worker

- Cache the static app shell and locally hosted frontend assets
- Use network-first requests for authenticated data
- Do not cache private API responses by default
- Handle push and notification-click events
- Detect and surface when a newer app version is ready

Charting and other runtime dependencies should be bundled or self-hosted. A CDN-only Chart.js dependency breaks the offline app shell and adds an avoidable external dependency.

### Offline writes

Release 1 shows a clear offline state and preserves unsaved form input. Release 1.2 can add an IndexedDB write queue with idempotency keys. Queued writes remain visibly pending until the server confirms them; the app retries when connectivity returns or the user reopens it.

## 15. Authentication, security, and privacy

### Authentication

- Hash passwords with Argon2id or an appropriately configured bcrypt implementation
- Use opaque server-side sessions stored in Postgres through the first-class `Session` table, so member removal and password changes can revoke sessions with a simple update
- Plan TOTP two-factor authentication and passkey sign-in for Release 1.2; passkeys pair well with the installed PWA
- Set the session cookie as `Secure`, `HttpOnly`, explicit `SameSite`, `Path=/`, with a host-only cookie name where practical
- Rotate the session after login and password recovery
- Support email recovery with random, single-use, expiring tokens
- Rate-limit login, recovery, registration, and invitation acceptance

### Request security

- CSRF protection on every state-changing route
- Server-side authorization on every resource
- Strict input validation and response content types
- Security headers, including a Content Security Policy
- No authentication tokens in localStorage
- No state-changing `GET` routes
- Registration mode defaults to first-user-only or invite-only on an internet-accessible deployment

### Sensitive-data handling

- Avoid health values and medication names in application logs
- Avoid exposing sensitive content in URLs
- Allow private notification previews
- Restrict Railway project and database access
- Keep secrets in Railway environment variables
- Redact push credentials and sessions from error reporting

### Data rights and recovery

- Export profile and account data
- Delete a profile or account through a confirmed workflow
- Explain that deleted data may remain in encrypted backups until the configured retention window expires
- Remove a household member and revoke their sessions
- Revoke invitations
- Document retention behavior for audit history and backups
- Enable scheduled Postgres backups or point-in-time recovery
- Test restoration before treating backups as complete

The app is a personal organizer. It should not market itself as HIPAA-compliant or as a replacement for professional care.

## 16. Suggested technology

- **Backend:** Node.js and Express
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Sessions:** Postgres-backed session store
- **Frontend:** server-rendered or static HTML with vanilla JavaScript
- **Build:** a small esbuild step to bundle local dependencies and version assets
- **Charts:** Chart.js bundled locally
- **PDF:** a pure-JavaScript library such as PDFKit or pdfmake with a fixed visit-report template; if headless-Chromium HTML-to-PDF is chosen instead, size the Railway service memory for the rendering spike, since the same process runs the scheduler loop
- **Email:** Resend or another HTTP API provider
- **Push:** standards-based Web Push with VAPID keys
- **Scheduling:** in-process loop with Postgres advisory lock, checkpoint, and idempotent delivery rows
- **Time zones:** Luxon or another IANA-aware time library
- **Validation:** shared request schemas, such as Zod
- **Drug catalog:** monthly RxTerms release loaded into Postgres by a versioned CLI import command; Postgres trigram or full-text indexes for autocomplete
- **Logging:** structured server logs with sensitive-field redaction

This remains one persistent web service plus Postgres in the first release. If delivery volume or reliability needs grow, move scheduler processing to a dedicated worker without changing the durable job model.

## 17. Frontend pages

1. **/login:** login and recovery link
2. **/register:** account creation and initial profile settings
3. **/onboarding:** first medication, first schedule, PWA installation, and test push
4. **/today:** due, upcoming, overdue, completed, and skipped dose events; quick health actions
5. **/medications:** active, paused, stopped, low-stock, and reconciliation-needed views
6. **/medications/new:** medication, stock unit, opening balance, schedule, and refill settings; drug-catalog autocomplete with strength and form prefill in Release 1.2, always with a free-text path
7. **/medications/:id:** details, history, schedules, inventory ledger, refill, count, pause, and edit
8. **/health:** quick-add forms and recent readings
9. **/health/trends:** charts, date range, and context filters
10. **/reports:** range selection, section controls, side-by-side desktop preview, stacked mobile preview, PDF doctor report, and CSV or JSON exports
11. **/settings:** units, timezone, notification preferences, device subscriptions, test push, privacy, account export, and recovery
12. **/household:** members, profiles, invitations, and access, added in Release 1.1
13. **/supplies:** consumable stock, refills, and manual counts, added in Release 1.2
14. **/health/labs:** lab result entry and history with a suggested-test picker, added in Release 1.2

### Empty and failure states

- First medication prompt
- First reading prompt
- Push unsupported on this device
- PWA installation required before iOS push setup
- Notification permission denied
- Device subscription stale
- Scheduler health warning
- Offline or unsynced form state
- Stock needs reconciliation
- Report contains no readings for the selected range

## 18. Observability and operations

### Application health

- HTTP health endpoint
- Database connectivity check
- Current deployment version
- Scheduler last-success timestamp
- Count of pending and failed notification deliveries
- Count of inactive push subscriptions

### Logging

Log operational identifiers, outcomes, durations, and error codes. Do not log health values, medication notes, passwords, sessions, invitation tokens, or push credentials.

### Backups

- Enable daily and weekly Postgres backups or point-in-time recovery
- Record the retention window
- Document the restore process
- Perform and record one restore test before relying on the app
- Export an encrypted off-platform backup periodically if the data matters beyond the Railway project

### Migrations

Run `prisma migrate deploy` as a deployment step before the new application version receives traffic. Avoid making each web replica race to run migrations during startup.

## 19. Test plan and acceptance criteria

### Core workflow acceptance

- A scheduled dose appears on Today in the profile's local timezone.
- One action can mark it taken.
- A double tap creates one dose result and one stock decrement.
- Undo restores the stock balance without deleting history.
- A skipped or missed dose does not change inventory.
- A manual count creates a visible reconciliation transaction.
- A weekly medication receives the correct supply estimate.
- A variable-dose medication prompts for the amount at logging time, decrements stock by the entered amount, and forecasts supply from the trailing average.
- Entering two times of day on the medication form creates two schedule rows and two daily reminders without extra steps.

### Drug catalog acceptance (Release 1.2)

- Typing a partial brand or generic name returns matching catalog entries, including synonym matches such as HCTZ.
- Selecting an entry prefills name, form, strength, and RxCUI, and every prefilled field remains editable.
- Free-text medication entry works with the catalog present and produces a record with a null RxCUI.
- Re-running the import replaces the catalog without altering any user medication record.
- Catalog search generates no external network requests.

### Responsive web acceptance

- Every core workflow works in a normal browser without PWA installation.
- Desktop layouts are verified at 1280 and 1440 pixel widths.
- Tablet layouts are verified around 768 and 1024 pixel widths.
- Mobile layouts are verified from 360 through 430 pixel widths.
- History tables provide a usable desktop table and an accessible mobile presentation.
- Charts resize without clipped labels or unreadable legends.
- Keyboard users can reach and operate every action.
- Browser zoom at 200 percent does not hide required controls.

### Reminder acceptance

- A reminder sent once is not duplicated by a second scheduler process.
- A deployment during the scheduled minute is caught up after restart.
- A permanently invalid push endpoint is disabled.
- A taken event does not receive a follow-up reminder.
- Events past the staleness window transition to overdue or missed without sending a notification burst after an outage.
- Quiet hours suppress follow-ups and digests but never the initial dose reminder.
- Private previews contain no medication name.
- Test push works on the actual target iPhone and Android device where applicable.

### Privacy acceptance

- A user without profile access cannot read or mutate the profile by changing an ID.
- A removed member loses access and active sessions are invalidated.
- Invitation tokens expire and can be revoked.
- Health values do not appear in normal application logs.
- Export includes the user's complete data.

### Time acceptance

- Daily and weekly schedules behave correctly across daylight-saving transitions.
- Changing timezone preserves the intended local schedule after confirmation.
- Early and backfilled doses connect to the correct event.

### Health acceptance

- Readings can be created, edited, deleted, filtered, exported, and reported.
- mg/dL and mmol/L values preserve precision.
- Unusual values require confirmation without producing clinical advice.
- Time-in-range figures appear only when the user has entered target ranges and are labeled as measured against personal settings.
- Reports identify missing or sparse data rather than implying completeness.

### Report acceptance

- The user can generate 30-day, 3-month, 6-month, 1-year, all-time, and custom-range reports.
- Summary and complete reports use the same source data and date boundaries.
- A complete report includes individual readings and dose-event appendices.
- The report preview works on desktop and mobile.
- PDF charts, tables, page numbers, headers, and date ranges render without overlap or clipping.
- The downloaded filename identifies the profile and date range without including the optional doctor name.
- Generating a report does not leave a permanent PDF on the server.

### Restore acceptance

- A backup can be restored to a separate database.
- The application can start against the restored database.
- Medication, dose, inventory, and reading history reconcile after restoration.

## 20. Railway deployment

1. Push the repository to GitHub and connect it to a Railway project.
2. Deploy one persistent web service and one Postgres service.
3. Keep the first release at one web replica.
4. Configure a health check and graceful shutdown.
5. Run database migrations before the application deployment becomes active.
6. Enable Postgres backups or point-in-time recovery.
7. Configure a custom subdomain such as `t2d.jefflouella.com`.
8. Verify HTTPS, manifest identity, service-worker scope, and push subscription on the custom domain.

### Environment variables

```text
DATABASE_URL
SESSION_SECRET
APP_URL
RESEND_API_KEY
FROM_EMAIL
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
SCHEDULER_INTERVAL_SECONDS
SCHEDULER_CATCHUP_HOURS
SCHEDULER_STALE_NOTIFY_MINUTES
LOW_STOCK_DIGEST_LOCAL_HOUR
REGISTRATION_MODE
LOG_LEVEL
```

The scheduler interval controls how often the persistent service checks Postgres. Railway cron is suitable for coarse maintenance jobs, but it is not the minute-sensitive medication reminder mechanism.

## 21. Product success measures

The first release succeeds when:

- A new user can add a medication, schedule, and working reminder in under 5 minutes.
- A scheduled dose can be logged from Today in one primary action.
- Inventory can be reconciled without deleting history.
- Scheduled reminders survive a deployment without being lost or duplicated.
- Any preset doctor report can be previewed and produced without manual cleanup.
- The user can explain every stock change from the ledger.
- A restore test proves that the data can be recovered.

Useful operating metrics:

- Onboarding completion rate
- Successful test-push rate by platform
- Reminder delivery success and permanent failure rate
- Duplicate delivery count
- Dose events left pending past their window
- Inventory reconciliation frequency
- Report and export usage
- Scheduler delay from due time to send attempt

Do not turn these into clinical adherence claims without appropriate study design and validation.

## 22. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Household-owned medication mixes multiple people | Incorrect reminders, privacy mistakes, unusable history | Person-owned profiles and explicit access |
| Double logging corrupts stock | User stops trusting the app | Idempotency keys and transactional ledger writes |
| Deployment misses the exact reminder minute | Dose reminder never arrives | Scheduler checkpoint and catch-up query |
| Multiple processes send the same reminder | Notification fatigue and confusion | Advisory lock plus unique delivery key |
| Weekly or irregular schedule breaks days-supply math | Incorrect refill timing | Forecast from schedule occurrences |
| Fixed-dose assumptions fail for sliding-scale insulin | Wrong supply forecasts and daily logging friction | Variable dose entry mode with trailing-average forecast |
| Stale reminder burst after an outage | Notification fatigue and lost trust | Staleness window that advances old events silently |
| Permanent invite code leaks | Unauthorized access | Hashed, expiring, revocable invitation tokens |
| Push permission or endpoint silently fails | User relies on reminders that do not arrive | Test push, device health, and visible warnings |
| Sensitive lock-screen content is exposed | Privacy breach | Per-user private preview |
| Sparse readings look clinically meaningful | False confidence | Data-count labels and no automated interpretation |
| Railway database is not recoverable | Permanent data loss | Backups, documented retention, and restore test |
| Scope grows into a clinical product | Safety and regulatory risk | Explicit non-goals and human-entered care settings |
| Mobile-first implementation weakens desktop use | Reports, tables, and history become frustrating on larger screens | Desktop-specific layouts and responsive acceptance tests |

## 23. Post-MVP ideas

- Flexible interval, monthly, taper, and cycle schedules
- Refill requested, ready, picked-up, and cancelled workflow
- Appointment reminders
- Caregiver notification after an unresolved missed dose
- Symptom, illness, and exercise event notes
- Import from CGM, glucose-meter, Apple Health, or Health Connect sources where technically available
- Barcode-assisted medication entry with user confirmation
- Medication-container model for multi-dose pens and vials
- Optional prescription-document attachment with encrypted storage
- Home-screen widget or badge showing outstanding dose events
- Read-only clinician share link with expiration and explicit consent
- Calendar view for adherence and reading history
- Correlation views that place doses and readings on the same timeline without claiming causation

## 24. Explicitly deferred ideas

- Drug interaction checking
- Dose recommendations
- Automated clinical alerts
- Automatic estimated A1C from manual readings
- AI-generated health interpretation
- Pharmacy ordering
- Insurance coverage management
- Public household discovery or permanent shared codes
- Notification action buttons as a required workflow
- Consumption-rate learning as the primary stock calculation

These features either increase safety risk, require more reliable external data, or distract from building a trustworthy daily record.

## 25. Reference notes

- [ADA Standards of Care in Diabetes, 2026, diabetes technology](https://diabetesjournals.org/care/article/49/Supplement_1/S150/163922/7-Diabetes-Technology-Standards-of-Care-in)
- [RxTerms drug interface terminology, NLM](https://lhncbc.nlm.nih.gov/MOR/RxTerms)
- [RxTerms autocomplete API, NLM Clinical Table Search Service](https://clinicaltables.nlm.nih.gov/apidoc/rxterms/v3/doc.html)
- [RxNorm overview, NLM](https://www.nlm.nih.gov/research/umls/rxnorm/index.html)
- [Apple medication logging and follow-up reminder behavior](https://support.apple.com/en-us/105064)
- [WebKit web push requirements for iOS and iPadOS Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Railway cron, worker, and queue tradeoffs](https://docs.railway.com/guides/cron-workers-queues)
- [Railway backup guidance](https://docs.railway.com/volumes/backups)
- [Railway point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery)
- [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
