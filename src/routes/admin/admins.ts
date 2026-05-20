import { Router } from 'express';
import { Server } from 'socket.io';
import crypto from 'crypto';
import { requireAuth, requireSuperAdmin } from '../../middleware/authMiddleware';
import { asyncHandler, validate } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { disconnectUserSockets } from '../../socket/socketHandler';
import { logActivity } from '../../utils/activity';
import { createAdminSchema, updateAdminSchema } from './shared';

export default (io: Server) => {
  const router = Router();

  // GET /api/admin/admins
  router.get('/admins', requireAuth, requireSuperAdmin, asyncHandler(async (req: any, res: any) => {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['operator', 'super_admin'] } },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
      orderBy: { role: 'desc' }
    });
    res.json(admins);
  }));

  // POST /api/admin/admins
  router.post('/admins', requireAuth, requireSuperAdmin, validate(createAdminSchema), asyncHandler(async (req: any, res: any) => {
    const { name, email, role } = req.body;

    const nim = `ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const newAdmin = await prisma.user.create({
      data: {
        nim,
        name,
        email,
        role,
        isActive: true
      }
    });

    await logActivity('ADMIN_CREATED', (req as any).user.nim, `Created ${role}: ${name} (${email})`);
    io.emit('superadmin-user-created', newAdmin);
    res.status(201).json(newAdmin);
  }));

  // PUT /api/admin/admins/:nim
  router.put('/admins/:nim', requireAuth, requireSuperAdmin, validate(updateAdminSchema), asyncHandler(async (req: any, res: any) => {
    const { nim } = req.params;
    const { name, role, isActive } = req.body;
    
    if ((req as any).user.nim === nim) {
      if (role !== undefined || isActive !== undefined) {
        return res.status(403).json({ error: 'Cannot modify your own admin account (role or status) to prevent lockout' });
      }
    }

    const updated = await prisma.user.update({
      where: { nim },
      data: {
        ...(name !== undefined && { name }),
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive })
      }
    });

    await logActivity('ADMIN_MODIFIED', (req as any).user.nim, `Modified admin ${updated.name} (Role: ${role}, Active: ${isActive})`);

    if (isActive === false || role !== undefined) {
      disconnectUserSockets(io, nim, 'Your admin account has been deactivated or modified. Please re-authenticate.');
    }

    io.emit('superadmin-user-updated', updated);
    res.json(updated);
  }));

  // DELETE /api/admin/admins/:nim
  router.delete('/admins/:nim', requireAuth, requireSuperAdmin, asyncHandler(async (req: any, res: any) => {
    const { nim } = req.params;
    
    if ((req as any).user.nim === nim) {
      return res.status(403).json({ error: 'Cannot delete your own admin account' });
    }

    const admin = await prisma.user.findUnique({ where: { nim } });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    await prisma.user.delete({ where: { nim } });

    await logActivity('ADMIN_DELETED', (req as any).user.nim, `Deleted admin ${admin.name} (${admin.email})`);
    disconnectUserSockets(io, nim, 'Your admin account has been deleted.');
    io.emit('superadmin-user-deleted', { nim });
    res.json({ message: 'Admin deleted successfully' });
  }));

  return router;
};
