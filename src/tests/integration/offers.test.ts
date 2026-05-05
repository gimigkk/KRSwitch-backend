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

const offererUser = { nim: OFFERER_NIM, name: 'Offerer', email: 'offerer@apps.ipb.ac.id' };
const takerUser   = { nim: TAKER_NIM,   name: 'Taker',   email: 'taker@apps.ipb.ac.id' };

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

  // Default $transaction: autoMatch nggak nemu counter-offer, langsung return matched: false
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
    const tx = buildTxMock();
    tx.barterOffer.findFirst.mockResolvedValue(null);
    return cb(tx);
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
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, status: 'matched', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
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
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, status: 'open', offererNim: TAKER_NIM, myClass: classA, wantedClass: classB, offerer: takerUser } as any);
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
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, status: 'open', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
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
      tx.barterOffer.findUnique.mockResolvedValue({ id: 1, status: 'open', offererNim: OFFERER_NIM, myClass: classA, wantedClass: classB, offerer: offererUser } as any);
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

  it('completes the barter, swaps enrollments, and emits socket events', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = buildTxMock();
      const offer = { id: 1, status: 'open', offererNim: OFFERER_NIM, myClassId: classA.id, wantedClassId: classB.id, myClass: classA, wantedClass: classB, offerer: offererUser };

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

// --- DELETE /api/offers/:id ---

describe('DELETE /api/offers/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/offers/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when offer does not exist', async () => {
    vi.mocked(prisma.barterOffer.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/offers/1')
      .set('Cookie', authCookie());

    expect(res.status).toBe(404);
  });

  it('returns 403 when offer belongs to a different user', async () => {
    vi.mocked(prisma.barterOffer.findUnique).mockResolvedValue({
      id: 1, offererNim: 'M0009999999', status: 'open',
    } as any);

    const res = await request(app)
      .delete('/api/offers/1')
      .set('Cookie', authCookie()); // cookie milik OFFERER_NIM, bukan M0009999999

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your offer/i);
  });

  it('returns 400 when offer is already matched', async () => {
    vi.mocked(prisma.barterOffer.findUnique).mockResolvedValue({
      id: 1, offererNim: OFFERER_NIM, status: 'matched',
    } as any);

    const res = await request(app)
      .delete('/api/offers/1')
      .set('Cookie', authCookie());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot cancel matched offer/i);
  });

  it('cancels the offer and emits offer-taken', async () => {
    vi.mocked(prisma.barterOffer.findUnique).mockResolvedValue({
      id: 1, offererNim: OFFERER_NIM, status: 'open',
    } as any);
    vi.mocked(prisma.barterOffer.update).mockResolvedValue({} as any);

    const res = await request(app)
      .delete('/api/offers/1')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cancelled/i);
    expect(mockIo.emit).toHaveBeenCalledWith('offer-taken', { offerId: 1 });
  });
});