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

  // POST /api/admin/override-swap
  router.post('/override-swap', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const { nim1, nim2, courseCode } = req.body;

    if (!nim1 || !nim2 || !courseCode) {
      return res.status(400).json({ error: 'nim1, nim2, dan courseCode wajib diisi' });
    }

    if (nim1 === nim2) {
      return res.status(400).json({ error: 'NIM mahasiswa tidak boleh sama' });
    }

    const [enroll1, enroll2] = await Promise.all([
      prisma.enrollment.findFirst({
        where: { nim: nim1, parallelClass: { courseCode } },
        include: { parallelClass: true },
      }),
      prisma.enrollment.findFirst({
        where: { nim: nim2, parallelClass: { courseCode } },
        include: { parallelClass: true },
      }),
    ]);

    if (!enroll1) return res.status(404).json({ error: `${nim1} tidak mengambil matkul ${courseCode}` });
    if (!enroll2) return res.status(404).json({ error: `${nim2} tidak mengambil matkul ${courseCode}` });

    if (enroll1.parallelClassId === enroll2.parallelClassId) {
      return res.status(400).json({ error: 'Kedua mahasiswa sudah berada di kelas yang sama' });
    }

    const [updated1, updated2] = await prisma.$transaction([
      prisma.enrollment.update({
        where: { id: enroll1.id },
        data: { parallelClassId: enroll2.parallelClassId },
      }),
      prisma.enrollment.update({
        where: { id: enroll2.id },
        data: { parallelClassId: enroll1.parallelClassId },
      }),
    ]);

    const [u1, u2] = await Promise.all([
      prisma.user.findUnique({ where: { nim: nim1 } }),
      prisma.user.findUnique({ where: { nim: nim2 } })
    ]);

    const notif1 = await createNotification(prisma, nim1, 'admin_override_swap', {
      courseCode,
      counterpartNim: nim2,
      counterpartName: u2?.name || 'Unknown',
      oldClassCode: enroll1.parallelClass.classCode,
      newClassCode: enroll2.parallelClass.classCode
    });

    const notif2 = await createNotification(prisma, nim2, 'admin_override_swap', {
      courseCode,
      counterpartNim: nim1,
      counterpartName: u1?.name || 'Unknown',
      oldClassCode: enroll2.parallelClass.classCode,
      newClassCode: enroll1.parallelClass.classCode
    });

    io.to(`user-${nim1}`).emit('new-notification', notif1);
    io.to(`user-${nim2}`).emit('new-notification', notif2);

    sendNotificationEmail(nim1, notif1.type as any, notif1.data).catch(console.error);
    sendNotificationEmail(nim2, notif2.type as any, notif2.data).catch(console.error);

    const staleOffers = await prisma.barterOffer.findMany({
      where: {
        status: 'open',
        offererNim: { in: [nim1, nim2] },
        myClass: { courseCode },
      },
    });

    await prisma.barterOffer.updateMany({
      where: { id: { in: staleOffers.map(o => o.id) } },
      data: { status: 'cancelled' },
    });

    io.emit('enrollments-swapped', {
      swaps: [
        { nim: nim1, oldClassId: enroll1.parallelClassId, newClassId: enroll2.parallelClassId },
        { nim: nim2, oldClassId: enroll2.parallelClassId, newClassId: enroll1.parallelClassId },
      ],
    });

    staleOffers.forEach(offer => {
      io.emit('offer-taken', { offerId: offer.id });
      io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', { 
        offerId: offer.id, 
        reason: 'schedule_override' 
      });
    });

    await logActivity('ADMIN_OVERRIDE_SWAP', (req as any).user.nim, `FORCED SWAP: ${u1?.name} <-> ${u2?.name} for course ${courseCode}.`);

    res.json({
      message: `Override berhasil. Jadwal ${courseCode} antara ${nim1} dan ${nim2} telah ditukar.`,
      swapped: {
        nim1: { from: enroll1.parallelClass.classCode, to: enroll2.parallelClass.classCode },
        nim2: { from: enroll2.parallelClass.classCode, to: enroll1.parallelClass.classCode },
      },
    });
  }));

  return router;
};
