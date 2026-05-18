import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { prisma, buildTxMock } from '../mocks/db';
import { mockIo, resetIoMocks } from '../mocks/io';

vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

vi.mock('../../prisma/db', () => ({ prisma }));

import { createTestApp } from '../createTestApp';

// --- Fixtures ---

const JWT_SECRET = process.env.JWT_SECRET!;

const studentUser   = { nim: 'M0001111111', name: 'Student',     email: 'student@apps.ipb.ac.id',  role: 'student'     };
const operatorUser  = { nim: 'ADMIN01',     name: 'Operator',    email: 'operator@apps.ipb.ac.id', role: 'operator'    };
const superAdminUser = { nim: 'SUPER01',    name: 'Super Admin', email: 'super@apps.ipb.ac.id',    role: 'super_admin' };

function authCookie(user: any) {
  const token = jwt.sign(user, JWT_SECRET);
  return `token=${token}`;
}

// Helper: make requireAdmin / requireSuperAdmin isActive check pass
function mockActiveUser(user = operatorUser) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...user, isActive: true } as any);
}

// --- Setup ---

let app: any;

beforeEach(async () => {
  Object.values(prisma).forEach(model => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach(fn => { if (vi.isMockFunction(fn)) fn.mockReset(); });
    }
  });
  resetIoMocks();

  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true } as any);

  app = await createTestApp();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── RBAC Middleware ──────────────────────────────────────────────────────────
describe('Admin RBAC Middleware Protection', () => {
  it('rejects students from accessing admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(studentUser));
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden: admin\/operator only/i);
  });

  it('rejects unauthenticated users from accessing admin routes', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('allows operators to access regular admin routes', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.barterOffer.count).mockResolvedValue(0);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(operatorUser));
    
    expect(res.status).toBe(200);
  });

  it('rejects operators from accessing super admin routes', async () => {
    mockActiveUser(operatorUser);
    const res = await request(app)
      .get('/api/admin/admins')
      .set('Cookie', authCookie(operatorUser));
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden: super admin only/i);
  });

  it('allows super admins to access super admin routes', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/admins')
      .set('Cookie', authCookie(superAdminUser));
    
    expect(res.status).toBe(200);
  });

  // CRIT-1: ghost 'admin' role must NOT be accepted
  it('CRIT-1: rejects ghost admin role from operator routes', async () => {
    const ghostUser = { nim: 'GHOST01', name: 'Ghost', email: 'ghost@ipb.ac.id', role: 'admin' };
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(ghostUser));
    
    expect(res.status).toBe(403);
  });

  it('CRIT-1: rejects ghost admin role from super admin routes', async () => {
    const ghostUser = { nim: 'GHOST01', name: 'Ghost', email: 'ghost@ipb.ac.id', role: 'admin' };
    const res = await request(app)
      .get('/api/admin/admins')
      .set('Cookie', authCookie(ghostUser));
    
    expect(res.status).toBe(403);
  });

  // MED-5: deactivated accounts must be rejected
  it('MED-5: returns 401 for a deactivated operator account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...operatorUser, isActive: false } as any);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(operatorUser));
    
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Account has been disabled/i);
  });

  it('MED-5: returns 401 for a deactivated super admin account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...superAdminUser, isActive: false } as any);

    const res = await request(app)
      .get('/api/admin/admins')
      .set('Cookie', authCookie(superAdminUser));
    
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Account has been disabled/i);
  });
});

// ─── Dashboard & Analytics ────────────────────────────────────────────────────
describe('Dashboard & Analytics', () => {
  it('GET /api/admin/stats returns aggregated stats', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.parallelClass.count).mockResolvedValue(10);
    vi.mocked(prisma.barterOffer.count).mockImplementation((args: any) => 
      args.where?.status === 'open' ? Promise.resolve(5) : Promise.resolve(20)
    );
    vi.mocked(prisma.user.count).mockResolvedValue(100);

    const res = await request(app).get('/api/admin/stats').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body.totalClasses).toBe(10);
    expect(res.body.activeOffers).toBe(5);
    expect(res.body.totalStudents).toBe(100);
  });

  it('GET /api/admin/logs returns audit logs', async () => {
    mockActiveUser(operatorUser);
    const logs = [{ id: 1, action_type: 'login' }];
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue(logs as any);
    
    const res = await request(app).get('/api/admin/logs').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(logs);
  });
});

