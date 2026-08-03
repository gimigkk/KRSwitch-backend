import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';
import { prisma, buildTxMock } from '../mocks/db';
import { mockIo, resetIoMocks } from '../mocks/io';

vi.mock('../../prisma/db', () => ({ prisma }));

import { createTestApp } from '../createTestApp';

// --- Fixtures ---

const JWT_SECRET  = process.env.JWT_SECRET!;
const OFFERER_NIM = 'M0001111111';
const TAKER_NIM   = 'M0002222222';

const offererUser = { nim: OFFERER_NIM, name: 'Offerer', email: 'offerer@apps.ipb.ac.id', role: 'student' };
const takerUser   = { nim: TAKER_NIM,   name: 'Taker',   email: 'taker@apps.ipb.ac.id', role: 'student' };

const classA = { id: 10, courseCode: 'CS101', classCode: 'K01', day: 'Monday',  timeStart: '08:00', timeEnd: '10:00' };
const classB = { id: 20, courseCode: 'CS101', classCode: 'K02', day: 'Tuesday', timeStart: '10:00', timeEnd: '12:00' };

function authCookie(user = offererUser) {
  const token = jwt.sign(user, JWT_SECRET);
  return `token=${token}`;
}

// --- Setup ---

let app: Application;

beforeEach(async () => {
  Object.values(prisma).forEach(model => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach(fn => { if (vi.isMockFunction(fn)) fn.mockReset(); });
    }
  });
  resetIoMocks();

  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as any);

  vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);

  // Default $transaction: autoMatch nggak nemu counter-offer, langsung return matched: false
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
    return cb(prisma);
  });

  app = await createTestApp();
});

// --- GET /api/offers ---

describe('GET /api/offers', () => {
  it('returns 401 without auth cookie', async () => {
    const res = await request(app).get('/api/offers');
    expect(res.status).toBe(401);
  });

  it('returns list of open offers', async () => {
    const offers = [{ id: 1, status: 'open', offererNim: OFFERER_NIM }];
    vi.mocked(prisma.barterOffer.findMany).mockResolvedValue(offers as any);

    const res = await request(app).get('/api/offers').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(offers);
  });
});

// --- POST /api/offers ---

describe('POST /api/offers', () => {
  const validBody = { myClassId: classA.id, wantedClassId: classB.id };

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/offers').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when myClassId === wantedClassId (Zod refine)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send({ myClassId: 10, wantedClassId: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when offerer is not enrolled in myClass', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enrolled/i);
  });

  it('returns 400 when offerer already has an open offer for myClass', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue({ id: 99, status: 'open' } as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have an open offer/i);
  });

  it('returns 404 when myClass does not exist in DB', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(classB as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(404);
  });

  it('returns 400 when myClass and wantedClass are from different courses', async () => {
    const differentCourse = { ...classB, courseCode: 'MATH200' };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(differentCourse as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same course/i);
  });

  it('returns 400 when class types do not match (K vs P)', async () => {
    const practiceClass = { ...classB, classCode: 'P01' };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(practiceClass as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same type/i);
  });

  it('returns 400 when the wanted class schedule conflicts with an existing enrollment', async () => {
    const overlappingEnrollment = {
      parallelClassId: 30,
      parallelClass: { id: 30, courseCode: 'MATH200', classCode: 'K01', day: 'Tuesday', timeStart: '09:00', timeEnd: '11:00' },
    };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(classB as any);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([overlappingEnrollment] as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/jadwal bentrok/i);
  });

  it('creates offer, emits new-offer, returns 201 with autoMatched: false', async () => {
    const createdOffer = { id: 1, offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, status: 'open' };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(classB as any);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.barterOffer.create).mockResolvedValue(createdOffer as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.offer).toMatchObject({ id: 1 });
    expect(res.body.autoMatched).toBe(false);
    expect(mockIo.emit).toHaveBeenCalledWith('new-offer', createdOffer);
  });

  it('returns 400 when offerer is already enrolled in the wanted class', async () => {
    const existingEnrollment = {
      nim: OFFERER_NIM,
      parallelClassId: classB.id,
      parallelClass: classB,
    };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(classB as any);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([existingEnrollment] as any);

    const res = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/jadwal bentrok/i);
  });
});

// --- POST /api/offers/:id/take ---

