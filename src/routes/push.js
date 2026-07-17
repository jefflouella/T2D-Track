import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../util.js';
import {
  upsertPushSubscription,
  sendTestPush,
  getVapidPublicKey,
} from '../services/push.js';
import { getSchedulerHealth } from '../services/scheduler.js';

const router = Router();

router.get(
  '/vapid-public-key',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  }),
);

router.post(
  '/subscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
        deviceLabel: z.string().optional(),
      })
      .parse(req.body);
    const sub = await upsertPushSubscription(req.user.id, body);
    res.status(201).json({ subscription: { id: sub.id, endpoint: sub.endpoint, active: sub.active } });
  }),
);

router.get(
  '/subscriptions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        deviceLabel: true,
        active: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        failureCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ subscriptions: subs });
  }),
);

router.delete(
  '/subscriptions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sub = await prisma.pushSubscription.findUnique({ where: { id: req.params.id } });
    if (!sub || sub.userId !== req.user.id) throw new HttpError(404, 'Subscription not found');
    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { active: false },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await sendTestPush(req.user.id);
    res.json(result);
  }),
);

router.get(
  '/notification-preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId: req.user.id },
    });
    res.json({ preferences: prefs });
  }),
);

router.put(
  '/notification-preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        dosePushEnabled: z.boolean().optional(),
        lowStockEmailEnabled: z.boolean().optional(),
        caregiverAlertEnabled: z.boolean().optional(),
        privatePreview: z.boolean().optional(),
        quietHoursStart: z.string().optional().nullable(),
        quietHoursEnd: z.string().optional().nullable(),
      })
      .parse(req.body);
    const preferences = await prisma.notificationPreference.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, ...body },
      update: body,
    });
    res.json({ preferences });
  }),
);

router.get(
  '/scheduler-health',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getSchedulerHealth());
  }),
);

export default router;
