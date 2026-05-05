import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTxMock, prisma, type TxMock } from '../mocks/db';

vi.mock('../../prisma/db', () => ({ prisma }));

import { autoMatch } from '../../controllers/offerController';

// --- Fixtures ---

const NIM_OFFERER = 'M0001111111';
const NIM_TAKER   = 'M0002222222';

const classA = { id: 10, courseCode: 'CS101', classCode: 'K01', day: 'Monday',  timeStart: '08:00', timeEnd: '10:00' };
const classB = { id: 20, courseCode: 'CS101', classCode: 'K02', day: 'Tuesday', timeStart: '10:00', timeEnd: '12:00' };

const newOffer = { id: 99, offererNim: NIM_OFFERER, myClassId: classA.id, wantedClassId: classB.id };

const counterOffer = {
  id:            77,
  offererNim:    NIM_TAKER,
  myClassId:     classB.id,
  wantedClassId: classA.id,
  status:        'open',
  myClass:       classB,
  wantedClass:   classA,
  offerer:       { nim: NIM_TAKER, name: 'Taker User' },
};

const newOfferRow = {
  id:            99,
  offererNim:    NIM_OFFERER,
  myClassId:     classA.id,
  wantedClassId: classB.id,
  status:        'open',
  myClass:       classA,
  wantedClass:   classB,
  offerer:       { nim: NIM_OFFERER, name: 'Offerer User' },
};

// --- Helpers ---

function setupHappyPathTx(tx: TxMock) {
  tx.barterOffer.findFirst.mockResolvedValue(counterOffer);
  tx.barterOffer.findUnique.mockResolvedValue(newOfferRow);

  tx.enrollment.findFirst
    .mockResolvedValueOnce({ nim: NIM_TAKER,   parallelClassId: classB.id })
    .mockResolvedValueOnce({ nim: NIM_OFFERER, parallelClassId: classA.id });

  tx.enrollment.findMany.mockResolvedValue([]);
  tx.barterOffer.update.mockResolvedValue({});
  tx.enrollment.updateMany.mockResolvedValue({});
  tx.barterOffer.findMany.mockResolvedValue([]);
  tx.notification.create.mockResolvedValue({ id: 1 });
}

// --- Tests ---

describe('autoMatch', () => {
  let tx: TxMock;

  beforeEach(() => {
    tx = buildTxMock();
    vi.mocked(prisma.$transaction).mockImplementation((cb: any) => cb(tx));
  });

  it('returns { matched: false } when no counter-offer exists', async () => {
    tx.barterOffer.findFirst.mockResolvedValue(null);

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(false);
    expect(tx.barterOffer.update).not.toHaveBeenCalled();
  });

  it('returns { matched: false } when the new offer row is missing (race condition)', async () => {
    tx.barterOffer.findFirst.mockResolvedValue(counterOffer);
    tx.barterOffer.findUnique.mockResolvedValue(null);

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(false);
  });

  it('returns { matched: false } when counter-offerer is no longer enrolled in their class', async () => {
    tx.barterOffer.findFirst.mockResolvedValue(counterOffer);
    tx.barterOffer.findUnique.mockResolvedValue(newOfferRow);
    tx.enrollment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ nim: NIM_OFFERER, parallelClassId: classA.id });

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(false);
  });

  it('returns { matched: false } when new offerer is no longer enrolled in their class', async () => {
    tx.barterOffer.findFirst.mockResolvedValue(counterOffer);
    tx.barterOffer.findUnique.mockResolvedValue(newOfferRow);
    tx.enrollment.findFirst
      .mockResolvedValueOnce({ nim: NIM_TAKER, parallelClassId: classB.id })
      .mockResolvedValueOnce(null);

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(false);
  });

  it('returns { matched: false } when offerer has a schedule conflict with the wanted class', async () => {
    const conflictingClass = {
      id: 30, courseCode: 'CS999', classCode: 'K01',
      day: 'Monday', timeStart: '09:00', timeEnd: '11:00', // tumpang tindih dengan classA
    };

    tx.barterOffer.findFirst.mockResolvedValue(counterOffer);
    tx.barterOffer.findUnique.mockResolvedValue(newOfferRow);
    tx.enrollment.findFirst
      .mockResolvedValueOnce({ nim: NIM_TAKER,   parallelClassId: classB.id })
      .mockResolvedValueOnce({ nim: NIM_OFFERER, parallelClassId: classA.id });
    tx.enrollment.findMany
      .mockResolvedValueOnce([{ parallelClassId: conflictingClass.id, parallelClass: conflictingClass }])
      .mockResolvedValueOnce([]);

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(false);
    expect(tx.barterOffer.update).not.toHaveBeenCalled();
  });

  it('returns full match result and performs all DB writes on a happy path', async () => {
    setupHappyPathTx(tx);

    const result = await autoMatch(newOffer);

    expect(result.matched).toBe(true);

    expect(tx.barterOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: counterOffer.id }, data: expect.objectContaining({ status: 'matched' }) })
    );
    expect(tx.barterOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: newOfferRow.id }, data: expect.objectContaining({ status: 'matched' }) })
    );

    expect(tx.enrollment.updateMany).toHaveBeenCalledWith({
      where: { nim: NIM_TAKER,   parallelClassId: classB.id },
      data:  { parallelClassId: classA.id },
    });
    expect(tx.enrollment.updateMany).toHaveBeenCalledWith({
      where: { nim: NIM_OFFERER, parallelClassId: classA.id },
      data:  { parallelClassId: classB.id },
    });

    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientNim: NIM_TAKER }) })
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientNim: NIM_OFFERER }) })
    );

    expect(result.swaps).toHaveLength(2);
    expect(result.swaps).toContainEqual(
      expect.objectContaining({ nim: NIM_TAKER, oldClassId: classB.id, newClassId: classA.id })
    );
  });
});