describe('POST /api/offers/:id/take', () => {
  const validBody = { takerNim: TAKER_NIM };

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/offers/1/take').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when takerNim format is invalid', async () => {
    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send({ takerNim: 'INVALID' });

    expect(res.status).toBe(400);
  });

  it('returns 500 when offer does not exist', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue(null);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/999/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 500 when offer is already taken/matched', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, type: 'swap', wantedClassId: classB.id, status: 'matched', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/already taken/i);
  });

  it('returns 500 when taker tries to take their own offer', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, type: 'swap', wantedClassId: classB.id, status: 'open', offererNim: TAKER_NIM, myClass: classA, wantedClass: classB, offerer: takerUser } as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie(takerUser))
      .send({ takerNim: TAKER_NIM });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/own offer/i);
  });

  it('returns 500 when offerer is no longer enrolled in their class', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, type: 'swap', wantedClassId: classB.id, status: 'open', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ nim: TAKER_NIM, parallelClassId: classB.id });
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/no longer has this class/i);
  });

  it('returns 500 when taker is not enrolled in the wanted class', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, type: 'swap', wantedClassId: classB.id, status: 'open', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id })
        .mockResolvedValueOnce(null);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not enrolled in the wanted class/i);
  });

  it('returns 500 when taking the offer causes a schedule conflict for the taker', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'swap', status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, myClass: classA, wantedClass: classB, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id })
        .mockResolvedValueOnce({ nim: TAKER_NIM,   parallelClassId: classB.id });
      tx.user.findUnique.mockResolvedValue(takerUser as any);
      
      const conflictingClass = { id: 30, courseCode: 'MATH200', classCode: 'K01', day: 'Monday', timeStart: '08:30', timeEnd: '10:30' };
      tx.enrollment.findMany.mockResolvedValueOnce([{ parallelClass: conflictingClass }] as any); // takerOtherEnrollments
      tx.enrollment.findMany.mockResolvedValueOnce([]); // offererOtherEnrollments

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/jadwal bentrok/i);
  });

  it('completes the barter, auto-cancels dangling stale offers, and emits socket events', async () => {
    const offererStaleOpenOffers = [
      { id: 99, offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, status: 'open', wantedClass: classB, myClass: classA },
    ];

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'swap', status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, myClass: classA, wantedClass: classB, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id })
        .mockResolvedValueOnce({ nim: TAKER_NIM,   parallelClassId: classB.id });
      tx.user.findUnique.mockResolvedValue(takerUser as any);
      tx.enrollment.findMany.mockResolvedValue([]);
      tx.barterOffer.update.mockResolvedValue({});
      tx.enrollment.updateMany.mockResolvedValue({});
      
      tx.barterOffer.findMany.mockResolvedValueOnce(offererStaleOpenOffers as any); // offerer stale offers
      tx.barterOffer.findMany.mockResolvedValueOnce([]); // taker stale offers

      tx.notification.create.mockResolvedValue({ id: 10 });

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/barter completed/i);
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken', expect.objectContaining({ offerId: 1 }));
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken', expect.objectContaining({ offerId: 99 }));
    expect(mockIo.to).toHaveBeenCalledWith(`user-${OFFERER_NIM}`);
  });

  it('completes the barter, swaps enrollments, and emits socket events', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'swap', status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, myClass: classA, wantedClass: classB, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id })
        .mockResolvedValueOnce({ nim: TAKER_NIM,   parallelClassId: classB.id });
      tx.user.findUnique.mockResolvedValue(takerUser as any);
      tx.enrollment.findMany.mockResolvedValue([]);
      tx.barterOffer.update.mockResolvedValue({});
      tx.enrollment.updateMany.mockResolvedValue({});
      tx.barterOffer.findMany.mockResolvedValue([]);
      tx.notification.create.mockResolvedValue({ id: 10 });

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie())
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/barter completed/i);
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken',         expect.objectContaining({ offerId: 1 }));
    expect(mockIo.emit).toHaveBeenCalledWith('enrollments-swapped', expect.objectContaining({ swaps: expect.any(Array) }));
    expect(mockIo.to).toHaveBeenCalledWith(`user-${OFFERER_NIM}`);
    expect(mockIo.to).toHaveBeenCalledWith(`user-${TAKER_NIM}`);
  });
});

// --- POST /api/offers/pick-drop ---

