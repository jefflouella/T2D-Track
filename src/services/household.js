import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { hashToken, randomToken } from '../crypto.js';
import { HttpError } from '../util.js';
import { writeAudit } from './audit.js';
import { config } from '../config.js';
import { sendEmail } from './email.js';

export async function requireHouseholdOwner(userId, householdId) {
  const membership = await prisma.householdMembership.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!membership || membership.role !== 'owner') {
    throw new HttpError(403, 'Household owner access required');
  }
  return membership;
}

export async function requireHouseholdMember(userId, householdId) {
  const membership = await prisma.householdMembership.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!membership) throw new HttpError(403, 'Not a household member');
  return membership;
}

export async function createProfile({ householdId, userId, data }) {
  await requireHouseholdOwner(userId, householdId);
  const household = await prisma.household.findUnique({ where: { id: householdId } });
  const profile = await prisma.personProfile.create({
    data: {
      householdId,
      displayName: data.displayName,
      timezone: data.timezone || household.defaultTimezone,
      glucoseUnit: data.glucoseUnit || 'mg_dL',
      weightUnit: data.weightUnit || 'lb',
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      createdByUserId: userId,
      linkedUserId: data.linkToSelf ? userId : null,
    },
  });
  await prisma.profileAccess.create({
    data: {
      personProfileId: profile.id,
      userId,
      permission: 'owner',
    },
  });
  await prisma.profileNotificationSetting.create({
    data: { userId, personProfileId: profile.id },
  });
  await writeAudit({
    householdId,
    personProfileId: profile.id,
    actorUserId: userId,
    action: 'profile.created',
    entityType: 'PersonProfile',
    entityId: profile.id,
    summary: `Created profile ${profile.displayName}`,
  });
  return profile;
}

export async function createInvitation({
  householdId,
  userId,
  role,
  personProfileId,
  permission,
  expiresInDays = 7,
  maxUses = 1,
}) {
  await requireHouseholdOwner(userId, householdId);
  if (personProfileId) {
    const profile = await prisma.personProfile.findUnique({ where: { id: personProfileId } });
    if (!profile || profile.householdId !== householdId) {
      throw new HttpError(400, 'Profile must belong to this household');
    }
  }
  const raw = randomToken();
  const invitation = await prisma.invitation.create({
    data: {
      householdId,
      tokenHash: hashToken(raw),
      role,
      personProfileId: personProfileId || null,
      permission: permission || (role === 'caregiver' ? 'view' : 'manage'),
      expiresAt: DateTime.utc().plus({ days: expiresInDays }).toJSDate(),
      maxUses,
      createdByUserId: userId,
    },
  });
  const link = `${config.APP_URL}/invite?token=${raw}`;
  await writeAudit({
    householdId,
    actorUserId: userId,
    action: 'invitation.created',
    entityType: 'Invitation',
    entityId: invitation.id,
    summary: `Created ${role} invitation`,
  });
  return { invitation, rawToken: raw, link };
}

export async function revokeInvitation(invitationId, userId) {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new HttpError(404, 'Invitation not found');
  await requireHouseholdOwner(userId, invitation.householdId);
  return prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });
}

export async function acceptInvitation({ rawToken, userId }) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { household: true },
  });
  if (
    !invitation ||
    invitation.revokedAt ||
    invitation.expiresAt < new Date() ||
    invitation.useCount >= invitation.maxUses
  ) {
    throw new HttpError(400, 'Invitation is invalid, expired, or fully used');
  }

  const existing = await prisma.householdMembership.findUnique({
    where: {
      householdId_userId: { householdId: invitation.householdId, userId },
    },
  });

  await prisma.$transaction(async (tx) => {
    if (!existing) {
      await tx.householdMembership.create({
        data: {
          householdId: invitation.householdId,
          userId,
          role: invitation.role === 'caregiver' ? 'caregiver' : 'member',
        },
      });
    }
    if (invitation.personProfileId) {
      await tx.profileAccess.upsert({
        where: {
          personProfileId_userId: {
            personProfileId: invitation.personProfileId,
            userId,
          },
        },
        create: {
          personProfileId: invitation.personProfileId,
          userId,
          permission: invitation.permission || 'view',
        },
        update: {
          permission: invitation.permission || 'view',
        },
      });
      await tx.profileNotificationSetting.upsert({
        where: {
          userId_personProfileId: {
            userId,
            personProfileId: invitation.personProfileId,
          },
        },
        create: {
          userId,
          personProfileId: invitation.personProfileId,
          caregiverAlertEnabled: invitation.role === 'caregiver',
        },
        update: {},
      });
    }
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { useCount: { increment: 1 } },
    });
  });

  await writeAudit({
    householdId: invitation.householdId,
    personProfileId: invitation.personProfileId,
    actorUserId: userId,
    action: 'invitation.accepted',
    entityType: 'Invitation',
    entityId: invitation.id,
    summary: 'Accepted household invitation',
  });

  return invitation.household;
}

