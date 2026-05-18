import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../../middleware/authMiddleware';
import { validate, asyncHandler } from '../../middleware/helpers';
import { z } from 'zod';
import { prisma } from '../../prisma/db';

const JWT_SECRET = process.env.JWT_SECRET!;

// Mock Prisma client
vi.mock('../../prisma/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// --- Helpers ---

function makeRes() {
  const res: Partial<Response> = {
    status:      vi.fn().mockReturnThis(),
    json:        vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// --- requireAuth ---
// Middleware yang cek JWT dari cookie, lalu taruh payload di req.user

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no token cookie is present', async () => {
    const req  = { headers: {} } as Request;
    const res  = makeRes();
    const next = makeNext();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 and clears cookie when token is invalid / expired (production domain)', async () => {
    const originalDomain = process.env.COOKIE_DOMAIN;
    process.env.COOKIE_DOMAIN = 'production.com';
    
    const req  = { headers: { cookie: 'token=definitely.not.valid' } } as unknown as Request;
    const res  = makeRes();
    const next = makeNext();

    await requireAuth(req, res, next);

    const expectedClearOptions = {
      httpOnly: true,
      secure: false, // process.env.NODE_ENV is 'test'
      sameSite: 'lax' as const,
      path: '/'
    };

    // clearAllAuthCookies clears 6 combinations:
    // host-only, localhost, .localhost, 127.0.0.1, production.com, .production.com
    expect(res.clearCookie).toHaveBeenCalledTimes(6);
    expect(res.clearCookie).toHaveBeenNthCalledWith(1, 'token', expectedClearOptions);
    expect(res.clearCookie).toHaveBeenNthCalledWith(2, 'token', { ...expectedClearOptions, domain: 'localhost' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(3, 'token', { ...expectedClearOptions, domain: '.localhost' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(4, 'token', { ...expectedClearOptions, domain: '127.0.0.1' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(5, 'token', { ...expectedClearOptions, domain: 'production.com' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(6, 'token', { ...expectedClearOptions, domain: '.production.com' });
    
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired, please log in again' });
    expect(next).not.toHaveBeenCalled();
    
    process.env.COOKIE_DOMAIN = originalDomain;
  });

  it('returns 401 and clears only local host cookies when token is invalid / expired (localhost)', async () => {
    const originalDomain = process.env.COOKIE_DOMAIN;
    process.env.COOKIE_DOMAIN = 'localhost';
    
    const req  = { headers: { cookie: 'token=definitely.not.valid' } } as unknown as Request;
    const res  = makeRes();
    const next = makeNext();

    await requireAuth(req, res, next);

    const expectedClearOptions = {
      httpOnly: true,
      secure: false, // process.env.NODE_ENV is 'test'
      sameSite: 'lax' as const,
      path: '/'
    };

    // COOKIE_DOMAIN=localhost: clears 4 combinations: host-only, localhost, .localhost, 127.0.0.1
    expect(res.clearCookie).toHaveBeenCalledTimes(4);
    expect(res.clearCookie).toHaveBeenNthCalledWith(1, 'token', expectedClearOptions);
    expect(res.clearCookie).toHaveBeenNthCalledWith(2, 'token', { ...expectedClearOptions, domain: 'localhost' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(3, 'token', { ...expectedClearOptions, domain: '.localhost' });
    expect(res.clearCookie).toHaveBeenNthCalledWith(4, 'token', { ...expectedClearOptions, domain: '127.0.0.1' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    
    process.env.COOKIE_DOMAIN = originalDomain;
  });

  it('returns 401 for a structurally valid JWT signed with the wrong secret', async () => {
    const token = jwt.sign({ nim: 'M0001234567', name: 'X', email: 'x@y.com' }, 'WRONG_SECRET');
    const req   = { headers: { cookie: `token=${token}` } } as unknown as Request;
    const res   = makeRes();
    const next  = makeNext();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('populates req.user and calls next() for a valid active token', async () => {
    // Mock user being active in DB
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as any);

    const payload = { nim: 'M0001234567', name: 'Test User', email: 'test@apps.ipb.ac.id' };
    const token   = jwt.sign(payload, JWT_SECRET);
    const req     = { headers: { cookie: `token=${token}` } } as unknown as Request;
    const res     = makeRes();
    const next    = makeNext();

    await requireAuth(req, res, next);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: payload.email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).user).toMatchObject(payload);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 and clears cookies for a valid token if user is inactive in DB', async () => {
    // Mock user being inactive in DB
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: false } as any);

    const payload = { nim: 'M0001234567', name: 'Test User', email: 'test@apps.ipb.ac.id' };
    const token   = jwt.sign(payload, JWT_SECRET);
    const req     = { headers: { cookie: `token=${token}` } } as unknown as Request;
    const res     = makeRes();
    const next    = makeNext();

    await requireAuth(req, res, next);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: payload.email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('returns 401 and clears cookies for a valid token if user does not exist in DB', async () => {
    // Mock user not found in DB
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const payload = { nim: 'M0001234567', name: 'Test User', email: 'test@apps.ipb.ac.id' };
    const token   = jwt.sign(payload, JWT_SECRET);
    const req     = { headers: { cookie: `token=${token}` } } as unknown as Request;
    const res     = makeRes();
    const next    = makeNext();

    await requireAuth(req, res, next);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: payload.email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('bypasses zombie duplicate cookies and authenticates if at least one valid active token is present', async () => {
    // Mock user being active in DB
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as any);

    const payload = { nim: 'M0001234567', name: 'Test User', email: 'test@apps.ipb.ac.id' };
    const validToken = jwt.sign(payload, JWT_SECRET);
    const invalidToken = 'definitely.not.valid.token';

    // Simulate sending multiple token cookies
    const req = { 
      headers: { 
        cookie: `token=${invalidToken}; token=${validToken}` 
      } 
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).user).toMatchObject(payload);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// --- validate ---
// Middleware factory yang validasi req.body pakai Zod schema

describe('validate', () => {
  const schema = z.object({
    name:  z.string().min(1),
    count: z.number().int().positive(),
  });

  it('calls next() when the body matches the schema', () => {
    const req  = { body: { name: 'hello', count: 3 } } as Request;
    const res  = makeRes();
    const next = makeNext();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 with validation details when the body fails', () => {
    const req  = { body: { name: '', count: -1 } } as Request;
    const res  = makeRes();
    const next = makeNext();

    validate(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const json = vi.mocked(res.json).mock.calls[0][0];
    expect(json.error).toBe('Validation failed');
    expect(json.details.length).toBeGreaterThan(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes non-Zod errors to next(err)', () => {
    const badSchema = { parse: () => { throw new Error('unexpected'); } } as any;
    const req  = { body: {} } as Request;
    const next = makeNext();

    validate(badSchema)(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// --- asyncHandler ---
// Wrapper yang forward error dari async handler ke next(err)

describe('asyncHandler', () => {
  it('resolves normally and does not call next with an error', async () => {
    const res  = makeRes();
    const next = makeNext();

    const handler = asyncHandler(async (_req: any, res: any) => {
      res.json({ ok: true });
    });

    await handler({} as Request, res, next);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when the async handler rejects', async () => {
    const next = makeNext();
    const boom = new Error('database exploded');

    const handler = asyncHandler(async () => { throw boom; });

    await handler({} as Request, makeRes(), next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});