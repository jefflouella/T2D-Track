import webpush from 'web-push';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

let configured = false;

export function configurePush() {
  if (configured) return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );
    configured = true;
    return true;
  }
  return false;
}

export function getVapidPublicKey() {
  return config.VAPID_PUBLIC_KEY || null;
}

export async function upsertPushSubscription(userId, { endpoint, keys, deviceLabel }) {
  return prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      deviceLabel: deviceLabel || null,
      active: true,
    },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      deviceLabel: deviceLabel || undefined,
      active: true,
      failureCount: 0,
    },
  });
}

export async function sendPushToSubscription(subscription, payload) {
  if (!configurePush()) {
    logger.info('push.skipped', { reason: 'VAPID keys not configured' });
    return { skipped: true };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastSuccessAt: new Date(), failureCount: 0, active: true },
    });
    return { ok: true };
  } catch (err) {
    const statusCode = err.statusCode;
    const permanent = statusCode === 404 || statusCode === 410;
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: {
        lastFailureAt: new Date(),
        failureCount: { increment: 1 },
        active: permanent ? false : undefined,
      },
    });
    logger.warn('push.failed', {
      subscriptionId: subscription.id,
      statusCode,
      permanent,
    });
    return { ok: false, statusCode, permanent };
  }
}

export async function sendTestPush(userId) {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId, active: true },
  });
  if (!subs.length) return { sent: 0, message: 'No active push subscriptions' };
  let sent = 0;
  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, {
      title: 'T2D Track',
      body: 'Test reminder succeeded',
      url: '/today',
    });
    if (result.ok || result.skipped) sent += 1;
  }
  return { sent };
}

export function buildDosePayload({ medication, schedule, privatePreview }) {
  if (privatePreview) {
    return {
      title: 'T2D Track',
      body: 'Medication reminder',
      url: '/today',
    };
  }
  const amount = schedule?.unitsPerDose ?? medication.defaultUnitsPerDose;
  return {
    title: medication.name,
    body: `${schedule?.label || 'Dose'} · ${amount} ${medication.stockUnit}`,
    url: '/today',
  };
}