// ─── Master Data Management ───────────────────────────────────────────────────
describe('Master Data Management', () => {
  it('GET /api/admin/users returns user list with enrollments', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ nim: 'M123', role: 'student', enrollments: [], offeredBarters: [] }] as any);
    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body[0].nim).toBe('M123');
  });

  it('DELETE /api/admin/users/:nim deletes user and emits event', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...operatorUser, isActive: true } as any) // for requireAdmin
      .mockResolvedValueOnce({ nim: 'M123', name: 'Test' } as any);        // for user existence check
    
    const res = await request(app).delete('/api/admin/users/M123').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { nim: 'M123' } });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-user-deleted', { nim: 'M123' });
  });

  // HIGH-4: Zod validation on POST /users
  it('HIGH-4: POST /api/admin/users rejects invalid email', async () => {
    mockActiveUser(operatorUser);
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', authCookie(operatorUser))
      .send({ nim: 'M6401211001', name: 'Test', email: 'not-an-email' });
    
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('email');
  });

  it('HIGH-4: POST /api/admin/users rejects missing name', async () => {
    mockActiveUser(operatorUser);
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', authCookie(operatorUser))
      .send({ nim: 'M6401211001', email: 'test@ipb.ac.id' });
    
    expect(res.status).toBe(400);
  });

  it('PUT /api/admin/users/:oldNim updates student details including email', async () => {
    mockActiveUser(operatorUser);
    const mockStudent = { nim: 'M6401211001', name: 'Old Name', email: 'old@ipb.ac.id', role: 'student' };
    
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...operatorUser, isActive: true } as any) // requireAdmin isActive check
      .mockResolvedValueOnce(mockStudent as any) // existence check in route
      .mockResolvedValueOnce(null); // nimExists check

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null); // email exists check

    const updatedStudent = { nim: 'M6401211002', name: 'New Name', email: 'new@ipb.ac.id', role: 'student' };
    vi.mocked(prisma.user.update).mockResolvedValueOnce(updatedStudent as any);

    const res = await request(app)
      .put('/api/admin/users/M6401211001')
      .set('Cookie', authCookie(operatorUser))
      .send({ newNim: 'M6401211002', newName: 'New Name', newEmail: 'new@ipb.ac.id' });

    expect(res.status).toBe(200);
    expect(res.body.nim).toBe('M6401211002');
    expect(res.body.email).toBe('new@ipb.ac.id');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { nim: 'M6401211001' },
      data: {
        nim: 'M6401211002',
        name: 'New Name',
        email: 'new@ipb.ac.id'
      }
    });
  });

  it('PUT /api/admin/users/:oldNim returns 400 for invalid email format', async () => {
    mockActiveUser(operatorUser);
    const mockStudent = { nim: 'M123', name: 'Old Name', email: 'old@ipb.ac.id', role: 'student' };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...operatorUser, isActive: true } as any) // requireAdmin isActive check
      .mockResolvedValueOnce(mockStudent as any); // existence check in route

    const res = await request(app)
      .put('/api/admin/users/M123')
      .set('Cookie', authCookie(operatorUser))
      .send({ newEmail: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format email tidak valid/i);
  });

  it('PUT /api/admin/users/:oldNim returns 400 if email is already taken', async () => {
    mockActiveUser(operatorUser);
    const mockStudent = { nim: 'M123', name: 'Old Name', email: 'old@ipb.ac.id', role: 'student' };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...operatorUser, isActive: true } as any) // requireAdmin isActive check
      .mockResolvedValueOnce(mockStudent as any); // existence check in route

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ nim: 'M999', email: 'new@ipb.ac.id' } as any); // email exists check

    const res = await request(app)
      .put('/api/admin/users/M123')
      .set('Cookie', authCookie(operatorUser))
      .send({ newEmail: 'new@ipb.ac.id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Email sudah terdaftar/i);
  });

  it('PUT /api/admin/users/:oldNim returns 400 if NIM is already taken', async () => {
    mockActiveUser(operatorUser);
    const mockStudent = { nim: 'M6401211001', name: 'Old Name', email: 'old@ipb.ac.id', role: 'student' };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...operatorUser, isActive: true } as any) // requireAdmin isActive check
      .mockResolvedValueOnce(mockStudent as any) // existence check in route
      .mockResolvedValueOnce({ nim: 'M6401211002', name: 'Other Student' } as any); // nimExists check

    const res = await request(app)
      .put('/api/admin/users/M6401211001')
      .set('Cookie', authCookie(operatorUser))
      .send({ newNim: 'M6401211002' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NIM sudah terdaftar/i);
  });
});

