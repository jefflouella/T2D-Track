import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { hashToken, randomToken } from '../crypto.js';
import { config } from '../config.js';
import { HttpError } from '../util.js';
import { writeAudit } from './audit.js';
import { sendEmail } from './email.js';

const SESSION_DAYS = 30;
const TOKEN_HOURS = 24;

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId) {
  const raw = randomToken();
  const tokenHash = hashToken(raw);
  const expiresAt = DateTime.utc().plus({ days: SESSION_DAYS }).toJSDate();
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, lastSeenAt: new Date() },
  });
  return { raw, expiresAt };
}

export async function revokeSessionByRawToken(raw) {
  if (!raw) return;
  const tokenHash = hashToken(raw);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function loadUserFromSessionToken(raw) {
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });
  return { user: session.user, session };
}

export async function canRegister() {
  if (config.REGISTRATION_MODE === 'open') return true;
  if (config.REGISTRATION_MODE === 'invite_only') return false;
  const count = await prisma.user.count();
  return count === 0;
}

export async function registerUser({ name, email, password, timezone, glucoseUnit, weightUnit }) {
  const allowed = await canRegister();
  if (!allowed) {
    throw new HttpError(403, 'Registration is closed. An invitation is required.');
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new HttpError(409, 'Email already registered');

  const passwordHash = await hashPassword(password);
  const tz = timezone || 'America/New_York';

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
      },
    });

    const household = await tx.household.create({
      data: {
        name: `${name}'s household`,
        defaultTimezone: tz,
      },
    });

    await tx.householdMembership.create({
      data: {
        householdId: household.id,
        userId: user.id,
        role: 'owner',
      },
    });

    const profile = await tx.personProfile.create({
      data: {
        householdId: household.id,
        linkedUserId: user.id,
        displayName: name,
        timezone: tz,
        glucoseUnit: glucoseUnit || 'mg_dL',
        weightUnit: weightUnit || 'lb',
        createdByUserId: user.id,
      },
    });

    await tx.profileAccess.create({
      data: {
        personProfileId: profile.id,
        userId: user.id,
        permission: 'owner',
      },
    });

    await tx.notificationPreference.create({
      data: { userId: user.id },
    });

    await tx.profileNotificationSetting.create({
      data: {
        userId: user.id,
        personProfileId: profile.id,
      },
    });

    return { user, household, profile };
  });

  await writeAudit({
    householdId: result.household.id,
    personProfileId: result.profile.id,
    actorUserId: result.user.id,
    action: 'user.registered',
    entityType: 'User',
    entityId: result.user.id,
    summary: 'Account created with initial household and profile',
  });

  await issueEmailVerification(result.user);
  return result;
}

export async function issueEmailVerification(user) {
  const raw = randomToken();
  await prisma.accountToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      purpose: 'verify_email',
      expiresAt: DateTime.utc().plus({ hours: TOKEN_HOURS }).toJSDate(),
    },
  });
  const link = `${config.APP_URL}/verify-email?token=${raw}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your T2D Track email',
    text: `Verify your email: ${link}`,
    html: `<p>Verify your email by opening this link:</p><p><a href="${link}">${link}</a></p>`,
  });
  return raw;
}

export async function verifyEmailToken(raw) {
  const tokenHash = hashToken(raw);
  const token = await prisma.accountToken.findUnique({ where: { tokenHash } });
  if (!token || token.purpose !== 'verify_email' || token.usedAt || token.expiresAt < new Date()) {
    throw new HttpError(400, 'Invalid or expired verification token');
  }
  await prisma.$transaction([
    prisma.accountToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);
}

export async function loginUser(email, password, totpCode) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new HttpError(401, 'Invalid email or password');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  if (user.totpEnabledAt) {
    if (!totpCode) {
      const err = new HttpError(401, 'Authenticator code required');
      err.details = { requiresTotp: true };
      throw err;
    }
    const { verifyTotp } = await import('./totp.js');
    if (!verifyTotp(user.totpSecret, totpCode)) {
      throw new HttpError(401, 'Invalid authenticator code');
    }
  }
  const session = await createSession(user.id);
  return { user, session };
}

export async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return;
  const raw = randomToken();
  await prisma.accountToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      purpose: 'password_reset',
      expiresAt: DateTime.utc().plus({ hours: TOKEN_HOURS }).toJSDate(),
    },
  });
  const link = `${config.APP_URL}/recovery?token=${raw}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your T2D Track password',
    text: `Reset your password: ${link}`,
    html: `<p>Reset your password:</p><p><a href="${link}">${link}</a></p>`,
  });
}

export async function completePasswordReset(raw, newPassword) {
  const tokenHash = hashToken(raw);
  const token = await prisma.accountToken.findUnique({ where: { tokenHash } });
  if (!token || token.purpose !== 'password_reset' || token.usedAt || token.expiresAt < new Date()) {
    throw new HttpError(400, 'Invalid or expired recovery token');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.accountToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash },
    }),
    prisma.session.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function exportUserData(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      createdAt: true,
      memberships: { include: { household: true } },
      profileAccess: {
        include: {
          personProfile: {
            include: {
              medications: { include: { schedules: true, inventoryTransactions: true } },
              doseEvents: true,
              bloodSugarReadings: true,
              weightReadings: true,
              bloodPressureReadings: true,
              a1cReadings: true,
              healthTargets: true,
            },
          },
        },
      },
      notificationPreference: true,
      pushSubscriptions: {
        select: {
          id: true,
          deviceLabel: true,
          active: true,
          lastSuccessAt: true,
          createdAt: true,
        },
      },
    },
  });
  return user;
}

export async function requestAccountDeletion(userId, notes) {
  return prisma.accountDeleteRequest.create({
    data: { userId, notes: notes || null },
  });
}
