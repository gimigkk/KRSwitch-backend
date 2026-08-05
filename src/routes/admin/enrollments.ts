import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { createNotification, cancelStaleOffers, getUserEnrollmentsExcluding } from '../../controllers/offerController';
import { logActivity } from '../../utils/activity';
import { sendNotificationEmail } from '../../utils/email';

export default (io: Server) => {
  const router = Router();

  // POST /api/admin/enrollments
  router.post('/enrollments', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const { nim, parallelClassId } = req.body;

    if (!nim || !parallelClassId) {
      return res.status(400).json({ error: 'NIM dan parallelClassId wajib diisi' });
    }

    const enrollment = await prisma.enrollment.create({
      data: { nim: String(nim), parallelClassId: Number(parallelClassId) },
      include: { parallelClass: true },
    });

    io.emit('admin-enrollment-created', enrollment);
    res.status(201).json(enrollment);
  }));

  // PUT /api/admin/enrollments/:id
  router.put('/enrollments/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const enrollmentId = parseInt(req.params.id);
    const { newParallelClassId } = req.body;

    if (!newParallelClassId) {
      return res.status(400).json({ error: 'newParallelClassId wajib diisi' });
    }

    const existing = await prisma.enrollment.findUnique({ 
      where: { id: enrollmentId },
      include: { parallelClass: true }
    });
    if (!existing) return res.status(404).json({ error: 'Enrollment tidak ditemukan' });

    const updated = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { parallelClassId: Number(newParallelClassId) },
      include: { parallelClass: true, user: true },
    });

    const enrollments = await getUserEnrollmentsExcluding(updated.nim, 0, prisma);
    const userSchedule = (enrollments || []).map(e => e.parallelClass).filter(Boolean);
    const cancelledOffers = await cancelStaleOffers(updated.nim, userSchedule, existing.parallelClassId, prisma);

    for (const cancelled of cancelledOffers) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${updated.nim}`).emit('offer-auto-cancelled', cancelled);
    }

    const notification = await createNotification(prisma, updated.nim, 'admin_enrollment_updated', {
      courseCode: updated.parallelClass.courseCode,
      oldClassCode: existing.parallelClass?.classCode || 'Unknown',
      newClassCode: updated.parallelClass.classCode
    });

    await logActivity('UPDATE_KRS', (req as any).user.nim, `Manual KRS move for ${updated.user.name}: assigned to class ${updated.parallelClass.classCode} (${updated.parallelClass.courseCode}).`);
    
    io.emit('admin-enrollment-updated', updated);
    io.to(`user-${updated.nim}`).emit('enrollment-updated', updated);
    io.to(`user-${updated.nim}`).emit('new-notification', notification);
    sendNotificationEmail(updated.nim, notification.type as any, notification.data).catch(console.error);
    
    res.json(updated);
  }));

  // DELETE /api/admin/enrollments/:id
  router.delete('/enrollments/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const enrollmentId = parseInt(req.params.id);

    const existing = await prisma.enrollment.findUnique({ 
      where: { id: enrollmentId },
      include: { parallelClass: true }
    });
    if (!existing) return res.status(404).json({ error: 'Enrollment tidak ditemukan' });

    const nim = existing.nim;
    await prisma.enrollment.delete({ where: { id: enrollmentId } });

    const enrollments = await getUserEnrollmentsExcluding(nim, 0, prisma);
    const userSchedule = (enrollments || []).map(e => e.parallelClass).filter(Boolean);
    const cancelledOffers = await cancelStaleOffers(nim, userSchedule, existing.parallelClassId, prisma);

    for (const cancelled of cancelledOffers) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${nim}`).emit('offer-auto-cancelled', cancelled);
    }
    
    const notification = await createNotification(prisma, nim, 'admin_enrollment_deleted', {
      courseCode: existing.parallelClass.courseCode,
      classCode: existing.parallelClass.classCode
    });
    
    io.emit('admin-enrollment-deleted', { id: enrollmentId, nim });
    io.to(`user-${nim}`).emit('enrollment-deleted', { id: enrollmentId });
    io.to(`user-${nim}`).emit('new-notification', notification);
    sendNotificationEmail(nim, notification.type as any, notification.data).catch(console.error);
    
    res.json({ message: 'Mata kuliah berhasil di-drop dari KRS.' });
  }));

  return router;
};