// ─── Administrative Operations ────────────────────────────────────────────────
describe('Administrative Operations', () => {
  it('DELETE /api/admin/purge-offers purges open offers and emits socket event', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.barterOffer.deleteMany).mockResolvedValue({ count: 5 } as any);
    
    const res = await request(app).delete('/api/admin/purge-offers').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(mockIo.emit).toHaveBeenCalledWith('admin-offers-purged', { count: 5 });
  });

  it('POST /api/admin/override-swap completes manual swap, creates notifications, and emits events', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.enrollment.findFirst)
      .mockResolvedValueOnce({ id: 1, parallelClassId: 10, parallelClass: { classCode: 'K01' } } as any)
      .mockResolvedValueOnce({ id: 2, parallelClassId: 20, parallelClass: { classCode: 'K02' } } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}]);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ nim: 'A', name: 'User A' } as any)
      .mockResolvedValueOnce({ nim: 'B', name: 'User B' } as any);
    vi.mocked(prisma.barterOffer.findMany).mockResolvedValue([]);
    vi.mocked(prisma.barterOffer.updateMany).mockResolvedValue({} as any);

    const mockNotif1 = { id: 201, recipientNim: 'A', type: 'admin_override_swap', data: {} };
    const mockNotif2 = { id: 202, recipientNim: 'B', type: 'admin_override_swap', data: {} };
    vi.mocked(prisma.notification.create)
      .mockResolvedValueOnce(mockNotif1 as any)
      .mockResolvedValueOnce(mockNotif2 as any);

    const res = await request(app)
      .post('/api/admin/override-swap')
      .set('Cookie', authCookie(operatorUser))
      .send({ nim1: 'A', nim2: 'B', courseCode: 'CS101' });
    
    expect(res.status).toBe(200);
    expect(mockIo.emit).toHaveBeenCalledWith('enrollments-swapped', expect.any(Object));
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(mockIo.to).toHaveBeenCalledWith('user-A');
    expect(mockIo.to).toHaveBeenCalledWith('user-B');
    expect(mockIo.emit).toHaveBeenCalledWith('new-notification', mockNotif1);
    expect(mockIo.emit).toHaveBeenCalledWith('new-notification', mockNotif2);
  });

  // CRIT-2: System reset security
  it('CRIT-2: POST /api/admin/reset returns 403 for operator (requires superAdmin)', async () => {
    mockActiveUser(operatorUser);
    const res = await request(app)
      .post('/api/admin/reset')
      .set('Cookie', authCookie(operatorUser))
      .send({ confirm: 'RESET_ALL_DATA' });
    
    expect(res.status).toBe(403);
  });

  it('CRIT-2: POST /api/admin/reset returns 400 without confirm token', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValue({ ...superAdminUser, isActive: true } as any);

    const res = await request(app)
      .post('/api/admin/reset')
      .set('Cookie', authCookie(superAdminUser))
      .send({}); // Missing confirm field
    
    expect(res.status).toBe(400);
  });

  it('CRIT-2: POST /api/admin/reset returns 400 with wrong confirm string', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValue({ ...superAdminUser, isActive: true } as any);

    const res = await request(app)
      .post('/api/admin/reset')
      .set('Cookie', authCookie(superAdminUser))
      .send({ confirm: 'yes please delete everything' }); // Wrong value
    
    expect(res.status).toBe(400);
  });

  it('CRIT-2: POST /api/admin/reset succeeds for superAdmin with correct confirm token', async () => {
    // requireSuperAdmin calls findUnique for isActive, then reset runs $transaction
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValue({ ...superAdminUser, isActive: true } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue([]);

    const res = await request(app)
      .post('/api/admin/reset')
      .set('Cookie', authCookie(superAdminUser))
      .send({ confirm: 'RESET_ALL_DATA' });
    
    expect(res.status).toBe(200);
  });
});

