-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'member', 'caregiver');

-- CreateEnum
CREATE TYPE "ProfilePermission" AS ENUM ('owner', 'manage', 'view');

-- CreateEnum
CREATE TYPE "InvitationRole" AS ENUM ('member', 'caregiver');

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('verify_email', 'password_reset');

-- CreateEnum
CREATE TYPE "GlucoseUnit" AS ENUM ('mg_dL', 'mmol_L');

-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('lb', 'kg');

-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('active', 'paused', 'stopped');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('daily', 'weekly', 'as_needed');

-- CreateEnum
CREATE TYPE "DoseEntryMode" AS ENUM ('fixed', 'variable');

-- CreateEnum
CREATE TYPE "DoseEventStatus" AS ENUM ('pending', 'snoozed', 'taken', 'skipped', 'missed');

-- CreateEnum
CREATE TYPE "DoseEventSource" AS ENUM ('app', 'notification', 'backfill', 'import');

-- CreateEnum
CREATE TYPE "InventoryKind" AS ENUM ('opening', 'dose', 'refill', 'adjustment', 'waste', 'reversal');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('push', 'email');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('dose_due', 'dose_follow_up', 'low_stock', 'caregiver_missed');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "BloodSugarContext" AS ENUM ('fasting', 'before_meal', 'after_meal', 'bedtime', 'exercise', 'illness', 'random', 'other');

-- CreateEnum
CREATE TYPE "BloodPressureContext" AS ENUM ('morning', 'evening', 'resting', 'before_exercise', 'after_exercise', 'illness', 'other');

