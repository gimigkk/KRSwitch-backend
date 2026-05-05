import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasScheduleConflict, cancelStaleOffers } from '../../controllers/offerController';
import { buildTxMock, type TxMock } from '../mocks/db';

// --- hasScheduleConflict ---
// Fungsi murni, cek overlap jadwal dua kelas

describe('hasScheduleConflict', () => {
  const mon8to10  = { day: 'Monday', timeStart: '08:00', timeEnd: '10:00' };
  const mon9to11  = { day: 'Monday', timeStart: '09:00', timeEnd: '11:00' };
  const mon10to12 = { day: 'Monday', timeStart: '10:00', timeEnd: '12:00' };
  const mon11to13 = { day: 'Monday', timeStart: '11:00', timeEnd: '13:00' };
  const mon8to12  = { day: 'Monday', timeStart: '08:00', timeEnd: '12:00' };
  const tue8to10  = { day: 'Tuesday', timeStart: '08:00', timeEnd: '10:00' };

  it('returns false for classes on different days', () => {
    expect(hasScheduleConflict(mon8to10, tue8to10)).toBe(false);
  });

  it('returns false when A ends exactly when B starts (adjacent, no overlap)', () => {
    expect(hasScheduleConflict(mon8to10, mon10to12)).toBe(false);
  });

  it('returns false when B ends exactly when A starts', () => {
    expect(hasScheduleConflict(mon10to12, mon8to10)).toBe(false);
  });

  it('returns false when A is entirely before B with a gap', () => {
    expect(hasScheduleConflict(mon8to10, mon11to13)).toBe(false);
  });

  it('returns false when B is entirely before A with a gap', () => {
    expect(hasScheduleConflict(mon11to13, mon8to10)).toBe(false);
  });

  it('returns true for partial overlap — A starts during B', () => {
    expect(hasScheduleConflict(mon9to11, mon8to10)).toBe(true);
  });

  it('returns true for partial overlap — B starts during A', () => {
    expect(hasScheduleConflict(mon8to10, mon9to11)).toBe(true);
  });

  it('returns true when A fully contains B', () => {
    expect(hasScheduleConflict(mon8to12, mon9to11)).toBe(true);
  });

  it('returns true for identical schedules', () => {
    expect(hasScheduleConflict(mon8to10, { ...mon8to10 })).toBe(true);
  });
});

// --- cancelStaleOffers ---
// Batalkan offer yang tidak relevan lagi setelah enrollment berubah

describe('cancelStaleOffers', () => {
  const classA = { id: 10, courseCode: 'CS101', classCode: 'K01', day: 'Monday',  timeStart: '08:00', timeEnd: '10:00' };
  const classB = { id: 20, courseCode: 'CS102', classCode: 'K01', day: 'Monday',  timeStart: '10:00', timeEnd: '12:00' };
  const classC = { id: 30, courseCode: 'CS103', classCode: 'K01', day: 'Monday',  timeStart: '09:00', timeEnd: '11:00' }; // konflik dengan classA

  let tx: TxMock;

  beforeEach(() => {
    tx = buildTxMock();
  });

  it('returns empty array when the user has no open offers', async () => {
    tx.barterOffer.findMany.mockResolvedValue([]);

    const result = await cancelStaleOffers('M0001234567', [], 10, tx);

    expect(result).toEqual([]);
    expect(tx.barterOffer.update).not.toHaveBeenCalled();
  });

  it('cancels an offer whose myClassId equals lostClassId with reason no_longer_enrolled', async () => {
    const openOffer = { id: 1, myClassId: 10, wantedClassId: 20, myClass: classA, wantedClass: classB };
    tx.barterOffer.findMany.mockResolvedValue([openOffer]);
    tx.barterOffer.update.mockResolvedValue({});

    const result = await cancelStaleOffers('M0001234567', [classB], 10, tx);

    expect(tx.barterOffer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data:  { status: 'cancelled' },
    });
    expect(result).toEqual([{
      offerId:       1,
      reason:        'no_longer_enrolled',
      myClassId:     10,
      wantedClassId: 20,
    }]);
  });

  it('cancels an offer whose wantedClass conflicts with the new schedule', async () => {
    // classC (09:00-11:00) konflik dengan classA (08:00-10:00) di hari yang sama
    const openOffer = { id: 2, myClassId: 20, wantedClassId: 30, myClass: classB, wantedClass: classC };
    tx.barterOffer.findMany.mockResolvedValue([openOffer]);
    tx.barterOffer.update.mockResolvedValue({});

    const result = await cancelStaleOffers('M0001234567', [classA], 99, tx);

    expect(result[0].reason).toBe('schedule_conflict');
    expect(result[0].conflictingClass).toBe('CS101-K01');
    expect(result[0].offerId).toBe(2);
  });

  it('does not cancel an offer with no conflicts', async () => {
    const openOffer = { id: 3, myClassId: 20, wantedClassId: 30, myClass: classB, wantedClass: classB };
    tx.barterOffer.findMany.mockResolvedValue([openOffer]);

    const result = await cancelStaleOffers('M0001234567', [classA], 99, tx);

    expect(tx.barterOffer.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('handles a mix of no_longer_enrolled, schedule_conflict, and safe offers', async () => {
    const lostOffer     = { id: 1, myClassId: 10, wantedClassId: 20, myClass: classA, wantedClass: classB };
    const conflictOffer = { id: 2, myClassId: 20, wantedClassId: 30, myClass: classB, wantedClass: classC };
    const safeOffer     = { id: 3, myClassId: 20, wantedClassId: 20, myClass: classB, wantedClass: classB };

    tx.barterOffer.findMany.mockResolvedValue([lostOffer, conflictOffer, safeOffer]);
    tx.barterOffer.update.mockResolvedValue({});

    const result = await cancelStaleOffers('M0001234567', [classA], 10, tx);

    expect(result).toHaveLength(2);
    expect(result[0].reason).toBe('no_longer_enrolled');
    expect(result[1].reason).toBe('schedule_conflict');
    expect(tx.barterOffer.update).toHaveBeenCalledTimes(2);
  });
});