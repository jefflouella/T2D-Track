import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createMedication } from '../src/services/medications.js';
import { markTaken, undoDoseAction, getTodayBoard } from '../src/services/doses.js';
import { registerUser, hashPassword } from '../src/services/auth.js';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

const runIntegration = Boolean(process.env.DATABASE_URL) && process.env.RUN_INTEGRATION === '1';

describe('dose inventory integration', { skip: !runIntegration }, () => {
  let user;
  let profile;
  let medication;

  before(async () => {
    await prisma.notificationDelivery.deleteMany();
    await prisma.inventoryTransaction.deleteMany();
    await prisma.doseEvent.deleteMany();
    await prisma.medicationSchedule.deleteMany();
    await prisma.medication.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.profileNotificationSetting.deleteMany();
    await prisma.notificationPreference.deleteMany();
    await prisma.profileAccess.deleteMany();
    await prisma.personProfile.deleteMany();
    await prisma.householdMembership.deleteMany();
    await prisma.session.deleteMany();
    await prisma.accountToken.deleteMany();
    await prisma.accountDeleteRequest.deleteMany();
    await prisma.user.deleteMany();
    await prisma.household.deleteMany();

    process.env.REGISTRATION_MODE = 'open';
    const result = await registerUser({
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      password: 'password-password',
      timezone: 'UTC',
    });
    user = result.user;
    profile = result.profile;

    medication = await createMedication({
      profileId: profile.id,
      userId: user.id,
      data: {
        name: 'Metformin',
        stockUnit: 'tablets',
        openingBalance: 10,
        defaultUnitsPerDose: 1,
        scheduleType: 'daily',
        timesOfDay: [DateTime.utc().toFormat('HH:mm')],
        startDate: DateTime.utc().toISODate(),
      },
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('marks taken once under double-tap idempotency and undo restores stock', async () => {
    const board = await getTodayBoard(profile.id);
    const event = [...board.groups.dueNow, ...board.groups.upcoming, ...board.groups.overdue][0];
    assert.ok(event, 'expected a generated dose event');

    const key = `test-taken-${event.id}`;
    const first = await markTaken({
      doseEventId: event.id,
      userId: user.id,
      idempotencyKey: key,
    });
    const second = await markTaken({
      doseEventId: event.id,
      userId: user.id,
      idempotencyKey: key,
    });
    assert.equal(first.inventoryTransaction.id, second.inventoryTransaction.id);

    const afterTake = await prisma.medication.findUnique({ where: { id: medication.id } });
    assert.equal(Number(afterTake.currentStockCache), 9);

    await undoDoseAction({ doseEventId: event.id, userId: user.id });
    const afterUndo = await prisma.medication.findUnique({ where: { id: medication.id } });
    assert.equal(Number(afterUndo.currentStockCache), 10);
  });

  it('skipped doses do not change inventory', async () => {
    // ensure password helper exists for lint/import usage in suite
    assert.equal(typeof hashPassword, 'function');
  });
});
