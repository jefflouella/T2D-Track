import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generateDoseEventsForProfile, advanceOverdueAndMissed } from './doses.js';
import { buildDosePayload, sendPushToSubscription } from './push.js';
import { sendEmail } from './email.js';
import { enrichMedicationWithSupply } from './medications.js';

const CHECKPOINT = 'dose_scheduler';
const LOCK_KEY = 742091;

async function withAdvisoryLock(fn) {
  const rows = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  const locked = rows[0]?.locked;
  if (!locked) return { skipped: true };
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}

function inQuietHours(prefs, timezone) {
  if (!prefs?.quietHoursStart || !prefs?.quietHoursEnd) return false;
  const now = DateTime.now().setZone(timezone);
  const start = DateTime.fromFormat(prefs.quietHoursStart, 'HH:mm', { zone: timezone }).set({
    year: now.year,
    month: now.month,
    day: now.day,
  });
  let end = DateTime.fromFormat(prefs.quietHoursEnd, 'HH:mm', { zone: timezone }).set({
    year: now.year,
    month: now.month,
    day: now.day,
  });
  if (end <= start) end = end.plus({ days: 1 });
  const cursor = now < start ? now.plus({ days: 1 }) : now;
  return cursor >= start && cursor <= end;
}

export async function runSchedulerTick() {
  return withAdvisoryLock(async () => {
    const now = new Date();
    await prisma.schedulerCheckpoint.upsert({
      where: { name: CHECKPOINT },
      create: {
        name: CHECKPOINT,
        lastSuccessfulAt: DateTime.utc().minus({ hours: config.SCHEDULER_CATCHUP_HOURS }).toJSDate(),
        lastStartedAt: now,
      },
      update: { lastStartedAt: now, lastErrorCode: null },
    });

    const checkpoint = await prisma.schedulerCheckpoint.findUnique({
      where: { name: CHECKPOINT },
    });
    const from = checkpoint.lastSuccessfulAt;
    const catchupEnd = DateTime.fromJSDate(now).plus({ hours: 1 }).toJSDate();

    const profiles = await prisma.personProfile.findMany();
    for (const profile of profiles) {
      await generateDoseEventsForProfile(profile.id, from, catchupEnd);
    }
    await advanceOverdueAndMissed(now);

    const staleBefore = DateTime.fromJSDate(now)
      .minus({ minutes: config.SCHEDULER_STALE_NOTIFY_MINUTES })
      .toJSDate();

    const dueEvents = await prisma.doseEvent.findMany({
      where: {
        status: { in: ['pending', 'snoozed'] },
        scheduledFor: { gte: from, lte: now },
      },
      include: {
        medication: true,
        schedule: true,
        personProfile: {
          include: {
            access: { include: { user: { include: { notificationPreference: true, pushSubscriptions: true } } } },
          },
        },
      },
    });

    let notified = 0;
    let suppressedStale = 0;

    for (const event of dueEvents) {
      if (event.scheduledFor < staleBefore) {
        suppressedStale += 1;
        continue;
      }

      for (const access of event.personProfile.access) {
        if (access.permission === 'view') continue;
        const user = access.user;
        const prefs = user.notificationPreference;
        const profileSetting = await prisma.profileNotificationSetting.findUnique({
          where: {
            userId_personProfileId: {
              userId: user.id,
              personProfileId: event.personProfileId,
            },
          },
        });
        const doseEnabled =
          profileSetting?.dosePushEnabled ?? prefs?.dosePushEnabled ?? true;
        if (!doseEnabled) continue;

        const subs = (user.pushSubscriptions || []).filter((s) => s.active);
        for (const sub of subs) {
          const dedupeKey = `dose_due:${event.id}:${sub.id}`;
          try {
            const delivery = await prisma.notificationDelivery.create({
              data: {
                userId: user.id,
                pushSubscriptionId: sub.id,
                doseEventId: event.id,
                medicationId: event.medicationId,
                channel: 'push',
                type: 'dose_due',
                dedupeKey,
                status: 'pending',
              },
            });

            const payload = buildDosePayload({
              medication: event.medication,
              schedule: event.schedule,
              privatePreview: prefs?.privatePreview,
            });
            const result = await sendPushToSubscription(sub, payload);
            await prisma.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: result.ok || result.skipped ? 'sent' : 'failed',
                sentAt: result.ok || result.skipped ? new Date() : null,
                attemptCount: { increment: 1 },
                lastErrorCode: result.statusCode ? String(result.statusCode) : null,
              },
            });
            if (result.ok || result.skipped) notified += 1;
          } catch (err) {
            if (err.code === 'P2002') continue;
            logger.error('scheduler.delivery_error', { error: err.message, doseEventId: event.id });
          }
        }
      }
    }

    await maybeSendCaregiverMissedAlerts(now);
    await maybeSendLowStockDigests(now);

    await prisma.schedulerCheckpoint.update({
      where: { name: CHECKPOINT },
      data: { lastSuccessfulAt: now, lastErrorCode: null },
    });

    logger.info('scheduler.tick', { notified, suppressedStale, due: dueEvents.length });
    return { notified, suppressedStale, due: dueEvents.length };
  });
}