-- CreateEnum
CREATE TYPE "HealthMetricType" AS ENUM ('blood_sugar', 'systolic', 'diastolic', 'weight', 'a1c');

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_timezone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_memberships" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_profiles" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "linked_user_id" TEXT,
    "display_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "timezone" TEXT NOT NULL,
    "glucose_unit" "GlucoseUnit" NOT NULL,
    "weight_unit" "WeightUnit" NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "onboarding_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_access" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission" "ProfilePermission" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" "InvitationRole" NOT NULL,
    "person_profile_id" TEXT,
    "permission" "ProfilePermission",
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rxcui" TEXT,
    "form" TEXT,
    "strength_value" DECIMAL(18,6),
    "strength_unit" TEXT,
    "stock_unit" TEXT NOT NULL,
    "default_units_per_dose" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "track_injection_site" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "refill_threshold_days" INTEGER NOT NULL DEFAULT 7,
    "refill_lead_time_days" INTEGER NOT NULL DEFAULT 3,
    "pharmacy" TEXT,
    "prescription_number" TEXT,
    "refills_remaining" INTEGER,
    "refill_eligible_on" DATE,
    "prescriber" TEXT,
    "notes" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "status" "MedicationStatus" NOT NULL DEFAULT 'active',
    "current_stock_cache" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "replaced_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "label" TEXT,
    "schedule_type" "ScheduleType" NOT NULL,
    "time_of_day" TEXT,
    "days_of_week" TEXT[],
    "dose_entry" "DoseEntryMode" NOT NULL DEFAULT 'fixed',
    "units_per_dose" DECIMAL(18,6),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "grace_period_minutes" INTEGER NOT NULL DEFAULT 120,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_events" (
    "id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "person_profile_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "local_scheduled_date" DATE,
    "status" "DoseEventStatus" NOT NULL DEFAULT 'pending',
    "snoozed_until" TIMESTAMP(3),
    "taken_at" TIMESTAMP(3),
    "amount_taken" DECIMAL(18,6),
    "injection_site" TEXT,
    "logged_by_user_id" TEXT,
    "source" "DoseEventSource" NOT NULL DEFAULT 'app',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dose_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "dose_event_id" TEXT,
    "kind" "InventoryKind" NOT NULL,
    "quantity_delta" DECIMAL(18,6) NOT NULL,
    "balance_after" DECIMAL(18,6) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "reverses_transaction_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dose_push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "low_stock_email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "caregiver_alert_enabled" BOOLEAN NOT NULL DEFAULT false,
    "private_preview" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_notification_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "dose_push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "caregiver_alert_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device_label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "push_subscription_id" TEXT,
    "dose_event_id" TEXT,
    "medication_id" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_sugar_readings" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unit" "GlucoseUnit" NOT NULL,
    "context" "BloodSugarContext" NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blood_sugar_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_readings" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unit" "WeightUnit" NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weight_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_pressure_readings" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse" INTEGER,
    "context" "BloodPressureContext" NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blood_pressure_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "a1c_readings" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "value_percent" DECIMAL(18,6) NOT NULL,
    "taken_at" DATE NOT NULL,
    "laboratory" TEXT,
    "notes" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "a1c_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_targets" (
    "id" TEXT NOT NULL,
    "person_profile_id" TEXT NOT NULL,
    "metric_type" "HealthMetricType" NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'any',
    "low_value" DECIMAL(18,6),
    "high_value" DECIMAL(18,6),
    "unit" TEXT NOT NULL,
    "label" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "person_profile_id" TEXT,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_checkpoints" (
    "name" TEXT NOT NULL,
    "last_successful_at" TIMESTAMP(3) NOT NULL,
    "last_started_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_checkpoints_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "account_delete_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "account_delete_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_tokens_user_id_purpose_idx" ON "account_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_memberships_household_id_user_id_key" ON "household_memberships"("household_id", "user_id");

-- CreateIndex
CREATE INDEX "person_profiles_household_id_idx" ON "person_profiles"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_access_person_profile_id_user_id_key" ON "profile_access"("person_profile_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "medications_person_profile_id_status_idx" ON "medications"("person_profile_id", "status");

-- CreateIndex
CREATE INDEX "medication_schedules_medication_id_active_idx" ON "medication_schedules"("medication_id", "active");

-- CreateIndex
CREATE INDEX "dose_events_person_profile_id_scheduled_for_idx" ON "dose_events"("person_profile_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "dose_events_status_scheduled_for_idx" ON "dose_events"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "dose_events_schedule_id_scheduled_for_key" ON "dose_events"("schedule_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_idempotency_key_key" ON "inventory_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_transactions_medication_id_occurred_at_idx" ON "inventory_transactions"("medication_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_notification_settings_user_id_person_profile_id_key" ON "profile_notification_settings"("user_id", "person_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_active_idx" ON "push_subscriptions"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key_key" ON "notification_deliveries"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_created_at_idx" ON "notification_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "blood_sugar_readings_person_profile_id_taken_at_idx" ON "blood_sugar_readings"("person_profile_id", "taken_at");

-- CreateIndex
CREATE INDEX "weight_readings_person_profile_id_taken_at_idx" ON "weight_readings"("person_profile_id", "taken_at");

-- CreateIndex
CREATE INDEX "blood_pressure_readings_person_profile_id_taken_at_idx" ON "blood_pressure_readings"("person_profile_id", "taken_at");

-- CreateIndex
CREATE INDEX "a1c_readings_person_profile_id_taken_at_idx" ON "a1c_readings"("person_profile_id", "taken_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_targets_person_profile_id_metric_type_context_key" ON "health_targets"("person_profile_id", "metric_type", "context");

-- CreateIndex
CREATE INDEX "audit_events_household_id_created_at_idx" ON "audit_events"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "account_delete_requests_user_id_idx" ON "account_delete_requests"("user_id");

-- AddForeignKey
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_access" ADD CONSTRAINT "profile_access_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_access" ADD CONSTRAINT "profile_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "medication_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_logged_by_user_id_fkey" FOREIGN KEY ("logged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_dose_event_id_fkey" FOREIGN KEY ("dose_event_id") REFERENCES "dose_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_notification_settings" ADD CONSTRAINT "profile_notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_notification_settings" ADD CONSTRAINT "profile_notification_settings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_push_subscription_id_fkey" FOREIGN KEY ("push_subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_dose_event_id_fkey" FOREIGN KEY ("dose_event_id") REFERENCES "dose_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_sugar_readings" ADD CONSTRAINT "blood_sugar_readings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_sugar_readings" ADD CONSTRAINT "blood_sugar_readings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_sugar_readings" ADD CONSTRAINT "blood_sugar_readings_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_readings" ADD CONSTRAINT "weight_readings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_readings" ADD CONSTRAINT "weight_readings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_readings" ADD CONSTRAINT "weight_readings_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "a1c_readings" ADD CONSTRAINT "a1c_readings_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "a1c_readings" ADD CONSTRAINT "a1c_readings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "a1c_readings" ADD CONSTRAINT "a1c_readings_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_targets" ADD CONSTRAINT "health_targets_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_targets" ADD CONSTRAINT "health_targets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_person_profile_id_fkey" FOREIGN KEY ("person_profile_id") REFERENCES "person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_delete_requests" ADD CONSTRAINT "account_delete_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
