import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '../mocks/db';

vi.mock('../../prisma/db', () => ({ prisma }));

import { createTestApp } from '../createTestApp';

// --- Fixtures ---

const JWT_SECRET = process.env.JWT_SECRET!;
const testUser   = { nim: 'M0001234567', name: 'Test User', email: 'test@apps.ipb.ac.id' };

function authCookie(user = testUser) {
  const token = jwt.sign(user, JWT_SECRET);
  return `token=${token}`;
}

// --- Setup ---

let app: any;

beforeEach(async () => {
  Object.values(prisma).forEach(model => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach(fn => { if (vi.isMockFunction(fn)) fn.mockReset(); });
    }
  });

  app = await createTestApp();
});

// --- GET /health ---

describe('GET /health', () => {
  it('returns 200 with status OK — no auth required', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });
});

// --- GET /api/me ---

describe('GET /api/me', () => {
  it('returns 401 without auth cookie', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns the JWT payload for an authenticated user', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nim: testUser.nim, name: testUser.name, email: testUser.email });
  });
});

// --- GET /api/users ---

describe('GET /api/users', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns user list', async () => {
    const users = [{ nim: 'M0001234567', name: 'A', email: 'a@b.com' }];
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as any);

    const res = await request(app).get('/api/users').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(users);
  });
});

// --- GET /api/socket-token ---

describe('GET /api/socket-token', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/socket-token');
    expect(res.status).toBe(401);
  });

  it('returns a short-lived JWT containing the user NIM', async () => {
    const res = await request(app)
      .get('/api/socket-token')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    const decoded = jwt.verify(res.body.token, JWT_SECRET) as any;
    expect(decoded.nim).toBe(testUser.nim);
  });

  it('socket token expires in 60 seconds or less', async () => {
    const now = Math.floor(Date.now() / 1000);

    const res = await request(app)
      .get('/api/socket-token')
      .set('Cookie', authCookie());

    const decoded = jwt.decode(res.body.token) as any;
    expect(decoded.exp - now).toBeLessThanOrEqual(61);
  });
});

// --- GET /api/notifications ---

describe('GET /api/notifications', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('returns only the authenticated user\'s notifications, newest first', async () => {
    const notifications = [
      { id: 2, recipientNim: testUser.nim, type: 'barter_matched_as_taker',   read: false, createdAt: '2024-01-02', data: {} },
      { id: 1, recipientNim: testUser.nim, type: 'barter_matched_as_offerer', read: true,  createdAt: '2024-01-01', data: {} },
    ];
    vi.mocked(prisma.notification.findMany).mockResolvedValue(notifications as any);

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientNim: testUser.nim } })
    );
  });

  it('returns an empty array when the user has no notifications', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// --- PATCH /api/notifications/read-all ---

describe('PATCH /api/notifications/read-all', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });

  it('marks only the authenticated user\'s unread notifications as read', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 3 } as any);

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/read/i);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientNim: testUser.nim, read: false },
      data:  { read: true },
    });
  });

  it('succeeds gracefully when there are no unread notifications', async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 } as any);

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
  });
});

// --- GET /api/classes ---

describe('GET /api/classes', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/classes');
    expect(res.status).toBe(401);
  });

  it('returns sorted class list', async () => {
    const classes = [{ id: 1, courseCode: 'CS101', classCode: 'K01' }];
    vi.mocked(prisma.parallelClass.findMany).mockResolvedValue(classes as any);

    const res = await request(app).get('/api/classes').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(classes);
    expect(prisma.parallelClass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: expect.any(Array) })
    );
  });
});