export async function setProfileAccess({ profileId, actorUserId, targetUserId, permission }) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  await requireHouseholdOwner(actorUserId, profile.householdId);

  if (permission === null) {
    await prisma.profileAccess.deleteMany({
      where: { personProfileId: profileId, userId: targetUserId },
    });
    return { removed: true };
  }

  return prisma.profileAccess.upsert({
    where: {
      personProfileId_userId: { personProfileId: profileId, userId: targetUserId },
    },
    create: {
      personProfileId: profileId,
      userId: targetUserId,
      permission,
    },
    update: { permission },
  });
}

export async function removeMember({ householdId, actorUserId, memberUserId }) {
  await requireHouseholdOwner(actorUserId, householdId);
  if (actorUserId === memberUserId) {
    throw new HttpError(400, 'Owner cannot remove themselves; transfer ownership first');
  }
  const membership = await prisma.householdMembership.findUnique({
    where: { householdId_userId: { householdId, userId: memberUserId } },
  });
  if (!membership) throw new HttpError(404, 'Member not found');
  if (membership.role === 'owner') throw new HttpError(400, 'Cannot remove another owner this way');

  const profiles = await prisma.personProfile.findMany({
    where: { householdId },
    select: { id: true },
  });
  const profileIds = profiles.map((p) => p.id);

  await prisma.$transaction([
    prisma.profileAccess.deleteMany({
      where: { userId: memberUserId, personProfileId: { in: profileIds } },
    }),
    prisma.profileNotificationSetting.deleteMany({
      where: { userId: memberUserId, personProfileId: { in: profileIds } },
    }),
    prisma.householdMembership.delete({
      where: { householdId_userId: { householdId, userId: memberUserId } },
    }),
    prisma.session.updateMany({
      where: { userId: memberUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writeAudit({
    householdId,
    actorUserId,
    action: 'member.removed',
    entityType: 'User',
    entityId: memberUserId,
    summary: 'Removed household member and revoked sessions',
  });
}

export async function leaveHousehold({ householdId, userId }) {
  const membership = await requireHouseholdMember(userId, householdId);
  if (membership.role === 'owner') {
    const owners = await prisma.householdMembership.count({
      where: { householdId, role: 'owner' },
    });
    if (owners <= 1) {
      throw new HttpError(400, 'Sole owner cannot leave; delete household or add another owner');
    }
  }
  const profiles = await prisma.personProfile.findMany({
    where: { householdId },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.profileAccess.deleteMany({
      where: { userId, personProfileId: { in: profiles.map((p) => p.id) } },
    }),
    prisma.profileNotificationSetting.deleteMany({
      where: { userId, personProfileId: { in: profiles.map((p) => p.id) } },
    }),
    prisma.householdMembership.delete({
      where: { householdId_userId: { householdId, userId } },
    }),
  ]);
}

export async function getHouseholdDetail(householdId, userId) {
  await requireHouseholdMember(userId, householdId);
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, email: true } } } },
      profiles: {
        include: {
          access: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
      invitations: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  return household;
}

export async function emailInvitationLink(toEmail, link, householdName) {
  await sendEmail({
    to: toEmail,
    subject: `Invitation to ${householdName} on T2D Track`,
    text: `You were invited to join ${householdName} on T2D Track.\n\nAccept: ${link}`,
    html: `<p>You were invited to join <strong>${householdName}</strong> on T2D Track.</p><p><a href="${link}">Accept invitation</a></p>`,
  });
}