describe('POST /api/offers/pick-drop', () => {
  const validOpenBody = { myClassId: classA.id };
  const validTargetedBody = { myClassId: classA.id, reservedForNim: TAKER_NIM };

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/offers/pick-drop').send(validOpenBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when offerer is not enrolled in myClass', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send(validOpenBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enrolled/i);
  });

  it('returns 400 when reservedForNim format is invalid', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send({ myClassId: classA.id, reservedForNim: 'INVALID_NIM' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when offerer already has an open offer for myClass', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue({ id: 99, status: 'open' } as any);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send(validOpenBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already have an open offer/i);
  });

  it('creates open pick_drop offer (reservedForNim = null) and emits new-offer', async () => {
    const createdOffer = {
      id: 10,
      type: 'pick_drop',
      offererNim: OFFERER_NIM,
      myClassId: classA.id,
      wantedClassId: null,
      reservedForNim: null,
      status: 'open',
      myClass: classA,
    };

    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(classA as any);
    vi.mocked(prisma.barterOffer.create).mockResolvedValue(createdOffer as any);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send(validOpenBody);

    expect(res.status).toBe(201);
    expect(res.body.offer).toMatchObject({ id: 10, type: 'pick_drop' });
    expect(mockIo.emit).toHaveBeenCalledWith('new-offer', createdOffer);
  });

  it('creates targeted pick_drop offer with valid targetNim', async () => {
    const createdOffer = {
      id: 11,
      type: 'pick_drop',
      offererNim: OFFERER_NIM,
      myClassId: classA.id,
      wantedClassId: null,
      reservedForNim: TAKER_NIM,
      status: 'open',
      myClass: classA,
    };

    vi.mocked(prisma.enrollment.findFirst)
      .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id } as any)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(classA as any);
    vi.mocked(prisma.user.findUnique).mockImplementation(async (args: any) => {
      if (args.where?.email === offererUser.email || args.where?.nim === OFFERER_NIM) return offererUser as any;
      if (args.where?.email === takerUser.email || args.where?.nim === TAKER_NIM) return takerUser as any;
      return { isActive: true } as any;
    });
    vi.mocked(prisma.barterOffer.create).mockResolvedValue(createdOffer as any);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send(validTargetedBody);

    expect(res.status).toBe(201);
    expect(res.body.offer).toMatchObject({ id: 11, reservedForNim: TAKER_NIM });
  });

  it('returns 404 when myClassId does not exist in DB', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: 999 } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send({ myClassId: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/class not found/i);
  });

  it('returns 400 when attempting to reserve for oneself (targetNim === offererNim)', async () => {
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(classA as any);

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send({ myClassId: classA.id, reservedForNim: OFFERER_NIM });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot reserve for yourself/i);
  });

  it('returns 400 when targeted student NIM does not exist in DB', async () => {
    const UNKNOWN_NIM = 'M0009999999';
    vi.mocked(prisma.enrollment.findFirst).mockResolvedValue({ nim: OFFERER_NIM, parallelClassId: classA.id } as any);
    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(classA as any);
    vi.mocked(prisma.user.findUnique).mockImplementation(async (args: any) => {
      if (args.where?.email === offererUser.email || args.where?.nim === OFFERER_NIM) return offererUser as any;
      return null;
    });

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send({ myClassId: classA.id, reservedForNim: UNKNOWN_NIM });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target student with NIM .* not found/i);
  });

  it('returns 400 when targeted student is already enrolled in a class of the same course', async () => {
    vi.mocked(prisma.enrollment.findFirst)
      .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id } as any) // offerer enrollment check
      .mockResolvedValueOnce({ nim: TAKER_NIM, parallelClassId: classB.id } as any); // target enrollment check

    vi.mocked(prisma.barterOffer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue(classA as any);
    vi.mocked(prisma.user.findUnique).mockImplementation(async (args: any) => {
      if (args.where?.email === offererUser.email || args.where?.nim === OFFERER_NIM) return offererUser as any;
      if (args.where?.email === takerUser.email || args.where?.nim === TAKER_NIM) return takerUser as any;
      return { isActive: true } as any;
    });

    const res = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie())
      .send(validTargetedBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sudah terdaftar/i);
  });
});

// --- POST /api/offers/:id/claim ---

