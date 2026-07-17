import { prisma } from '../db.js';
import { toDecimal, HttpError } from '../util.js';
import { writeAudit } from './audit.js';
import { randomToken } from '../crypto.js';

async function getBalance(tx, medicationId) {
  const med = await tx.medication.findUnique({ where: { id: medicationId } });
  if (!med) throw new HttpError(404, 'Medication not found');
  return toDecimal(med.currentStockCache);
}

export async function applyInventoryChange({
  medicationId,
  kind,
  quantityDelta,
  occurredAt,
  recordedByUserId,
  doseEventId,
  notes,
  idempotencyKey,
  reversesTransactionId,
  allowNegative = false,
  householdId,
  personProfileId,
}) {
  const key = idempotencyKey || null;
  if (key) {
    const existing = await prisma.inventoryTransaction.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    if (key) {
      const existing = await tx.inventoryTransaction.findUnique({
        where: { idempotencyKey: key },
      });
      if (existing) return existing;
    }

    const balance = await getBalance(tx, medicationId);
    const delta = toDecimal(quantityDelta);
    const next = balance.plus(delta);

    if (next.lt(0) && !allowNegative) {
      throw new HttpError(
        400,
        'Stock would become negative. Confirm reconciliation or adjust the amount.',
        { needsConfirmation: true, currentBalance: balance.toString(), nextBalance: next.toString() },
      );
    }

    const txn = await tx.inventoryTransaction.create({
      data: {
        medicationId,
        doseEventId: doseEventId || null,
        kind,
        quantityDelta: delta,
        balanceAfter: next,
        occurredAt: occurredAt || new Date(),
        recordedByUserId,
        idempotencyKey: key,
        reversesTransactionId: reversesTransactionId || null,
        notes: notes || null,
      },
    });

    await tx.medication.update({
      where: { id: medicationId },
      data: { currentStockCache: next },
    });

    if (householdId) {
      await writeAudit({
        householdId,
        personProfileId,
        actorUserId: recordedByUserId,
        action: `inventory.${kind}`,
        entityType: 'InventoryTransaction',
        entityId: txn.id,
        summary: `${kind} ${delta.toString()} (balance ${next.toString()})`,
      });
    }

    return txn;
  });
}

export async function recordOpeningBalance({
  medicationId,
  quantity,
  recordedByUserId,
  householdId,
  personProfileId,
  notes,
}) {
  return applyInventoryChange({
    medicationId,
    kind: 'opening',
    quantityDelta: quantity,
    recordedByUserId,
    householdId,
    personProfileId,
    notes,
    idempotencyKey: `opening:${medicationId}:${randomToken(8)}`,
  });
}

export async function recordRefill(params) {
  return applyInventoryChange({
    ...params,
    kind: 'refill',
    quantityDelta: params.quantity,
    idempotencyKey: params.idempotencyKey || `refill:${params.medicationId}:${randomToken(8)}`,
  });
}

export async function recordWaste(params) {
  return applyInventoryChange({
    ...params,
    kind: 'waste',
    quantityDelta: toDecimal(params.quantity).neg(),
    allowNegative: params.allowNegative,
    idempotencyKey: params.idempotencyKey || `waste:${params.medicationId}:${randomToken(8)}`,
  });
}

export async function recordManualCount({
  medicationId,
  observedQuantity,
  recordedByUserId,
  householdId,
  personProfileId,
  notes,
  allowNegative = true,
  idempotencyKey,
}) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } });
  if (!med) throw new HttpError(404, 'Medication not found');
  const current = toDecimal(med.currentStockCache);
  const observed = toDecimal(observedQuantity);
  const delta = observed.minus(current);
  return applyInventoryChange({
    medicationId,
    kind: 'adjustment',
    quantityDelta: delta,
    recordedByUserId,
    householdId,
    personProfileId,
    notes: notes || `Manual count: observed ${observed.toString()}`,
    allowNegative,
    idempotencyKey: idempotencyKey || `count:${medicationId}:${randomToken(8)}`,
  });
}

export async function reverseTransaction({
  transactionId,
  recordedByUserId,
  householdId,
  personProfileId,
  notes,
  idempotencyKey,
}) {
  const original = await prisma.inventoryTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!original) throw new HttpError(404, 'Transaction not found');

  const already = await prisma.inventoryTransaction.findFirst({
    where: { reversesTransactionId: transactionId },
  });
  if (already) return already;

  return applyInventoryChange({
    medicationId: original.medicationId,
    kind: 'reversal',
    quantityDelta: toDecimal(original.quantityDelta).neg(),
    recordedByUserId,
    householdId,
    personProfileId,
    notes: notes || `Reversal of ${transactionId}`,
    reversesTransactionId: transactionId,
    allowNegative: true,
    idempotencyKey: idempotencyKey || `reverse:${transactionId}`,
  });
}

export async function rebuildStockCache(medicationId) {
  const sum = await prisma.inventoryTransaction.aggregate({
    where: { medicationId },
    _sum: { quantityDelta: true },
  });
  const balance = toDecimal(sum._sum.quantityDelta || 0);
  await prisma.medication.update({
    where: { id: medicationId },
    data: { currentStockCache: balance },
  });
  return balance;
}
