import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '../mocks/db';
import { mockIo, resetIoMocks } from '../mocks/io';

vi.mock('../../prisma/db', () => ({ prisma }));

import { createTestApp } from '../createTestApp';
import { isBarterEnabled, setBarterEnabled } from '../../utils/systemConfig';

const JWT_SECRET = process.env.JWT_SECRET!;

const studentUser  = { nim: 'M0403241001', name: 'Student 1',  email: 'student1@apps.ipb.ac.id', role: 'student' };
const operatorUser = { nim: 'ADMIN01',      name: 'Operator',   email: 'operator@apps.ipb.ac.id', role: 'operator' };

function authCookie(user: any) {
  const token = jwt.sign(user, JWT_SECRET);
  return `token=${token}`;
}

let app: any;

describe('Barter System Start/Stop Toggle Integration Tests', () => {
  beforeEach(async () => {
    Object.values(prisma).forEach((model: any) => {
      if (model && typeof model === 'object') {
        Object.values(model).forEach((fn: any) => { if (vi.isMockFunction(fn)) fn.mockReset(); });
      }
    });
    resetIoMocks();

    setBarterEnabled(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as any);
    app = await createTestApp();
  });

  afterEach(() => {
    setBarterEnabled(true);
    vi.clearAllMocks();
  });

  it('GET /api/barter-status returns current barter status for students/public', async () => {
    const res = await request(app).get('/api/barter-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it('GET /api/admin/barter-status returns current barter status for admins', async () => {
    const res = await request(app)
      .get('/api/admin/barter-status')
      .set('Cookie', authCookie(operatorUser));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it('POST /api/admin/barter-toggle toggles barter status and emits socket event', async () => {
    const resOff = await request(app)
      .post('/api/admin/barter-toggle')
      .set('Cookie', authCookie(operatorUser))
      .send({ enabled: false });

    expect(resOff.status).toBe(200);
    expect(resOff.body.enabled).toBe(false);
    expect(isBarterEnabled()).toBe(false);
    expect(mockIo.emit).toHaveBeenCalledWith('barter-status-changed', { enabled: false });

    const resCheck = await request(app).get('/api/barter-status');
    expect(resCheck.body.enabled).toBe(false);
  });

  it('POST /api/admin/barter-toggle validates payload format', async () => {
    const res = await request(app)
      .post('/api/admin/barter-toggle')
      .set('Cookie', authCookie(operatorUser))
      .send({ enabled: 'invalid_boolean' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Parameter "enabled"/);
  });

  it('blocks barter creation routes when barter is disabled (POST /, POST /:id/take, POST /pick-drop, POST /:id/claim)', async () => {
    setBarterEnabled(false);

    // 1. POST / (create offer)
    const resCreate = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie(studentUser))
      .send({ myClassId: 1, wantedClassId: 2 });

    expect(resCreate.status).toBe(403);
    expect(resCreate.body.barterDisabled).toBe(true);
    expect(resCreate.body.error).toMatch(/Sistem barter sedang ditutup/);

    // 2. POST /:id/take (take offer)
    const resTake = await request(app)
      .post('/api/offers/1/take')
      .set('Cookie', authCookie(studentUser))
      .send({ takerNim: studentUser.nim });

    expect(resTake.status).toBe(403);
    expect(resTake.body.barterDisabled).toBe(true);

    // 3. POST /pick-drop (create pick-drop offer)
    const resPickDrop = await request(app)
      .post('/api/offers/pick-drop')
      .set('Cookie', authCookie(studentUser))
      .send({ myClassId: 1 });

    expect(resPickDrop.status).toBe(403);
    expect(resPickDrop.body.barterDisabled).toBe(true);

    // 4. POST /:id/claim (claim pick-drop offer)
    const resClaim = await request(app)
      .post('/api/offers/1/claim')
      .set('Cookie', authCookie(studentUser))
      .send({ claimerNim: studentUser.nim });

    expect(resClaim.status).toBe(403);
    expect(resClaim.body.barterDisabled).toBe(true);
  });

  it('allows GET /api/offers and DELETE /api/offers/:id when barter is disabled', async () => {
    setBarterEnabled(false);

    vi.mocked(prisma.barterOffer.findMany).mockResolvedValue([]);
    const resGet = await request(app)
      .get('/api/offers')
      .set('Cookie', authCookie(studentUser));

    expect(resGet.status).toBe(200);

    vi.mocked(prisma.barterOffer.findUnique).mockResolvedValue({
      id: 1,
      offererNim: studentUser.nim,
      status: 'open',
      myClass: { courseCode: 'KOM101', classCode: 'K1' },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
    vi.mocked(prisma.barterOffer.update).mockResolvedValue({ id: 1, status: 'cancelled' } as any);
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);

    const resDelete = await request(app)
      .delete('/api/offers/1')
      .set('Cookie', authCookie(studentUser));

    expect(resDelete.status).toBe(200);
    expect(resDelete.body.message).toBe('Offer cancelled');
  });

  it('resumes normal barter creation after admin re-enables barter system', async () => {
    setBarterEnabled(false);

    // Re-enable via endpoint
    await request(app)
      .post('/api/admin/barter-toggle')
      .set('Cookie', authCookie(operatorUser))
      .send({ enabled: true });

    expect(isBarterEnabled()).toBe(true);

    // Now POST /api/offers proceeds beyond the requireBarterEnabled middleware
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      throw new Error('Class not found');
    });

    const resCreate = await request(app)
      .post('/api/offers')
      .set('Cookie', authCookie(studentUser))
      .send({ myClassId: 10, wantedClassId: 20 });

    expect(resCreate.status).toBe(404); // Passed middleware, hit controller logic!
    expect(resCreate.body.error).toBe('Class not found');
  });
});
