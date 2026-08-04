import { Router } from 'express';
import { Server } from 'socket.io';
import { requireAuth, requireStudent } from '../middleware/authMiddleware';
import { requireBarterEnabled } from '../middleware/requireBarterEnabled';
import { validate, asyncHandler } from '../middleware/helpers';
import { prisma } from '../prisma/db';
import {
  createOfferSchema,
  createPickDropOfferSchema,
  takeOfferSchema,
  claimPickDropOfferSchema,
  getUserEnrollmentsExcluding,
  hasScheduleConflict,
  cancelStaleOffers,
  createNotification,
  autoMatch,
} from '../controllers/offerController';
import { logActivity } from '../utils/activity';
import { sendNotificationEmail } from '../utils/email';

export function createOffersRouter(io: Server) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', requireStudent, asyncHandler(async (req: any, res: any) => {
    const offers = await prisma.barterOffer.findMany({
      where: { status: 'open' },
      include: {
        offerer: { select: { nim: true, name: true, picture: true } },
        reservedFor: { select: { nim: true, name: true } },
        myClass: true,
        wantedClass: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(offers);
  }));

  router.post('/', requireStudent, requireBarterEnabled, validate(createOfferSchema), asyncHandler(async (req: any, res: any) => {
    const { myClassId, wantedClassId } = req.body;
    const offererNim = req.user!.nim;

    try {
      const txResult = await prisma.$transaction(async (tx) => {
        // Pessimistic session lock: serialize concurrent actions from the same student (double-click lock)
        await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${offererNim} FOR UPDATE`;

        const enrollment = await tx.enrollment.findFirst({ where: { nim: offererNim, parallelClassId: myClassId } });
        if (!enrollment) throw new Error('You are not enrolled in this class');

        const duplicateOffer = await tx.barterOffer.findFirst({ where: { offererNim, myClassId, status: 'open' } });
        if (duplicateOffer) throw new Error('You already have an open offer for this class');

        const [myClass, wantedClass] = await Promise.all([
          tx.parallelClass.findUnique({ where: { id: myClassId } }),
          tx.parallelClass.findUnique({ where: { id: wantedClassId } }),
        ]);

        if (!myClass || !wantedClass) throw new Error('Class not found');
        if (myClass.courseCode !== wantedClass.courseCode) throw new Error('Must be same course');
        if (myClass.classCode[0] !== wantedClass.classCode[0]) throw new Error('Must be same type (K⇌K, P⇌P, R⇌R)');

        const offererOtherEnrollments = await getUserEnrollmentsExcluding(offererNim, myClassId, tx);
        const conflictingClass = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, wantedClass));
        if (conflictingClass) {
          throw new Error(
            `Jadwal bentrok: ${wantedClass.courseCode}-${wantedClass.classCode} bertabrakan dengan ${conflictingClass.parallelClass.courseCode}-${conflictingClass.parallelClass.classCode} (${conflictingClass.parallelClass.day} ${conflictingClass.parallelClass.timeStart}–${conflictingClass.parallelClass.timeEnd})`
          );
        }

        const offer = await tx.barterOffer.create({
          data: { offererNim, myClassId, wantedClassId, status: 'open' },
          include: { offerer: { select: { nim: true, name: true, picture: true } }, myClass: true, wantedClass: true },
        });

        return { offer, myClass, wantedClass };
      });

      const { offer, myClass, wantedClass } = txResult;

      await logActivity('BARTER_CREATED', offererNim, `Created open barter offer for ${myClass.courseCode} (${myClass.classCode}) -> looking for ${wantedClass.classCode}.`);
      io.emit('new-offer', offer);

      // Pass outside the transaction context so that auto-matching errors don't roll back creation
      const matchResult = await autoMatch({ id: offer.id, offererNim, myClassId, wantedClassId });

      if (matchResult.matched) {
        const { matchingOffer, offererNotification, takerNotification, offererCancelled, takerCancelled, swaps } = matchResult;

        io.emit('offer-taken', { offerId: matchingOffer!.id });
        io.emit('offer-taken', { offerId: offer.id });
        io.emit('enrollments-swapped', { swaps });

        io.to(`user-${matchingOffer!.offererNim}`).emit('new-notification', offererNotification);
        io.to(`user-${offer.offererNim}`).emit('new-notification', takerNotification);

        sendNotificationEmail(matchingOffer!.offererNim, offererNotification.type as any, offererNotification.data).catch(console.error);
        sendNotificationEmail(offer.offererNim, takerNotification.type as any, takerNotification.data).catch(console.error);

        for (const cancelled of offererCancelled!) {
          io.emit('offer-taken', { offerId: cancelled.offerId });
          io.to(`user-${matchingOffer!.offererNim}`).emit('offer-auto-cancelled', cancelled);
        }
        for (const cancelled of takerCancelled!) {
          io.emit('offer-taken', { offerId: cancelled.offerId });
          io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', cancelled);
        }
      }

      return res.status(201).json({ offer, autoMatched: matchResult.matched });
    } catch (err: any) {
      if (err.message === 'Class not found') return res.status(404).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  }));

  router.post('/:id/take', requireStudent, requireBarterEnabled, validate(takeOfferSchema), asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const { takerNim } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Pessimistic session lock: serialize concurrent actions from the same student
      await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${takerNim} FOR UPDATE`;

      const offer = await tx.barterOffer.findUnique({
        where: { id: offerId },
        include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true, picture: true } } },
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'open') throw new Error('Offer already taken');
      if (offer.type !== 'swap' || !offer.wantedClassId || !offer.wantedClass) {
        throw new Error('This is a Pick & Drop offer, use the claim endpoint instead');
      }
      if (offer.offererNim === takerNim) throw new Error('Cannot take your own offer');

      const wantedClassId = offer.wantedClassId;
      const wantedClass = offer.wantedClass;

      // offerer mungkin sudah swap di penawaran lain sejak offer ini dibuat
      const offererStillEnrolled = await tx.enrollment.findFirst({
        where: { nim: offer.offererNim, parallelClassId: offer.myClassId },
      });
      if (!offererStillEnrolled) throw new Error('Offerer no longer has this class');

      const takerEnrollment = await tx.enrollment.findFirst({
        where: { nim: takerNim, parallelClassId: wantedClassId },
      });
      if (!takerEnrollment) throw new Error('You are not enrolled in the wanted class');

      const taker = await tx.user.findUnique({ where: { nim: takerNim }, select: { nim: true, name: true } });
      if (!taker) throw new Error('Taker user not found');

      const [takerOtherEnrollments, offererOtherEnrollments] = await Promise.all([
        getUserEnrollmentsExcluding(takerNim, wantedClassId, tx),
        getUserEnrollmentsExcluding(offer.offererNim, offer.myClassId, tx),
      ]);

      const takerConflict = takerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.myClass));
      if (takerConflict) {
        throw new Error(
          `Jadwal bentrok: ${offer.myClass.courseCode}-${offer.myClass.classCode} bertabrakan dengan ${takerConflict.parallelClass.courseCode}-${takerConflict.parallelClass.classCode} (${takerConflict.parallelClass.day} ${takerConflict.parallelClass.timeStart}–${takerConflict.parallelClass.timeEnd})`
        );
      }

      // jadwal offerer bisa berubah sejak offer dibuat
      const offererConflict = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, wantedClass));
      if (offererConflict) throw new Error('Offerer now has a schedule conflict with the wanted class');

      // Atomic conditional update: claim the offer only if it is STILL 'open'
      const updateResult = await tx.barterOffer.updateMany({
        where: { id: offerId, status: 'open' },
        data: { status: 'matched', takerNim, completedAt: new Date() }
      });

      if (updateResult.count === 0) {
        throw new Error('Offer already taken or matched concurrently by another user');
      }

      // Safe to swap enrollments since this caller successfully claimed the offer
      await Promise.all([
        tx.enrollment.updateMany({ where: { nim: offer.offererNim, parallelClassId: offer.myClassId }, data: { parallelClassId: wantedClassId } }),
        tx.enrollment.updateMany({ where: { nim: takerNim, parallelClassId: wantedClassId }, data: { parallelClassId: offer.myClassId } }),
      ]);

      const offererNewSchedule = [...offererOtherEnrollments.map(e => e.parallelClass), wantedClass];
      const takerNewSchedule   = [...takerOtherEnrollments.map(e => e.parallelClass), offer.myClass];

      const [offererCancelled, takerCancelled] = await Promise.all([
        cancelStaleOffers(offer.offererNim, offererNewSchedule, offer.myClassId, tx),
        cancelStaleOffers(takerNim, takerNewSchedule, wantedClassId, tx),
      ]);

      const [offererNotification, takerNotification] = await Promise.all([
        createNotification(tx, offer.offererNim, 'barter_matched_as_offerer', {
          offerId,
          takerNim: taker.nim,
          takerName: taker.name,
          yourOldClass: { courseCode: offer.myClass.courseCode, classCode: offer.myClass.classCode },
          yourNewClass: { courseCode: wantedClass.courseCode, classCode: wantedClass.classCode },
          staleCancelledOffers: offererCancelled,
        }),
        createNotification(tx, takerNim, 'barter_matched_as_taker', {
          offerId,
          offererNim: offer.offererNim,
          offererName: offer.offerer.name,
          yourOldClass: { courseCode: wantedClass.courseCode, classCode: wantedClass.classCode },
          yourNewClass: { courseCode: offer.myClass.courseCode, classCode: offer.myClass.classCode },
          staleCancelledOffers: takerCancelled,
        }),
      ]);

      return { offer, taker, offererCancelled, takerCancelled, offererNotification, takerNotification, wantedClass, wantedClassId };
    });

    const { offer, offererCancelled, takerCancelled, offererNotification, takerNotification, wantedClass, wantedClassId } = result;

    await logActivity(
      'BARTER_MATCHED',
      takerNim,
      `Successfully matched with ${offer.offerer.name} (${offer.offererNim}) for course ${offer.myClass.courseCode}. Swapped ${wantedClass.classCode} for ${offer.myClass.classCode}.`
    );

    io.emit('offer-taken', { offerId });
    io.emit('enrollments-swapped', {
      swaps: [
        { nim: offer.offererNim, oldClassId: offer.myClassId, newClassId: wantedClassId },
        { nim: takerNim, oldClassId: wantedClassId, newClassId: offer.myClassId },
      ],
    });

    io.to(`user-${offer.offererNim}`).emit('new-notification', offererNotification);
    io.to(`user-${takerNim}`).emit('new-notification', takerNotification);

    sendNotificationEmail(offer.offererNim, offererNotification.type as any, offererNotification.data).catch(console.error);
    sendNotificationEmail(takerNim, takerNotification.type as any, takerNotification.data).catch(console.error);

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

  router.post('/pick-drop', requireStudent, requireBarterEnabled, validate(createPickDropOfferSchema), asyncHandler(async (req: any, res: any) => {
    const { myClassId, reservedForNim } = req.body;
    const offererNim = req.user!.nim;

    const targetNim = reservedForNim?.trim() || null;

    try {
      const offer = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${offererNim} FOR UPDATE`;

        const enrollment = await tx.enrollment.findFirst({ where: { nim: offererNim, parallelClassId: myClassId } });
        if (!enrollment) throw new Error('You are not enrolled in this class');

        const duplicateOffer = await tx.barterOffer.findFirst({ where: { offererNim, myClassId, status: 'open' } });
        if (duplicateOffer) throw new Error('You already have an open offer for this class');

        const myClass = await tx.parallelClass.findUnique({ where: { id: myClassId } });
        if (!myClass) throw new Error('Class not found');

        if (targetNim) {
          if (targetNim === offererNim) throw new Error('Cannot reserve for yourself');
          const targetUser = await tx.user.findUnique({ where: { nim: targetNim } });
          if (!targetUser) throw new Error(`Target student with NIM ${targetNim} not found`);

          const targetEnrollment = await tx.enrollment.findFirst({
            where: { nim: targetNim, parallelClass: { courseCode: myClass.courseCode } }
          });
          if (targetEnrollment) {
            throw new Error(`Mahasiswa ${targetUser.name} (${targetNim}) sudah terdaftar di matkul ${myClass.courseCode}`);
          }

          const offererEnrollments = await tx.enrollment.findMany({
            where: { nim: offererNim, parallelClass: { courseCode: myClass.courseCode } },
            include: { parallelClass: true }
          });
          const targetOtherEnrollments = await getUserEnrollmentsExcluding(targetNim, 0, tx);

          for (const enr of offererEnrollments) {
            const conflict = targetOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, enr.parallelClass));
            if (conflict) {
              throw new Error(
                `Gagal: Paket ${enr.parallelClass.courseCode}-${enr.parallelClass.classCode} bertabrakan dengan jadwal ${targetUser.name} di kelas ${conflict.parallelClass.courseCode}-${conflict.parallelClass.classCode} (${conflict.parallelClass.day})`
              );
            }
          }
        }

        const newOffer = await tx.barterOffer.create({
          data: {
            offererNim,
            myClassId,
            type: 'pick_drop',
            reservedForNim: targetNim,
            status: 'open',
          },
          include: {
            offerer: { select: { nim: true, name: true, picture: true } },
            reservedFor: { select: { nim: true, name: true } },
            myClass: true,
          },
        });

        return newOffer;
      });

      await logActivity(
        'PICK_DROP_CREATED',
        offererNim,
        `Created ${targetNim ? `targeted drop for ${targetNim}` : 'open drop'} for ${offer.myClass.courseCode} (${offer.myClass.classCode}).`
      );

      io.emit('new-offer', offer);

      return res.status(201).json({ offer });
    } catch (err: any) {
      if (err.message === 'Class not found') return res.status(404).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  }));

  router.post('/:id/claim', requireStudent, requireBarterEnabled, validate(claimPickDropOfferSchema), asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const { claimerNim } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${claimerNim} FOR UPDATE`;

      const offer = await tx.barterOffer.findUnique({
        where: { id: offerId },
        include: { myClass: true, offerer: { select: { nim: true, name: true, picture: true } } },
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'open') throw new Error('Offer already taken or cancelled');
      if (offer.type !== 'pick_drop') throw new Error('This offer is not a Pick & Drop offer');
      if (offer.offererNim === claimerNim) throw new Error('Cannot claim your own offer');

      if (offer.reservedForNim && offer.reservedForNim !== claimerNim) {
        throw new Error('Penawaran ini dikhususkan untuk mahasiswa lain');
      }

      const offererEnrollments = await tx.enrollment.findMany({
        where: { nim: offer.offererNim, parallelClass: { courseCode: offer.myClass.courseCode } },
        include: { parallelClass: true }
      });
      if (offererEnrollments.length === 0) throw new Error('Offerer no longer has this course package');

      const claimerExistingInCourse = await tx.enrollment.findFirst({
        where: { nim: claimerNim, parallelClass: { courseCode: offer.myClass.courseCode } },
      });
      if (claimerExistingInCourse) throw new Error(`Anda sudah mengambil mata kuliah ${offer.myClass.courseCode}`);

      const claimer = await tx.user.findUnique({ where: { nim: claimerNim }, select: { nim: true, name: true } });
      if (!claimer) throw new Error('Claimer user not found');

      const claimerOtherEnrollments = await getUserEnrollmentsExcluding(claimerNim, 0, tx);
      for (const enr of offererEnrollments) {
        const conflict = claimerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, enr.parallelClass));
        if (conflict) {
          throw new Error(
            `Jadwal bentrok: Paket ${enr.parallelClass.courseCode}-${enr.parallelClass.classCode} bertabrakan dengan ${conflict.parallelClass.courseCode}-${conflict.parallelClass.classCode} (${conflict.parallelClass.day} ${conflict.parallelClass.timeStart}–${conflict.parallelClass.timeEnd})`
          );
        }
      }

      const updateResult = await tx.barterOffer.updateMany({
        where: { id: offerId, status: 'open' },
        data: { status: 'matched', takerNim: claimerNim, completedAt: new Date() },
      });

      if (updateResult.count === 0) {
        throw new Error('Offer already taken or matched concurrently by another user');
      }

      await tx.enrollment.deleteMany({
        where: { id: { in: offererEnrollments.map(e => e.id) } }
      });

      await tx.enrollment.createMany({
        data: offererEnrollments.map(e => ({ nim: claimerNim, parallelClassId: e.parallelClassId }))
      });

      const offererNewSchedule = (await getUserEnrollmentsExcluding(offer.offererNim, 0, tx)).map(e => e.parallelClass);
      
      let offererCancelled: any[] = [];
      for (const enr of offererEnrollments) {
        const cancelled = await cancelStaleOffers(offer.offererNim, offererNewSchedule, enr.parallelClassId, tx);
        offererCancelled.push(...cancelled);
      }

      const packageClassCodes = offererEnrollments.map(e => e.parallelClass.classCode).join(' & ');

      const [offererNotification, claimerNotification] = await Promise.all([
        createNotification(tx, offer.offererNim, 'barter_matched_as_offerer', {
          offerId,
          takerNim: claimer.nim,
          takerName: claimer.name,
          yourOldClass: { courseCode: offer.myClass.courseCode, classCode: packageClassCodes },
          yourNewClass: { courseCode: offer.myClass.courseCode, classCode: 'DROPPED' },
          staleCancelledOffers: offererCancelled,
        }),
        createNotification(tx, claimerNim, 'barter_matched_as_taker', {
          offerId,
          offererNim: offer.offererNim,
          offererName: offer.offerer.name,
          yourOldClass: { courseCode: offer.myClass.courseCode, classCode: 'NONE' },
          yourNewClass: { courseCode: offer.myClass.courseCode, classCode: packageClassCodes },
          staleCancelledOffers: [],
        }),
      ]);

      return { offer, offererCancelled, offererNotification, claimerNotification, offererEnrollments };
    });

    const { offer, offererCancelled, offererNotification, claimerNotification, offererEnrollments } = result;

    const packageClassCodes = offererEnrollments.map(e => e.parallelClass.classCode).join(' & ');
    await logActivity(
      'PICK_DROP_CLAIMED',
      claimerNim,
      `Successfully claimed course package ${offer.myClass.courseCode} (${packageClassCodes}) released by ${offer.offerer.name} (${offer.offererNim}).`
    );

    io.emit('offer-taken', { offerId });
    io.emit('enrollments-swapped', {
      swaps: offererEnrollments.flatMap(e => [
        { nim: offer.offererNim, oldClassId: e.parallelClassId, newClassId: 0 },
        { nim: claimerNim, oldClassId: 0, newClassId: e.parallelClassId }
      ]),
    });

    io.to(`user-${offer.offererNim}`).emit('new-notification', offererNotification);
    io.to(`user-${claimerNim}`).emit('new-notification', claimerNotification);

    sendNotificationEmail(offer.offererNim, offererNotification.type as any, offererNotification.data).catch(console.error);
    sendNotificationEmail(claimerNim, claimerNotification.type as any, claimerNotification.data).catch(console.error);

    io.to(`user-${offer.offererNim}`).emit('barter-success', { offerId, takerNim: claimerNim });
    io.to(`user-${claimerNim}`).emit('barter-success', { offerId, offererNim: offer.offererNim });

    for (const cancelled of offererCancelled) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', cancelled);
    }

    res.json({ message: 'Class claimed successfully' });
  }));

  router.delete('/:id', requireStudent, asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const userNim = req.user!.nim;

    const offer = await prisma.barterOffer.findUnique({ 
      where: { id: offerId },
      include: { myClass: true }
    });
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.offererNim !== userNim) return res.status(403).json({ error: 'Not your offer' });
    if (offer.status !== 'open') return res.status(400).json({ error: 'Cannot cancel matched offer' });

    await prisma.$transaction(async (tx) => {
      await tx.barterOffer.update({ where: { id: offerId }, data: { status: 'cancelled' } });
      await createNotification(tx, userNim, 'barter_cancelled', {
        offerId,
        courseCode: offer.myClass.courseCode,
        classCode: offer.myClass.classCode,
        reason: 'self_cancelled'
      });
    });

    await logActivity('BARTER_CANCELLED', userNim, `Cancelled their own open barter offer (Offer ID: ${offerId}).`);

    // Ambil notifikasi yang di-generate buat dikirim lewat socket
    const notification = await prisma.notification.findFirst({
      where: { recipientNim: userNim, type: 'barter_cancelled' },
      orderBy: { createdAt: 'desc' }
    });

    if (notification) {
      io.to(`user-${userNim}`).emit('new-notification', notification);
      sendNotificationEmail(userNim, notification.type as any, notification.data).catch(console.error);
    }
    io.emit('offer-taken', { offerId });
    res.json({ message: 'Offer cancelled' });
  }));

  return router;
}