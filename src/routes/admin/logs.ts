import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';

export default (_io: Server) => {
  const router = Router();

  // GET /api/admin/logs
  router.get('/logs', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
    try {
      const logs = await (prisma as any).activityLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 100
      });
      res.json(logs);
    } catch (err: any) {
      console.warn('Tabel ActivityLog belum siap atau hilang:', err.message);
      res.json([]);
    }
  }));

  return router;
};