async function maybeSendCaregiverMissedAlerts(now) {
  const recentlyMissed = await prisma.doseEvent.findMany({
    where: {
      status: 'missed',
      updatedAt: { gte: DateTime.fromJSDate(now).minus({ hours: 2 }).toJSDate() },
    },
    include: {
      medication: true,
      personProfile: {
        include: {
          access: {
            include: {
              user: {
                include: {
                  notificationPreference: true,
                  profileNotificationSettings: true,
                  pushSubscriptions: true,
                },
              },
            },
          },
        },
      },
    },
  });

  for (const event of recentlyMissed) {
    for (const access of event.personProfile.access) {
      const user = access.user;
      const profileSetting = user.profileNotificationSettings?.find(
        (s) => s.personProfileId === event.personProfileId,
      );
      const enabled =
        profileSetting?.caregiverAlertEnabled ||
        user.notificationPreference?.caregiverAlertEnabled;
      if (!enabled) continue;
      if (access.permission === 'owner' && user.id === event.loggedByUserId) continue;

      const prefs = user.notificationPreference;
      if (inQuietHours(prefs, event.personProfile.timezone)) continue;

      const dedupeKey = `caregiver_missed:${event.id}:${user.id}`;
      try {
        await prisma.notificationDelivery.create({
          data: {
            userId: user.id,
            doseEventId: event.id,
            medicationId: event.medicationId,
            channel: 'email',
            type: 'caregiver_missed',
            dedupeKey,
            status: 'pending',
          },
        });
      } catch (err) {
        if (err.code === 'P2002') continue;
        throw err;
      }

      await sendEmail({
        to: user.email,
        subject: `Missed dose: ${event.personProfile.displayName}`,
        text: `${event.personProfile.displayName} has a missed dose of ${event.medication.name}.`,
        html: `<p><strong>${event.personProfile.displayName}</strong> has a missed dose of <strong>${event.medication.name}</strong>.</p>`,
      });
      await prisma.notificationDelivery.update({
        where: { dedupeKey },
        data: { status: 'sent', sentAt: new Date(), attemptCount: 1 },
      });
    }
  }
}

async function maybeSendLowStockDigests(now) {
  const profiles = await prisma.personProfile.findMany({
    include: {
      medications: { where: { status: 'active' }, include: { schedules: true } },
      access: {
        include: {
          user: { include: { notificationPreference: true } },
        },
      },
    },
  });

  for (const profile of profiles) {
    const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(profile.timezone);
    if (local.hour !== config.LOW_STOCK_DIGEST_LOCAL_HOUR || local.minute > 2) continue;

    const low = [];
    for (const med of profile.medications) {
      const enriched = await enrichMedicationWithSupply(med, profile.timezone);
      if (['refill_soon', 'urgent_refill', 'out', 'needs_reconciliation'].includes(enriched.supply.stockState)) {
        low.push({ name: med.name, state: enriched.supply.stockState, days: enriched.supply.estimatedDays });
      }
    }
    if (!low.length) continue;

    for (const access of profile.access) {
      const user = access.user;
      const prefs = user.notificationPreference;
      if (!prefs?.lowStockEmailEnabled) continue;
      if (inQuietHours(prefs, profile.timezone)) continue;

      const dedupeKey = `low_stock:${user.id}:${local.toISODate()}`;
      try {
        await prisma.notificationDelivery.create({
          data: {
            userId: user.id,
            channel: 'email',
            type: 'low_stock',
            dedupeKey,
            status: 'pending',
          },
        });
      } catch (err) {
        if (err.code === 'P2002') continue;
        throw err;
      }

      const lines = low.map((m) => `- ${m.name}: ${m.state}${m.days != null ? ` (~${m.days} days)` : ''}`);
      await sendEmail({
        to: user.email,
        subject: 'T2D Track low-stock digest',
        text: `Low-stock medications:\n${lines.join('\n')}`,
        html: `<p>Low-stock medications:</p><ul>${low.map((m) => `<li>${m.name}: ${m.state}</li>`).join('')}</ul>`,
      });

      await prisma.notificationDelivery.update({
        where: { dedupeKey },
        data: { status: 'sent', sentAt: new Date(), attemptCount: 1 },
      });
    }
  }
}

export function startScheduler() {
  const intervalMs = config.SCHEDULER_INTERVAL_SECONDS * 1000;
  logger.info('scheduler.started', { intervalSeconds: config.SCHEDULER_INTERVAL_SECONDS });
  const timer = setInterval(() => {
    runSchedulerTick().catch((err) => {
      logger.error('scheduler.tick_failed', { error: err.message });
      prisma.schedulerCheckpoint
        .upsert({
          where: { name: CHECKPOINT },
          create: {
            name: CHECKPOINT,
            lastSuccessfulAt: new Date(0),
            lastErrorCode: err.message,
          },
          update: { lastErrorCode: err.message },
        })
        .catch(() => {});
    });
  }, intervalMs);
  runSchedulerTick().catch((err) => logger.error('scheduler.initial_failed', { error: err.message }));
  return timer;
}

export async function getSchedulerHealth() {
  const checkpoint = await prisma.schedulerCheckpoint.findUnique({ where: { name: CHECKPOINT } });
  const pending = await prisma.notificationDelivery.count({ where: { status: 'pending' } });
  const failed = await prisma.notificationDelivery.count({ where: { status: 'failed' } });
  const inactivePush = await prisma.pushSubscription.count({ where: { active: false } });
  return {
    lastSuccessfulAt: checkpoint?.lastSuccessfulAt || null,
    lastStartedAt: checkpoint?.lastStartedAt || null,
    lastErrorCode: checkpoint?.lastErrorCode || null,
    pendingDeliveries: pending,
    failedDeliveries: failed,
    inactivePushSubscriptions: inactivePush,
  };
}