describe('POST /api/offers/:id/claim', () => {
  const claimerUser = takerUser;
  const CLAIMER_NIM = TAKER_NIM;
  const validClaimBody = { claimerNim: CLAIMER_NIM };

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/offers/1/claim').send(validClaimBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when claimerNim format is invalid', async () => {
    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send({ claimerNim: 'INVALID_NIM' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 500 when offer does not exist', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      tx.barterOffer.findUnique.mockResolvedValue(null);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/999/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 500 when offer status is not open (e.g. matched or cancelled)', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', status: 'matched', offererNim: OFFERER_NIM, myClass: classA, offerer: offererUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/already taken or cancelled/i);
  });

  it('returns 500 when offer is not of type pick_drop', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'swap', status: 'open', offererNim: OFFERER_NIM, myClass: classA, offerer: offererUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not a Pick & Drop/i);
  });

  it('returns 500 when offerer is the claimer', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', status: 'open', offererNim: CLAIMER_NIM, myClass: classA, offerer: claimerUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/own offer/i);
  });

  it('returns 500 when targeted pick_drop offer is claimed by a different NIM', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: 'M0003333333', status: 'open', offererNim: OFFERER_NIM, myClass: classA, offerer: offererUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/dikhususkan/i);
  });

  it('returns 500 when offerer no longer has the class', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findMany.mockResolvedValueOnce([]); // offerer not enrolled anymore
      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/no longer has this course package/i);
  });

  it('returns 500 when claimer is already enrolled in a class of the same course', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };
      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findMany.mockResolvedValueOnce([{ id: 1, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA }]);
      tx.enrollment.findFirst.mockResolvedValue({ nim: CLAIMER_NIM, parallelClassId: classA.id, parallelClass: classA }); // claimer already enrolled in classA

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/sudah mengambil/i);
  });

  it('returns 500 when claimer has a schedule conflict with the claimed class', async () => {
    const conflictingClass = { id: 99, courseCode: 'CS102', classCode: 'K01', day: 'Monday', timeStart: '08:00', timeEnd: '10:00' };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst.mockResolvedValue(null);
      tx.user.findUnique.mockResolvedValue(claimerUser as any);
      tx.enrollment.findMany
        .mockResolvedValueOnce([{ id: 50, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA }])
        .mockResolvedValueOnce([{ id: 80, nim: CLAIMER_NIM, parallelClassId: 99, parallelClass: conflictingClass }] as any);

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/jadwal bentrok/i);
  });

  it('returns 500 when claimer has a schedule conflict with a secondary class in the bundle', async () => {
    const conflictingClass = { id: 99, courseCode: 'CS102', classCode: 'K01', day: 'Tuesday', timeStart: '14:00', timeEnd: '16:00' };
    const secondaryClassInBundle = { id: 2, courseCode: classA.courseCode, classCode: 'P01', day: 'Tuesday', timeStart: '13:00', timeEnd: '15:00' };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst.mockResolvedValue(null);
      tx.user.findUnique.mockResolvedValue(claimerUser as any);
      tx.enrollment.findMany
        .mockResolvedValueOnce([
          { id: 50, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA },
          { id: 51, nim: OFFERER_NIM, parallelClassId: secondaryClassInBundle.id, parallelClass: secondaryClassInBundle }
        ])
        .mockResolvedValueOnce([{ id: 80, nim: CLAIMER_NIM, parallelClassId: 99, parallelClass: conflictingClass }] as any);

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/jadwal bentrok/i);
  });

  it('returns 500 when atomic update fails due to concurrent claim (updateMany count === 0)', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst.mockResolvedValue(null);
      tx.user.findUnique.mockResolvedValue(claimerUser as any);
      tx.enrollment.findMany
        .mockResolvedValueOnce([{ id: 50, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA }])
        .mockResolvedValueOnce([]);
      tx.barterOffer.updateMany.mockResolvedValue({ count: 0 }); // Concurrent transaction won race

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/already taken or matched concurrently/i);
  });

  it('successfully claims a targeted pick_drop offer when claimed by the designated reservedForNim', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: CLAIMER_NIM, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst.mockResolvedValue(null);
      tx.user.findUnique.mockResolvedValue(claimerUser as any);
      tx.enrollment.findMany
        .mockResolvedValueOnce([{ id: 50, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      tx.barterOffer.updateMany.mockResolvedValue({ count: 1 });
      tx.enrollment.deleteMany.mockResolvedValue({});
      tx.enrollment.createMany.mockResolvedValue({});
      tx.barterOffer.findMany.mockResolvedValue([]);
      tx.notification.create.mockResolvedValue({ id: 10, type: 'barter_matched_as_offerer', data: {} });

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    if (res.status !== 200) console.error('TEST 5 FAILED:', res.body);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/claimed/i);
  });

  it('successfully claims an open pick_drop offer, auto-cancels offerer stale offers, and emits socket events', async () => {
    const staleOffer = { id: 88, myClassId: classA.id, wantedClassId: classB.id, offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'pick_drop', reservedForNim: null, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, myClass: classA, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst.mockResolvedValue(null);
      tx.user.findUnique.mockResolvedValue(claimerUser as any);
      tx.enrollment.findMany
        .mockResolvedValueOnce([{ id: 50, nim: OFFERER_NIM, parallelClassId: classA.id, parallelClass: classA }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      tx.barterOffer.updateMany.mockResolvedValue({ count: 1 });
      tx.enrollment.deleteMany.mockResolvedValue({});
      tx.enrollment.createMany.mockResolvedValue({});

      // Mock offerer stale offers cancellation
      tx.barterOffer.findMany.mockResolvedValue([staleOffer as any]);
      tx.notification.create.mockResolvedValue({ id: 10, type: 'barter_matched_as_offerer', data: {} });

      return cb(tx);
    });

    const res = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(claimerUser))
      .send(validClaimBody);

    if (res.status !== 200) console.error('TEST 6 FAILED:', res.body);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/claimed/i);
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken', { offerId: 1 });
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken', { offerId: 88 });
    expect(mockIo.to).toHaveBeenCalledWith(`user-${OFFERER_NIM}`);
  });
});

