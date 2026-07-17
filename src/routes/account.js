import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireViewAccess, getProfileAccess, requirePermission } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { exportUserData, requestAccountDeletion } from '../services/auth.js';
import { writeAudit } from '../services/audit.js';

const router = Router();

router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await exportUserData(req.user.id);
    res.json(data);
  }),
);

router.post(
  '/delete-request',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ notes: z.string().max(2000).optional() }).parse(req.body || {});
    const row = await requestAccountDeletion(req.user.id, body.notes);
    res.status(201).json(row);
  }),
);

router.get(
  '/households',
  requireAuth,
  asyncHandler(async (req, res) => {
    const memberships = await prisma.householdMembership.findMany({
      where: { userId: req.user.id },
      include: { household: true },
    });
    res.json({ households: memberships.map((m) => ({ ...m.household, role: m.role })) });
  }),
);

router.get(
  '/profiles',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await prisma.profileAccess.findMany({
      where: { userId: req.user.id },
      include: { personProfile: true },
    });
    res.json({
      profiles: access.map((a) => ({
        ...a.personProfile,
        permission: a.permission,
      })),
    });
  }),
);

router.get(
  '/profiles/:profileId',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    res.json({ profile, permission: req.profileAccess.permission });
  }),
);

router.put(
  '/profiles/:profileId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await getProfileAccess(req.user.id, req.params.profileId);
    requirePermission(access, 'manage');
    const body = z
      .object({
        displayName: z.string().min(1).max(120).optional(),
        timezone: z.string().min(1).optional(),
        glucoseUnit: z.enum(['mg_dL', 'mmol_L']).optional(),
        weightUnit: z.enum(['lb', 'kg']).optional(),
        dateOfBirth: z.string().optional().nullable(),
        onboardingCompleted: z.boolean().optional(),
      })
      .parse(req.body);

    const profile = await prisma.personProfile.update({
      where: { id: req.params.profileId },
      data: {
        displayName: body.displayName,
        timezone: body.timezone,
        glucoseUnit: body.glucoseUnit,
        weightUnit: body.weightUnit,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        onboardingCompletedAt: body.onboardingCompleted ? new Date() : undefined,
      },
    });

    await writeAudit({
      householdId: profile.householdId,
      personProfileId: profile.id,
      actorUserId: req.user.id,
      action: 'profile.updated',
      entityType: 'PersonProfile',
      entityId: profile.id,
      summary: 'Updated profile settings',
    });

    res.json({ profile });
  }),
);

router.get(
  '/profiles/:profileId/audit',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    if (!profile) throw new HttpError(404, 'Profile not found');
    const events = await prisma.auditEvent.findMany({
      where: { personProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ events });
  }),
);

export default router;