// ─── Super Admin Operations ───────────────────────────────────────────────────
describe('Super Admin Operations', () => {
  it('POST /api/admin/admins creates a new admin', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...superAdminUser, isActive: true } as any) // isActive check
      .mockResolvedValueOnce(null);                                          // email uniqueness
    vi.mocked(prisma.user.create).mockResolvedValue({ nim: 'ADM-NEW', role: 'operator' } as any);

    const res = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', authCookie(superAdminUser))
      .send({ name: 'New Op', email: 'newop@admin.com', role: 'operator' });
    
    expect(res.status).toBe(201);
    // MED-4: NIM should be ADM- prefix with hex (not base36 Math.random)
    expect(res.body.nim).toMatch(/^ADM-/);
  });

  // HIGH-4: role validation on /admins
  it('HIGH-4: POST /api/admin/admins rejects invalid role', async () => {
    mockActiveUser(superAdminUser);
    const res = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', authCookie(superAdminUser))
      .send({ name: 'Bad', email: 'bad@admin.com', role: 'student' }); // Invalid role
    
    expect(res.status).toBe(400);
  });

  it('HIGH-4: PUT /api/admin/admins/:nim rejects invalid role', async () => {
    mockActiveUser(superAdminUser);
    const res = await request(app)
      .put('/api/admin/admins/TARGETADM')
      .set('Cookie', authCookie(superAdminUser))
      .send({ role: 'god_mode' }); // Invalid role
    
    expect(res.status).toBe(400);
  });

  it('PUT /api/admin/admins/:nim updates role for valid superAdmin request', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValue({ ...superAdminUser, isActive: true } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({ nim: 'TARGET01', role: 'super_admin', isActive: true } as any);

    const res = await request(app)
      .put('/api/admin/admins/TARGET01')
      .set('Cookie', authCookie(superAdminUser))
      .send({ role: 'super_admin' });
    
    expect(res.status).toBe(200);
  });
});

// ─── Course Management ────────────────────────────────────────────────────────
describe('Course Management', () => {
  it('GET /api/admin/classes returns classes list', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.parallelClass.findMany).mockResolvedValue([
      { id: 1, courseCode: 'CS101', courseName: 'Intro to CS', classCode: 'K1', day: 'Senin', timeStart: '08:00', timeEnd: '10:00', room: 'A1', _count: { enrollments: 0 } }
    ] as any);
    
    const res = await request(app).get('/api/admin/classes').set('Cookie', authCookie(operatorUser));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].courseCode).toBe('CS101');
  });

  it('POST /api/admin/classes creates a new class and emits event', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.parallelClass.create).mockResolvedValue({ id: 2, courseCode: 'CS102', classCode: 'K2' } as any);
    
    const res = await request(app)
      .post('/api/admin/classes')
      .set('Cookie', authCookie(operatorUser))
      .send({ courseCode: 'cs102', courseName: 'Data Structures', classCode: 'k2', day: '1', timeStart: '08:00', timeEnd: '09:40', room: 'R2' });
    
    expect(res.status).toBe(201);
    expect(prisma.parallelClass.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        courseCode: 'CS102',
        classCode: 'K2',
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '09:40'
      })
    });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-schedule-updated', { count: 1 });
  });

  it('POST /api/admin/classes rejects invalid time format', async () => {
    mockActiveUser(operatorUser);
    
    const res = await request(app)
      .post('/api/admin/classes')
      .set('Cookie', authCookie(operatorUser))
      .send({ courseCode: 'CS102', courseName: 'Test', classCode: 'K2', timeStart: '8:00 AM' }); // Invalid HH:MM
    
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format timeStart tidak valid/);
  });

  it('PUT /api/admin/classes/:id updates a class', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(prisma.parallelClass.update).mockResolvedValue({ id: 1, courseCode: 'CS101', room: 'NEW_ROOM' } as any);
    
    const res = await request(app)
      .put('/api/admin/classes/1')
      .set('Cookie', authCookie(operatorUser))
      .send({ room: 'NEW_ROOM' });
    
    expect(res.status).toBe(200);
    expect(prisma.parallelClass.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ room: 'NEW_ROOM' })
    });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-schedule-updated', { count: 1 });
  });

  it('DELETE /api/admin/classes/:id deletes a class', async () => {
    mockActiveUser(operatorUser);
    vi.mocked(prisma.parallelClass.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(prisma.parallelClass.delete).mockResolvedValue({ id: 1 } as any);
    
    const res = await request(app).delete('/api/admin/classes/1').set('Cookie', authCookie(operatorUser));
    
    expect(res.status).toBe(200);
    expect(prisma.parallelClass.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-schedule-updated', { count: -1 });
  });
});