describe('High-Concurrency and Race Condition Hardening Tests', () => {
  it('prevents concurrent takes of the same offer (race condition)', async () => {
    let callCount = 0;

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, type: 'swap', status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, myClass: classA, wantedClass: classB, offerer: offererUser };

      tx.barterOffer.findUnique.mockResolvedValue(offer as any);
      tx.enrollment.findFirst
        .mockResolvedValueOnce({ nim: OFFERER_NIM, parallelClassId: classA.id })
        .mockResolvedValueOnce({ nim: TAKER_NIM,   parallelClassId: classB.id });
      tx.user.findUnique.mockResolvedValue(takerUser as any);
      tx.enrollment.findMany.mockResolvedValue([]);
      tx.enrollment.updateMany.mockResolvedValue({});
      tx.barterOffer.findMany.mockResolvedValue([]);
      tx.notification.create.mockResolvedValue({ id: 10 });

      // First call succeeds (count: 1), second call fails (count: 0) to simulate concurrent lock acquisition
      tx.barterOffer.updateMany.mockImplementation(async () => {
        callCount++;
        return { count: callCount === 1 ? 1 : 0 };
      });

      return cb(tx);
    });

    const validTakeBody = { takerNim: TAKER_NIM };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/offers/1/take').set('Cookie', authCookie()).send(validTakeBody),
      request(app).post('/api/offers/1/take').set('Cookie', authCookie()).send(validTakeBody),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 500]);

    const errors = [res1.body.error, res2.body.error];
    expect(errors).toContain('Offer already taken or matched concurrently by another user');
  });

  it('prevents duplicate open offer creation from user spamming (double-click lock)', async () => {
    let callCount = 0;
    const createdOffer = { id: 1, offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, status: 'open' };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      
      tx.enrollment.findFirst.mockResolvedValue({ nim: OFFERER_NIM } as any);
      
      // Simulate transaction serialization: first check finds nothing, second check finds the duplicate created by first transaction
      tx.barterOffer.findFirst.mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? null : createdOffer;
      });

      // Dynamic parallel class mock lookup depending on the queried ID
      tx.parallelClass.findUnique.mockImplementation(async ({ where }) => {
        return where.id === classA.id ? classA : classB;
      });
      
      tx.enrollment.findMany.mockResolvedValue([]);
      tx.barterOffer.create.mockResolvedValue(createdOffer as any);

      return cb(tx);
    });

    // Mock prisma.parallelClass.findUnique for the outer scope call
    vi.mocked(prisma.parallelClass.findUnique)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(classB as any)
      .mockResolvedValueOnce(classA as any)
      .mockResolvedValueOnce(classB as any);

    const validCreateBody = { myClassId: classA.id, wantedClassId: classB.id };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/offers').set('Cookie', authCookie()).send(validCreateBody),
      request(app).post('/api/offers').set('Cookie', authCookie()).send(validCreateBody),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 400]);

    const errors = [res1.body.error, res2.body.error];
    expect(errors).toContain('You already have an open offer for this class');
  });
});