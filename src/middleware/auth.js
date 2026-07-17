import { prisma } from '../db.js';
import { HttpError } from '../util.js';

const PERMISSION_RANK = { view: 1, manage: 2, owner: 3 };

export async function getProfileAccess(userId, profileId) {
  return prisma.profileAccess.findUnique({
    where: {
      personProfileId_userId: {
        personProfileId: profileId,
        userId,
      },
    },
  });
}

export function requirePermission(access, minPermission) {
  if (!access) throw new HttpError(403, 'Profile access denied');
  if (PERMISSION_RANK[access.permission] < PERMISSION_RANK[minPermission]) {
    throw new HttpError(403, 'Insufficient profile permission');
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  return next();
}

export function requireManageAccess(paramName = 'profileId') {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Authentication required');
      const profileId = req.params[paramName] || req.body?.personProfileId || req.query?.profileId;
      if (!profileId) throw new HttpError(400, 'Profile id required');
      const access = await getProfileAccess(req.user.id, profileId);
      requirePermission(access, 'manage');
      req.profileAccess = access;
      req.profileId = profileId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireViewAccess(paramName = 'profileId') {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Authentication required');
      const profileId = req.params[paramName] || req.query?.profileId;
      if (!profileId) throw new HttpError(400, 'Profile id required');
      const access = await getProfileAccess(req.user.id, profileId);
      requirePermission(access, 'view');
      req.profileAccess = access;
      req.profileId = profileId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function assertMedicationAccess(userId, medicationId, minPermission = 'manage') {
  const medication = await prisma.medication.findUnique({
    where: { id: medicationId },
    include: { personProfile: true },
  });
  if (!medication) throw new HttpError(404, 'Medication not found');
  const access = await getProfileAccess(userId, medication.personProfileId);
  requirePermission(access, minPermission);
  return { medication, access };
}

export async function assertDoseEventAccess(userId, doseEventId, minPermission = 'manage') {
  const event = await prisma.doseEvent.findUnique({
    where: { id: doseEventId },
    include: {
      medication: true,
      schedule: true,
      personProfile: true,
    },
  });
  if (!event) throw new HttpError(404, 'Dose event not found');
  const access = await getProfileAccess(userId, event.personProfileId);
  requirePermission(access, minPermission);
  return { event, access };
}

export async function assertReadingAccess(userId, reading, minPermission = 'manage') {
  if (!reading) throw new HttpError(404, 'Reading not found');
  const access = await getProfileAccess(userId, reading.personProfileId);
  requirePermission(access, minPermission);
  return access;
}
