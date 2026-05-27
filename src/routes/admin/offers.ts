import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { createNotification } from '../../controllers/offerController';
import { logActivity } from '../../utils/activity';
import { sendNotificationEmail } from '../../utils/email';

export default (io: Server) => {
  const router = Router();

  // DELETE /api/admin/offers/:id
  router.delete('/offers/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);

    const offer = await prisma.barterOffer.findUnique({ where: { id: offerId } });
    if (!offer) return res.status(404).json({ error: 'Penawaran barter tidak ditemukan' });
    if (offer.status !== 'open') return res.status(400).json({ error: 'Hanya penawaran berstatus open yang bisa dibatalkan' });

    await prisma.barterOffer.update({ where: { id: offerId }, data: { status: 'cancelled' } });
    
    const fullOffer = await prisma.barterOffer.findUnique({
      where: { id: offerId },
      include: { offerer: true, myClass: true }
    });

    if (fullOffer) {
      await logActivity('CANCEL_BARTER', (req as any).user.nim, `Force-cancelled barter offer for ${fullOffer.offerer.name} (Course: ${fullOffer.myClass.courseCode}).`);
      
      const notification = await createNotification(prisma, fullOffer.offererNim, 'admin_barter_cancelled', {
        offerId,
        courseCode: fullOffer.myClass.courseCode,
        classCode: fullOffer.myClass.classCode,
        reason: 'admin_cancelled'
      });
      io.to(`user-${fullOffer.offererNim}`).emit('new-notification', notification);
      sendNotificationEmail(fullOffer.offererNim, notification.type as any, notification.data).catch(console.error);
    }
    
    io.emit('offer-taken', { offerId });
    io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', { 
      offerId, 
      reason: 'admin_cancelled' 
    });

    res.json({ message: `Penawaran barter #${offerId} berhasil dibatalkan secara paksa.` });
  }));

  // DELETE /api/admin/purge-offers
  router.delete('/purge-offers', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const result = await prisma.barterOffer.deleteMany({ where: { status: 'open' } });
    io.emit('admin-offers-purged', { count: result.count });
    
    await logActivity('PURGE_OFFERS', (req as any).user.nim, `Purged ${result.count} active barter offers from the system.`);

    res.json({ message: `${result.count} penawaran barter aktif berhasil dihapus.`, count: result.count });
  }));

  return router;
};