// ─── Enrollment & KRS Management ─────────────────────────────────────────────
describe('Enrollment & KRS Management', () => {
  it('POST /api/admin/enrollments creates enrollment and emits event', async () => {
    mockActiveUser(operatorUser);
    const mockEnroll = { id: 1, nim: 'M123', parallelClassId: 10, parallelClass: { courseCode: 'CS101', classCode: 'K01' } };
    vi.mocked(prisma.enrollment.create).mockResolvedValue(mockEnroll as any);

    const res = await request(app)
      .post('/api/admin/enrollments')
      .set('Cookie', authCookie(operatorUser))
      .send({ nim: 'M123', parallelClassId: 10 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(mockIo.emit).toHaveBeenCalledWith('admin-enrollment-created', mockEnroll);
  });

  it('PUT /api/admin/enrollments/:id updates enrollment, creates notification, and emits events', async () => {
    mockActiveUser(operatorUser);
    const existingEnroll = { id: 1, nim: 'M123', parallelClassId: 10, parallelClass: { courseCode: 'CS101', classCode: 'K01' } };
    const updatedEnroll = { 
      id: 1, 
      nim: 'M123', 
      parallelClassId: 20, 
      parallelClass: { courseCode: 'CS101', classCode: 'K02' },
      user: { name: 'Student' }
    };
    const mockNotif = { id: 99, recipientNim: 'M123', type: 'admin_enrollment_updated', data: {} };

    vi.mocked(prisma.enrollment.findUnique).mockResolvedValue(existingEnroll as any);
    vi.mocked(prisma.enrollment.update).mockResolvedValue(updatedEnroll as any);
    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotif as any);

    const res = await request(app)
      .put('/api/admin/enrollments/1')
      .set('Cookie', authCookie(operatorUser))
      .send({ newParallelClassId: 20 });

    expect(res.status).toBe(200);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientNim: 'M123',
        type: 'admin_enrollment_updated',
        data: {
          courseCode: 'CS101',
          oldClassCode: 'K01',
          newClassCode: 'K02'
        }
      }
    });
    expect(mockIo.to).toHaveBeenCalledWith('user-M123');
    expect(mockIo.emit).toHaveBeenCalledWith('new-notification', mockNotif);
  });

  it('PUT /api/admin/enrollments/:id successfully updates enrollment even if there is a schedule conflict (admin override)', async () => {
    mockActiveUser(operatorUser);
    const existingEnroll = { id: 1, nim: 'M123', parallelClassId: 10, parallelClass: { courseCode: 'CS101', classCode: 'K01' } };
    const updatedEnroll = { 
      id: 1, 
      nim: 'M123', 
      parallelClassId: 20, 
      parallelClass: { courseCode: 'CS101', classCode: 'K02' },
      user: { name: 'Student' }
    };
    const mockNotif = { id: 99, recipientNim: 'M123', type: 'admin_enrollment_updated', data: {} };

    vi.mocked(prisma.enrollment.findUnique).mockResolvedValue(existingEnroll as any);
    vi.mocked(prisma.enrollment.update).mockResolvedValue(updatedEnroll as any);
    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotif as any);

    const res = await request(app)
      .put('/api/admin/enrollments/1')
      .set('Cookie', authCookie(operatorUser))
      .send({ newParallelClassId: 20 });

    expect(res.status).toBe(200);
    expect(res.body.parallelClassId).toBe(20);
  });

  it('DELETE /api/admin/enrollments/:id deletes enrollment, creates notification, and emits events', async () => {
    mockActiveUser(operatorUser);
    const existingEnroll = { id: 1, nim: 'M123', parallelClassId: 10, parallelClass: { courseCode: 'CS101', classCode: 'K01' } };
    const mockNotif = { id: 100, recipientNim: 'M123', type: 'admin_enrollment_deleted', data: {} };

    vi.mocked(prisma.enrollment.findUnique).mockResolvedValue(existingEnroll as any);
    vi.mocked(prisma.enrollment.delete).mockResolvedValue(existingEnroll as any);
    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotif as any);

    const res = await request(app)
      .delete('/api/admin/enrollments/1')
      .set('Cookie', authCookie(operatorUser));

    expect(res.status).toBe(200);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientNim: 'M123',
        type: 'admin_enrollment_deleted',
        data: {
          courseCode: 'CS101',
          classCode: 'K01'
        }
      }
    });
    expect(mockIo.to).toHaveBeenCalledWith('user-M123');
    expect(mockIo.emit).toHaveBeenCalledWith('new-notification', mockNotif);
  });
});

