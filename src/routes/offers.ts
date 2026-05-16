import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireStudent } from '../middleware/authMiddleware';
import { validate, asyncHandler } from '../middleware/helpers';
import { prisma } from '../prisma/db';
import {
  createOfferSchema,
  takeOfferSchema,
  getUserEnrollmentsExcluding,
  hasScheduleConflict,
  cancelStaleOffers,
  createNotification,
  autoMatch,
} from '../controllers/offerController';

export function createOffersRouter(io: Server) {
  const router = Router();

  router.get('/', requireStudent, asyncHandler(async (req: any, res: any) => {
    const offers = await prisma.barterOffer.findMany({
      where: { status: 'open' },
      include: { offerer: { select: { nim: true, name: true } }, myClass: true, wantedClass: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(offers);
  }));

  router.post('/', requireStudent, validate(createOfferSchema), asyncHandler(async (req: any, res: any) => {
    const { myClassId, wantedClassId } = req.body;
    const offererNim = req.user!.nim;

    const enrollment = await prisma.enrollment.findFirst({ where: { nim: offererNim, parallelClassId: myClassId } });
    if (!enrollment) return res.status(400).json({ error: 'You are not enrolled in this class' });

    const duplicateOffer = await prisma.barterOffer.findFirst({ where: { offererNim, myClassId, status: 'open' } });
    if (duplicateOffer) return res.status(400).json({ error: 'You already have an open offer for this class' });

    const [myClass, wantedClass] = await Promise.all([
      prisma.parallelClass.findUnique({ where: { id: myClassId } }),
      prisma.parallelClass.findUnique({ where: { id: wantedClassId } }),
    ]);

    if (!myClass || !wantedClass) return res.status(404).json({ error: 'Class not found' });
    if (myClass.courseCode !== wantedClass.courseCode) return res.status(400).json({ error: 'Must be same course' });
    if (myClass.classCode[0] !== wantedClass.classCode[0]) return res.status(400).json({ error: 'Must be same type (K⇌K, P⇌P, R⇌R)' });

    const offererOtherEnrollments = await getUserEnrollmentsExcluding(offererNim, myClassId);
    const conflictingClass = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, wantedClass));
    if (conflictingClass) {
      return res.status(400).json({
        error: `Jadwal bentrok: ${wantedClass.courseCode}-${wantedClass.classCode} bertabrakan dengan ${conflictingClass.parallelClass.courseCode}-${conflictingClass.parallelClass.classCode} (${conflictingClass.parallelClass.day} ${conflictingClass.parallelClass.timeStart}–${conflictingClass.parallelClass.timeEnd})`,
      });
    }

    const offer = await prisma.barterOffer.create({
      data: { offererNim, myClassId, wantedClassId, status: 'open' },
      include: { offerer: { select: { nim: true, name: true } }, myClass: true, wantedClass: true },
    });

    io.emit('new-offer', offer);

    const matchResult = await autoMatch({ id: offer.id, offererNim, myClassId, wantedClassId });

    if (matchResult.matched) {
      const { matchingOffer, offererNotification, takerNotification, offererCancelled, takerCancelled, swaps } = matchResult;

      io.emit('offer-taken', { offerId: matchingOffer!.id });
      io.emit('offer-taken', { offerId: offer.id });
      io.emit('enrollments-swapped', { swaps });

      io.to(`user-${matchingOffer!.offererNim}`).emit('new-notification', offererNotification);
      io.to(`user-${offer.offererNim}`).emit('new-notification', takerNotification);

      for (const cancelled of offererCancelled!) {
        io.emit('offer-taken', { offerId: cancelled.offerId });
        io.to(`user-${matchingOffer!.offererNim}`).emit('offer-auto-cancelled', cancelled);
      }
      for (const cancelled of takerCancelled!) {
        io.emit('offer-taken', { offerId: cancelled.offerId });
        io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', cancelled);
      }
    }

    res.status(201).json({ offer, autoMatched: matchResult.matched });
  }));

  router.post('/:id/take', requireStudent, validate(takeOfferSchema), asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const { takerNim } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.barterOffer.findUnique({
        where: { id: offerId },
        include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true } } },
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'open') throw new Error('Offer already taken');
      if (offer.offererNim === takerNim) throw new Error('Cannot take your own offer');

      // offerer mungkin sudah swap di penawaran lain sejak offer ini dibuat
      const offererStillEnrolled = await tx.enrollment.findFirst({
        where: { nim: offer.offererNim, parallelClassId: offer.myClassId },
      });
      if (!offererStillEnrolled) throw new Error('Offerer no longer has this class');

      const takerEnrollment = await tx.enrollment.findFirst({
        where: { nim: takerNim, parallelClassId: offer.wantedClassId },
      });
      if (!takerEnrollment) throw new Error('You are not enrolled in the wanted class');

      const taker = await tx.user.findUnique({ where: { nim: takerNim }, select: { nim: true, name: true } });
      if (!taker) throw new Error('Taker user not found');

      const [takerOtherEnrollments, offererOtherEnrollments] = await Promise.all([
        getUserEnrollmentsExcluding(takerNim, offer.wantedClassId, tx),
        getUserEnrollmentsExcluding(offer.offererNim, offer.myClassId, tx),
      ]);

      const takerConflict = takerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.myClass));
      if (takerConflict) {
        throw new Error(
          `Jadwal bentrok: ${offer.myClass.courseCode}-${offer.myClass.classCode} bertabrakan dengan ${takerConflict.parallelClass.courseCode}-${takerConflict.parallelClass.classCode} (${takerConflict.parallelClass.day} ${takerConflict.parallelClass.timeStart}–${takerConflict.parallelClass.timeEnd})`
        );
      }

      // jadwal offerer bisa berubah sejak offer dibuat
      const offererConflict = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.wantedClass));
      if (offererConflict) throw new Error('Offerer now has a schedule conflict with the wanted class');

      await Promise.all([
        tx.barterOffer.update({ where: { id: offerId }, data: { status: 'matched', takerNim, completedAt: new Date() } }),
        tx.enrollment.updateMany({ where: { nim: offer.offererNim, parallelClassId: offer.myClassId }, data: { parallelClassId: offer.wantedClassId } }),
        tx.enrollment.updateMany({ where: { nim: takerNim, parallelClassId: offer.wantedClassId }, data: { parallelClassId: offer.myClassId } }),
      ]);

      const offererNewSchedule = [...offererOtherEnrollments.map(e => e.parallelClass), offer.wantedClass];
      const takerNewSchedule   = [...takerOtherEnrollments.map(e => e.parallelClass), offer.myClass];

      const [offererCancelled, takerCancelled] = await Promise.all([
        cancelStaleOffers(offer.offererNim, offererNewSchedule, offer.myClassId, tx),
        cancelStaleOffers(takerNim, takerNewSchedule, offer.wantedClassId, tx),
      ]);

      const [offererNotification, takerNotification] = await Promise.all([
        createNotification(tx, offer.offererNim, 'barter_matched_as_offerer', {
          offerId,
          takerNim: taker.nim,
          takerName: taker.name,
          yourOldClass: { courseCode: offer.myClass.courseCode, classCode: offer.myClass.classCode },
          yourNewClass: { courseCode: offer.wantedClass.courseCode, classCode: offer.wantedClass.classCode },
          staleCancelledOffers: offererCancelled,
        }),
        createNotification(tx, takerNim, 'barter_matched_as_taker', {
          offerId,
          offererNim: offer.offererNim,
          offererName: offer.offerer.name,
          yourOldClass: { courseCode: offer.wantedClass.courseCode, classCode: offer.wantedClass.classCode },
          yourNewClass: { courseCode: offer.myClass.courseCode, classCode: offer.myClass.classCode },
          staleCancelledOffers: takerCancelled,
        }),
      ]);

      return { offer, taker, offererCancelled, takerCancelled, offererNotification, takerNotification };
    });

    const { offer, offererCancelled, takerCancelled, offererNotification, takerNotification } = result;

    io.emit('offer-taken', { offerId });
    io.emit('enrollments-swapped', {
      swaps: [
        { nim: offer.offererNim, oldClassId: offer.myClassId, newClassId: offer.wantedClassId },
        { nim: takerNim, oldClassId: offer.wantedClassId, newClassId: offer.myClassId },
      ],
    });

    io.to(`user-${offer.offererNim}`).emit('new-notification', offererNotification);
    io.to(`user-${takerNim}`).emit('new-notification', takerNotification);
    io.to(`user-${offer.offererNim}`).emit('barter-success', { offerId, takerNim });
    io.to(`user-${takerNim}`).emit('barter-success', { offerId, offererNim: offer.offererNim });

    for (const cancelled of offererCancelled) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', cancelled);
    }
    for (const cancelled of takerCancelled) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${takerNim}`).emit('offer-auto-cancelled', cancelled);
    }

    res.json({ message: 'Barter completed successfully' });
  }));

  router.delete('/:id', requireStudent, asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const userNim = req.user!.nim;

    const offer = await prisma.barterOffer.findUnique({ where: { id: offerId } });
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.offererNim !== userNim) return res.status(403).json({ error: 'Not your offer' });
    if (offer.status !== 'open') return res.status(400).json({ error: 'Cannot cancel matched offer' });

    await prisma.barterOffer.update({ where: { id: offerId }, data: { status: 'cancelled' } });

    io.emit('offer-taken', { offerId });
    res.json({ message: 'Offer cancelled' });
  }));

  return router;
}