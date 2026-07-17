import { prisma } from '../db.js';

export async function writeAudit({
  householdId,
  personProfileId,
  actorUserId,
  action,
  entityType,
  entityId,
  summary,
  metadata,
}) {
  return prisma.auditEvent.create({
    data: {
      householdId,
      personProfileId: personProfileId || null,
      actorUserId: actorUserId || null,
      action,
      entityType,
      entityId,
      summary,
      metadata: metadata || undefined,
    },
  });
}