describe('Barter Administration', () => {
  it('DELETE /api/admin/offers/:id force-cancels offer, creates notification, and emits events', async () => {
    mockActiveUser(operatorUser);
    const mockOffer = { id: 1, offererNim: 'M123', status: 'open', myClass: { courseCode: 'CS101', classCode: 'K01' } };
    const fullOffer = { 
      id: 1, 
      offererNim: 'M123', 
      status: 'cancelled', 
      offerer: { name: 'Student' }, 
      myClass: { courseCode: 'CS101', classCode: 'K01' } 
    };
    const mockNotif = { id: 101, recipientNim: 'M123', type: 'admin_barter_cancelled', data: {} };

    vi.mocked(prisma.barterOffer.findUnique)
      .mockResolvedValueOnce(mockOffer as any) // first findUnique inside route
      .mockResolvedValueOnce(fullOffer as any); // findUnique with include
    vi.mocked(prisma.barterOffer.update).mockResolvedValue(fullOffer as any);
    vi.mocked(prisma.notification.create).mockResolvedValue(mockNotif as any);

    const res = await request(app)
      .delete('/api/admin/offers/1')
      .set('Cookie', authCookie(operatorUser));

    expect(res.status).toBe(200);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientNim: 'M123',
        type: 'admin_barter_cancelled',
        data: {
          offerId: 1,
          courseCode: 'CS101',
          classCode: 'K01',
          reason: 'admin_cancelled'
        }
      }
    });
    expect(mockIo.to).toHaveBeenCalledWith('user-M123');
    expect(mockIo.emit).toHaveBeenCalledWith('new-notification', mockNotif);
  });
});

// ─── Admin Management ────────────────────────────────────────────────────────

