import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireViewAccess, requireManageAccess, assertDoseEventAccess, assertMedicationAccess } from '../middleware/auth.js';
import { asyncHandler, serializeDoseEvent, serializeInventoryTxn } from '../util.js';
import {
  getTodayBoard,
  markTaken,
  markSkipped,
  snoozeDose,
  undoDoseAction,
  logAsNeededDose,
} from '../services/doses.js';

const router = Router();

router.get(
  '/profiles/:profileId/today',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const board = await getTodayBoard(req.params.profileId, req.query.date);
    res.json({
      date: board.date,
      timezone: board.timezone,
      groups: {
        dueNow: board.groups.dueNow.map(serializeDoseEvent),
        upcoming: board.groups.upcoming.map(serializeDoseEvent),
        overdue: board.groups.overdue.map(serializeDoseEvent),
        completed: board.groups.completed.map(serializeDoseEvent),
        skipped: board.groups.skipped.map(serializeDoseEvent),
      },
    });
  }),
);

router.get(
  '/profiles/:profileId/dose-events',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const where = { personProfileId: req.params.profileId };
    if (req.query.from || req.query.to) {
      where.scheduledFor = {};
      if (req.query.from) where.scheduledFor.gte = new Date(req.query.from);
      if (req.query.to) where.scheduledFor.lte = new Date(req.query.to);
    }
    if (req.query.status) where.status = req.query.status;
    const events = await prisma.doseEvent.findMany({
      where,
      include: { medication: true, schedule: true },
      orderBy: { scheduledFor: 'desc' },
      take: 100,
    });
    res.json({ events: events.map(serializeDoseEvent) });
  }),
);

router.post(
  '/dose-events/:id/taken',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertDoseEventAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        amountTaken: z.union([z.string(), z.number()]).optional(),
        takenAt: z.string().optional(),
        injectionSite: z.string().optional(),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
        allowNegativeStock: z.boolean().optional(),
      })
      .parse(req.body || {});
    const result = await markTaken({
      doseEventId: req.params.id,
      userId: req.user.id,
      ...body,
    });
    res.json({
      event: serializeDoseEvent(result.event),
      inventoryTransaction: serializeInventoryTxn(result.inventoryTransaction),
    });
  }),
);

router.post(
  '/dose-events/:id/skipped',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertDoseEventAccess(req.user.id, req.params.id, 'manage');
    const body = z.object({ notes: z.string().optional() }).parse(req.body || {});
    const event = await markSkipped({
      doseEventId: req.params.id,
      userId: req.user.id,
      notes: body.notes,
    });
    res.json({ event: serializeDoseEvent(event) });
  }),
);

router.post(
  '/dose-events/:id/snooze',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertDoseEventAccess(req.user.id, req.params.id, 'manage');
    const body = z.object({ minutes: z.number().int().positive().optional() }).parse(req.body || {});
    const event = await snoozeDose({
      doseEventId: req.params.id,
      userId: req.user.id,
      minutes: body.minutes,
    });
    res.json({ event: serializeDoseEvent(event) });
  }),
);

router.put(
  '/dose-events/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertDoseEventAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        notes: z.string().optional().nullable(),
        takenAt: z.string().optional().nullable(),
        amountTaken: z.union([z.string(), z.number()]).optional().nullable(),
        injectionSite: z.string().optional().nullable(),
      })
      .parse(req.body || {});
    const event = await prisma.doseEvent.update({
      where: { id: req.params.id },
      data: {
        notes: body.notes,
        takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
        amountTaken: body.amountTaken != null ? body.amountTaken : undefined,
        injectionSite: body.injectionSite,
        loggedByUserId: req.user.id,
      },
      include: { medication: true, schedule: true },
    });
    res.json({ event: serializeDoseEvent(event) });
  }),
);

router.post(
  '/dose-events/:id/undo',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertDoseEventAccess(req.user.id, req.params.id, 'manage');
    const event = await undoDoseAction({
      doseEventId: req.params.id,
      userId: req.user.id,
    });
    res.json({ event: serializeDoseEvent(event) });
  }),
);

router.post(
  '/medications/:id/as-needed-dose',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        amountTaken: z.union([z.string(), z.number()]).optional(),
        takenAt: z.string().optional(),
        injectionSite: z.string().optional(),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
        allowNegativeStock: z.boolean().optional(),
      })
      .parse(req.body || {});
    const result = await logAsNeededDose({
      medicationId: req.params.id,
      userId: req.user.id,
      ...body,
    });
    res.status(201).json({
      event: serializeDoseEvent(result.event),
      inventoryTransaction: serializeInventoryTxn(result.inventoryTransaction),
    });
  }),
);

export default router;
