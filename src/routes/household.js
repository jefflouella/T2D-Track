import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../util.js';
import {
  createProfile,
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  setProfileAccess,
  removeMember,
  leaveHousehold,
  getHouseholdDetail,
  emailInvitationLink,
  requireHouseholdOwner,
} from '../services/household.js';

const router = Router();

router.get(
  '/households/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const household = await getHouseholdDetail(req.params.id, req.user.id);
    res.json({ household });
  }),
);

router.put(
  '/households/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireHouseholdOwner(req.user.id, req.params.id);
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        defaultTimezone: z.string().min(1).optional(),
      })
      .parse(req.body);
    const household = await prisma.household.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json({ household });
  }),
);

router.post(
  '/profiles',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        householdId: z.string().min(1),
        displayName: z.string().min(1).max(120),
        timezone: z.string().optional(),
        glucoseUnit: z.enum(['mg_dL', 'mmol_L']).optional(),
        weightUnit: z.enum(['lb', 'kg']).optional(),
        dateOfBirth: z.string().optional().nullable(),
        linkToSelf: z.boolean().optional(),
      })
      .parse(req.body);
    const profile = await createProfile({
      householdId: body.householdId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ profile });
  }),
);

router.get(
  '/profiles/:profileId/access',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    if (!profile) throw new HttpError(404, 'Profile not found');
    await requireHouseholdOwner(req.user.id, profile.householdId);
    const access = await prisma.profileAccess.findMany({
      where: { personProfileId: profile.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.json({ access });
  }),
);

router.put(
  '/profiles/:profileId/access/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        permission: z.enum(['owner', 'manage', 'view']).nullable(),
      })
      .parse(req.body);
    const result = await setProfileAccess({
      profileId: req.params.profileId,
      actorUserId: req.user.id,
      targetUserId: req.params.userId,
      permission: body.permission,
    });
    res.json({ access: result });
  }),
);

router.post(
  '/households/:id/invitations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        role: z.enum(['member', 'caregiver']),
        personProfileId: z.string().optional().nullable(),
        permission: z.enum(['manage', 'view']).optional(),
        expiresInDays: z.number().int().positive().max(30).optional(),
        email: z.string().email().optional(),
      })
      .parse(req.body);
    const { invitation, link } = await createInvitation({
      householdId: req.params.id,
      userId: req.user.id,
      role: body.role,
      personProfileId: body.personProfileId,
      permission: body.permission,
      expiresInDays: body.expiresInDays,
    });
    if (body.email) {
      const household = await prisma.household.findUnique({ where: { id: req.params.id } });
      await emailInvitationLink(body.email, link, household.name);
    }
    res.status(201).json({
      invitation: {
        id: invitation.id,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        personProfileId: invitation.personProfileId,
        permission: invitation.permission,
      },
      link,
    });
  }),
);

router.delete(
  '/invitations/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeInvitation(req.params.id, req.user.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/invitations/:token/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const household = await acceptInvitation({
      rawToken: req.params.token,
      userId: req.user.id,
    });
    res.json({ household });
  }),
);

router.delete(
  '/households/:id/members/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await removeMember({
      householdId: req.params.id,
      actorUserId: req.user.id,
      memberUserId: req.params.userId,
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/households/:id/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    await leaveHousehold({ householdId: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  }),
);

router.get(
  '/profiles/:profileId/notification-settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const setting = await prisma.profileNotificationSetting.findUnique({
      where: {
        userId_personProfileId: {
          userId: req.user.id,
          personProfileId: req.params.profileId,
        },
      },
    });
    res.json({ setting });
  }),
);

router.put(
  '/profiles/:profileId/notification-settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        dosePushEnabled: z.boolean().optional(),
        caregiverAlertEnabled: z.boolean().optional(),
      })
      .parse(req.body);
    const access = await prisma.profileAccess.findUnique({
      where: {
        personProfileId_userId: {
          personProfileId: req.params.profileId,
          userId: req.user.id,
        },
      },
    });
    if (!access) throw new HttpError(403, 'Profile access denied');
    const setting = await prisma.profileNotificationSetting.upsert({
      where: {
        userId_personProfileId: {
          userId: req.user.id,
          personProfileId: req.params.profileId,
        },
      },
      create: {
        userId: req.user.id,
        personProfileId: req.params.profileId,
        ...body,
      },
      update: body,
    });
    res.json({ setting });
  }),
);

export default router;