describe('Super Admin Management Routes', () => {
  it('GET /api/admin/admins returns admins list', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([superAdminUser, operatorUser] as any);

    const res = await request(app).get('/api/admin/admins').set('Cookie', authCookie(superAdminUser));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: { in: ['operator', 'super_admin'] } }
    }));
  });

  it('PUT /api/admin/admins/:nim prevents self role/status modification but allows self name modification', async () => {
    mockActiveUser(superAdminUser);
    vi.mocked(prisma.user.update).mockResolvedValue({ nim: superAdminUser.nim, name: 'New Super Name', role: 'super_admin', isActive: true } as any);

    // 1. Role modification (should be blocked)
    const resRole = await request(app)
      .put(`/api/admin/admins/${superAdminUser.nim}`)
      .set('Cookie', authCookie(superAdminUser))
      .send({ role: 'operator' });

    expect(resRole.status).toBe(403);
    expect(resRole.body.error).toMatch(/Cannot modify your own admin account/);

    // 2. Status modification (should be blocked)
    const resStatus = await request(app)
      .put(`/api/admin/admins/${superAdminUser.nim}`)
      .set('Cookie', authCookie(superAdminUser))
      .send({ isActive: false });

    expect(resStatus.status).toBe(403);
    expect(resStatus.body.error).toMatch(/Cannot modify your own admin account/);

    // 3. Name modification (should be allowed)
    const resName = await request(app)
      .put(`/api/admin/admins/${superAdminUser.nim}`)
      .set('Cookie', authCookie(superAdminUser))
      .send({ name: 'New Super Name' });

    expect(resName.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { nim: superAdminUser.nim },
      data: { name: 'New Super Name' }
    });
  });

  it('DELETE /api/admin/admins/:nim prevents self-deletion', async () => {
    mockActiveUser(superAdminUser);

    const res = await request(app)
      .delete(`/api/admin/admins/${superAdminUser.nim}`)
      .set('Cookie', authCookie(superAdminUser));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Cannot delete your own admin account/);
  });
});

// ─── Batch Operations (Imports & Resets) ─────────────────────────────────────

describe('Batch Operations', () => {
  it('POST /api/admin/import-students uses a transaction to ensure atomicity', async () => {
    mockActiveUser(operatorUser);
    const csvBuffer = Buffer.from('nim,name,email\nM0001,John,j@b.com');
    const txMock = {
      user: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(txMock));

    const res = await request(app)
      .post('/api/admin/import-students')
      .set('Cookie', authCookie(operatorUser))
      .attach('file', csvBuffer, 'test.csv');

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txMock.user.deleteMany).toHaveBeenCalled();
    expect(txMock.user.createMany).toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith('admin-master-files-updated', { type: 'students', exists: true });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-user-created', expect.anything());
  });

  it('POST /api/admin/import-classes uses a transaction to ensure atomicity', async () => {
    mockActiveUser(operatorUser);
    
    // Create a dummy CSV buffer with one class
    const csvBuffer = Buffer.from('courseCode,courseName,classCode,day,timeStart,timeEnd,room\nCS101,Intro,K1,1,08:00,10:00,101');
    
    const txMock = {
      parallelClass: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback(txMock);
    });

    const res = await request(app)
      .post('/api/admin/import-classes')
      .set('Cookie', authCookie(operatorUser))
      .attach('file', csvBuffer, 'test.csv');

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txMock.parallelClass.deleteMany).toHaveBeenCalled();
    expect(txMock.parallelClass.createMany).toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith('admin-master-files-updated', { type: 'classes', exists: true });
    expect(mockIo.emit).toHaveBeenCalledWith('admin-schedule-updated', expect.anything());
  });

  it('DELETE /api/admin/master-files/:type only removes file and does NOT wipe database', async () => {
    mockActiveUser(superAdminUser);
    
    // Reset vi.mocked calls
    vi.clearAllMocks();

    const res = await request(app)
      .delete('/api/admin/master-files/students')
      .set('Cookie', authCookie(superAdminUser));

    expect(res.status).toBe(200);
    // Should NOT have called a transaction to wipe DB
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith('admin-master-files-updated', { type: 'students', exists: false });
  });

  it('POST /api/admin/seed-random fails with 403 in production', async () => {
    mockActiveUser(superAdminUser);
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/api/admin/seed-random')
      .set('Cookie', authCookie(superAdminUser));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/dinonaktifkan/);
    
    process.env.NODE_ENV = originalEnv;
  });

  it('POST /api/admin/reset uses transaction to wipe database', async () => {
    mockActiveUser(superAdminUser);
    
    vi.mocked(prisma.$transaction).mockResolvedValue([
      { count: 1 }, { count: 1 }, { count: 1 }, { count: 1 }, { count: 1 }
    ] as any);

    const res = await request(app)
      .post('/api/admin/reset')
      .set('Cookie', authCookie(superAdminUser))
      .send({ confirm: 'RESET_ALL_DATA' });

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith('admin-system-reset', expect.anything());
  });
});
