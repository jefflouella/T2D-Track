import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDaysOfSupply, deriveStockState } from '../src/services/supplyEstimate.js';
import { toDecimal } from '../src/util.js';
import { scheduleOccursOnLocalDate } from '../src/services/doses.js';
import { DateTime } from 'luxon';
import { computeTimeInRange } from '../src/services/health.js';

describe('supplyEstimate', () => {
  it('estimates daily supply from schedule', () => {
    const result = estimateDaysOfSupply({
      medication: {
        currentStockCache: 30,
        status: 'active',
        defaultUnitsPerDose: 1,
        refillThresholdDays: 7,
        refillLeadTimeDays: 3,
      },
      schedules: [
        {
          active: true,
          scheduleType: 'daily',
          doseEntry: 'fixed',
          unitsPerDose: 1,
        },
      ],
      timezone: 'America/New_York',
    });
    assert.equal(result.estimatedDays, 30);
    assert.equal(result.stockState, 'available');
  });

  it('estimates weekly supply without fractional daily rate bugs', () => {
    const result = estimateDaysOfSupply({
      medication: {
        currentStockCache: 8,
        status: 'active',
        defaultUnitsPerDose: 1,
        refillThresholdDays: 7,
        refillLeadTimeDays: 3,
      },
      schedules: [
        {
          active: true,
          scheduleType: 'weekly',
          doseEntry: 'fixed',
          unitsPerDose: 1,
          daysOfWeek: ['mon', 'thu'],
        },
      ],
      timezone: 'America/New_York',
    });
    // 2 doses/week => 2/7 per day => 8 / (2/7) = 28 days
    assert.equal(result.estimatedDays, 28);
  });

  it('uses trailing average for variable dose', () => {
    const result = estimateDaysOfSupply({
      medication: {
        currentStockCache: 100,
        status: 'active',
        defaultUnitsPerDose: 10,
        refillThresholdDays: 7,
        refillLeadTimeDays: 3,
      },
      schedules: [
        {
          active: true,
          scheduleType: 'daily',
          doseEntry: 'variable',
          unitsPerDose: null,
        },
      ],
      timezone: 'UTC',
      recentAmounts: [8, 12, 10],
    });
    assert.equal(result.basis, 'trailing_average');
    assert.equal(result.estimatedDays, 10);
  });

  it('marks negative stock for reconciliation', () => {
    assert.equal(
      deriveStockState({
        stock: toDecimal(-1),
        estimatedDays: 0,
        refillThresholdDays: 7,
        refillLeadTimeDays: 3,
      }),
      'needs_reconciliation',
    );
  });
});

describe('schedules', () => {
  it('matches weekly days across local dates', () => {
    const schedule = {
      active: true,
      scheduleType: 'weekly',
      daysOfWeek: ['mon', 'wed'],
      startDate: new Date('2026-01-01'),
      endDate: null,
    };
    const monday = DateTime.fromISO('2026-07-13', { zone: 'America/New_York' });
    const tuesday = DateTime.fromISO('2026-07-14', { zone: 'America/New_York' });
    assert.equal(scheduleOccursOnLocalDate(schedule, monday), true);
    assert.equal(scheduleOccursOnLocalDate(schedule, tuesday), false);
  });
});

describe('health summaries', () => {
  it('computes time-in-range against personal settings', () => {
    const tir = computeTimeInRange(
      [{ value: 100 }, { value: 140 }, { value: 180 }],
      { lowValue: 80, highValue: 140 },
    );
    assert.equal(tir.inRange, 2);
    assert.equal(tir.total, 3);
    assert.equal(tir.percent, 66.7);
  });

  it('returns null without targets', () => {
    assert.equal(computeTimeInRange([{ value: 100 }], null), null);
  });
});
