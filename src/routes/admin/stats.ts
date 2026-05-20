import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { getOnlineCount } from '../../socket/socketHandler';

export default (_io: Server) => {
  const router = Router();

  // GET /api/admin/stats
  router.get('/stats', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
    const [totalStudents, totalClasses, totalEnrollments, activeOffers, successfulTrades] = await Promise.all([
      prisma.user.count(),
      prisma.parallelClass.count(),
      prisma.enrollment.count(),
      prisma.barterOffer.count({ where: { status: 'open' } }),
      prisma.barterOffer.count({ where: { status: 'matched' } }),
    ]);
    const onlineCount = getOnlineCount();
    res.json({ totalStudents, totalClasses, totalEnrollments, activeOffers, successfulTrades, onlineCount });
  }));

  return router;
};
