import { Router } from 'express';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { requireAuth, requireStudent } from '../middleware/authMiddleware';
import { requireBarterEnabled } from '../middleware/requireBarterEnabled';
import { validate, asyncHandler } from '../middleware/helpers';
import { prisma } from '../prisma/db';
import {
  createOfferSchema,
  createBatchOfferSchema,
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

  router.post('/batch', requireStudent, requireBarterEnabled, validate(createBatchOfferSchema), asyncHandler(async (req: any, res: any) => {
    const { offers } = req.body as { offers: { myClassId: number; wantedClassId: number }[] };
    const offererNim = req.user!.nim;

    const createdItems: { offer: any; myClass: any; wantedClass: any }[] = [];
    const skippedItems: { myClassId: number; wantedClassId: number; reason: string }[] = [];
    const batchGroupId = randomUUID();

    try {
      const validatedItems: any[] = [];
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${offererNim} FOR UPDATE`;

        const myClassIdsSeen = new Set<number>();
        for (const item of offers) {
          const { myClassId, wantedClassId } = item;

          if (myClassIdsSeen.has(myClassId)) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Kelas sumber tidak boleh sama dalam satu paket' });
            continue;
          }
          myClassIdsSeen.add(myClassId);

          const enrollment = await tx.enrollment.findFirst({ where: { nim: offererNim, parallelClassId: myClassId } });
          if (!enrollment) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Anda tidak terdaftar di kelas sumber ini' });
            continue;
          }

          const duplicateOffer = await tx.barterOffer.findFirst({ where: { offererNim, myClassId, status: 'open' } });
          if (duplicateOffer) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Penawaran untuk kelas ini sudah ada yang aktif' });
            continue;
          }

          const [myClass, wantedClass] = await Promise.all([
            tx.parallelClass.findUnique({ where: { id: myClassId } }),
            tx.parallelClass.findUnique({ where: { id: wantedClassId } }),
          ]);

          if (!myClass || !wantedClass) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Detail kelas tidak ditemukan' });
            continue;
          }

          if (myClass.courseCode !== wantedClass.courseCode) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Mata kuliah harus sama' });
            continue;
          }

          if (myClass.classCode[0] !== wantedClass.classCode[0]) {
            skippedItems.push({ myClassId, wantedClassId, reason: 'Tipe kelas harus sejenis (K⇌K, P⇌P, R⇌R)' });
            continue;
          }

          const offererOtherEnrollments = await getUserEnrollmentsExcluding(offererNim, myClassId, tx);
          const conflictingClass = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, wantedClass));
          if (conflictingClass) {
            skippedItems.push({
              myClassId,
              wantedClassId,
              reason: `Bentrok dengan ${conflictingClass.parallelClass.courseCode}-${conflictingClass.parallelClass.classCode} (${conflictingClass.parallelClass.day})`,
            });
            continue;
          }
          
          validatedItems.push({ myClassId, wantedClassId, myClass, wantedClass });
        }

        // Intra-batch schedule conflict validation between wanted classes
        for (let i = 0; i < validatedItems.length; i++) {
          for (let j = i + 1; j < validatedItems.length; j++) {
            if (hasScheduleConflict(validatedItems[i].wantedClass, validatedItems[j].wantedClass)) {
              skippedItems.push({
                myClassId: validatedItems[j].myClassId,
                wantedClassId: validatedItems[j].wantedClassId,
                reason: `Kelas tujuan bentrok dengan kelas lain dalam paket yang sama`,
              });
            }
          }
        }

        if (skippedItems.length > 0) {
          throw { isBatchValidationError: true, skippedItems };
        }

        for (const item of validatedItems) {
          const offer = await tx.barterOffer.create({
            data: { offererNim, myClassId: item.myClassId, wantedClassId: item.wantedClassId, status: 'open', batchGroupId },
            include: { offerer: { select: { nim: true, name: true, picture: true } }, myClass: true, wantedClass: true },
          });

          createdItems.push({ offer, myClass: item.myClass, wantedClass: item.wantedClass });
        }
      });

      // Post transaction: notify socket (no auto-match for batch packages)
      if (createdItems.length > 0) {
        await logActivity(
          'BARTER_CREATED',
          offererNim,
          `[BATCH] Created ${createdItems.length} open barter offers as a single package.`
        );
        const offersPayload = createdItems.map(i => i.offer);
        io.emit('new-batch-offer', offersPayload);
      }

      return res.status(201).json({
        created: createdItems.map(i => i.offer),
        skipped: skippedItems,
      });
    } catch (err: any) {
      if (err.isBatchValidationError) {
        return res.status(400).json({ 
          error: 'Beberapa kelas gagal divalidasi. Seluruh paket dibatalkan.', 
          skipped: err.skippedItems 
        });
      }
      return res.status(400).json({ error: err.message });
    }
  }));

  router.post('/:id/take', requireStudent, requireBarterEnabled, validate(takeOfferSchema), asyncHandler(async (req: any, res: any) => {
    const offerId = parseInt(req.params.id);
    const { takerNim } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Pessimistic session lock: serialize concurrent actions from the same student
      await tx.$queryRaw`SELECT nim FROM users WHERE nim = ${takerNim} FOR UPDATE`;

      const initialOffer = await tx.barterOffer.findUnique({
        where: { id: offerId },
        include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true, picture: true } } },
      });

      if (!initialOffer) throw new Error('Offer not found');
      if (initialOffer.status !== 'open') throw new Error('Offer already taken');
      if (initialOffer.type !== 'swap' || !initialOffer.wantedClassId || !initialOffer.wantedClass) {
        throw new Error('This is a Pick & Drop offer, use the claim endpoint instead');
      }
      if (initialOffer.offererNim === takerNim) throw new Error('Cannot take your own offer');

      let offersToProcess = [initialOffer];
      if (initialOffer.batchGroupId) {
        const allBatchOffers = await tx.barterOffer.findMany({
          where: { batchGroupId: initialOffer.batchGroupId },
          include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true, picture: true } } },
        });
        const openBatchOffers = allBatchOffers.filter(o => o.status === 'open');
        if (allBatchOffers.length === 0 || openBatchOffers.length !== allBatchOffers.length) {
          throw new Error('Paket penawaran ini sudah tidak utuh lagi atau tidak tersedia');
        }
        offersToProcess = openBatchOffers;
      }
      
      const offererNim = initialOffer.offererNim;
      const taker = await tx.user.findUnique({ where: { nim: takerNim }, select: { nim: true, name: true } });
      if (!taker) throw new Error('Taker user not found');

      // Verify enrollments
      for (const offer of offersToProcess) {
        const offererStillEnrolled = await tx.enrollment.findFirst({
          where: { nim: offer.offererNim, parallelClassId: offer.myClassId },
        });
        if (!offererStillEnrolled) throw new Error(`Offerer no longer has class ${offer.myClass.courseCode}-${offer.myClass.classCode}`);

        const takerEnrollment = await tx.enrollment.findFirst({
          where: { nim: takerNim, parallelClassId: offer.wantedClassId! },
        });
        if (!takerEnrollment) throw new Error(`You are not enrolled in the wanted class ${offer.wantedClass!.courseCode}-${offer.wantedClass!.classCode}`);
      }

      // Check conflicts
      // Exclude ALL classes the taker will lose
      let takerOtherEnrollments = await tx.enrollment.findMany({
        where: { nim: takerNim, parallelClassId: { notIn: offersToProcess.map(o => o.wantedClassId!) } },
        include: { parallelClass: true },
      });
      // Exclude ALL classes the offerer will lose
      let offererOtherEnrollments = await tx.enrollment.findMany({
        where: { nim: offererNim, parallelClassId: { notIn: offersToProcess.map(o => o.myClassId) } },
        include: { parallelClass: true },
      });

      for (const offer of offersToProcess) {
        // Taker will get offer.myClass
        const takerConflict = takerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.myClass));
        if (takerConflict) {
          throw new Error(`Jadwal bentrok bagi Anda: ${offer.myClass.courseCode}-${offer.myClass.classCode} bertabrakan dengan ${takerConflict.parallelClass.courseCode}-${takerConflict.parallelClass.classCode}`);
        }
        // Add newly acquired class to taker's schedule for subsequent conflict checks within the same batch
        takerOtherEnrollments.push({ parallelClassId: offer.myClassId, parallelClass: offer.myClass as any } as any);

        // Offerer will get offer.wantedClass
        const offererConflict = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.wantedClass!));
        if (offererConflict) throw new Error(`Offerer now has a schedule conflict with class ${offer.wantedClass!.courseCode}-${offer.wantedClass!.classCode}`);
        // Add newly acquired class to offerer's schedule for subsequent conflict checks within the same batch
        offererOtherEnrollments.push({ parallelClassId: offer.wantedClassId!, parallelClass: offer.wantedClass as any } as any);
      }

      // Atomic conditional update
      const updateResult = await tx.barterOffer.updateMany({
        where: { id: { in: offersToProcess.map(o => o.id) }, status: 'open' },
        data: { status: 'matched', takerNim, completedAt: new Date() }
      });

      if (updateResult.count !== offersToProcess.length) {
        throw new Error('Offer already taken or matched concurrently by another user');
      }

      // Swap enrollments
      await tx.enrollment.deleteMany({
        where: { OR: [
          { nim: offererNim, parallelClassId: { in: offersToProcess.map(o => o.myClassId) } },
          { nim: takerNim, parallelClassId: { in: offersToProcess.map(o => o.wantedClassId!) } }
        ]}
      });
      await tx.enrollment.createMany({
        data: [
          ...offersToProcess.map(o => ({ nim: offererNim, parallelClassId: o.wantedClassId! })),
          ...offersToProcess.map(o => ({ nim: takerNim, parallelClassId: o.myClassId }))
        ]
      });

      let offererCancelled: any[] = [];
      let takerCancelled: any[] = [];
      
      const offererNewSchedule = (await tx.enrollment.findMany({ where: { nim: offererNim }, include: { parallelClass: true } })).map(e => e.parallelClass);
      const takerNewSchedule = (await tx.enrollment.findMany({ where: { nim: takerNim }, include: { parallelClass: true } })).map(e => e.parallelClass);

      for (const offer of offersToProcess) {
        const oc = await cancelStaleOffers(offererNim, offererNewSchedule, offer.myClassId, tx);
        offererCancelled.push(...oc);
        const tc = await cancelStaleOffers(takerNim, takerNewSchedule, offer.wantedClassId!, tx);
        takerCancelled.push(...tc);
      }

      const isPackage = offersToProcess.length > 1;
      const combinedOldClassCodesOfferer = offersToProcess.map(o => o.myClass.classCode).join(', ');
      const combinedNewClassCodesOfferer = offersToProcess.map(o => o.wantedClass!.classCode).join(', ');
      const courseCode = offersToProcess[0].myClass.courseCode;
      const displayCourseCode = isPackage ? "Package" : courseCode;

      const [offererNotification, takerNotification] = await Promise.all([
        createNotification(tx, offererNim, 'barter_matched_as_offerer', {
          offerId: initialOffer.id,
          takerNim: taker.nim,
          takerName: taker.name,
          yourOldClass: { courseCode: displayCourseCode, classCode: combinedOldClassCodesOfferer },
          yourNewClass: { courseCode: displayCourseCode, classCode: combinedNewClassCodesOfferer },
          staleCancelledOffers: offererCancelled,
        }),
        createNotification(tx, takerNim, 'barter_matched_as_taker', {
          offerId: initialOffer.id,
          offererNim: offererNim,
          offererName: initialOffer.offerer.name,
          yourOldClass: { courseCode: displayCourseCode, classCode: combinedNewClassCodesOfferer },
          yourNewClass: { courseCode: displayCourseCode, classCode: combinedOldClassCodesOfferer },
          staleCancelledOffers: takerCancelled,
        }),
      ]);

      return { offersToProcess, taker, offererNim, offererName: initialOffer.offerer.name, offererCancelled, takerCancelled, offererNotification, takerNotification, displayCourseCode, combinedOldClassCodesOfferer, combinedNewClassCodesOfferer };
    });

    const { offersToProcess, taker, offererNim, offererName, offererCancelled, takerCancelled, offererNotification, takerNotification, displayCourseCode, combinedOldClassCodesOfferer, combinedNewClassCodesOfferer } = result;

    await logActivity(
      'BARTER_MATCHED',
      takerNim,
      `Successfully matched with ${offererName} (${offererNim}) for course ${displayCourseCode}. Swapped ${combinedNewClassCodesOfferer} for ${combinedOldClassCodesOfferer}.`
    );

    const swaps = [];
    for (const offer of offersToProcess) {
      io.emit('offer-taken', { offerId: offer.id });
      swaps.push({ nim: offererNim, oldClassId: offer.myClassId, newClassId: offer.wantedClassId! });
      swaps.push({ nim: takerNim, oldClassId: offer.wantedClassId!, newClassId: offer.myClassId });
    }
    
    io.emit('enrollments-swapped', { swaps });

    io.to(`user-${offererNim}`).emit('new-notification', offererNotification);
    io.to(`user-${takerNim}`).emit('new-notification', takerNotification);

    sendNotificationEmail(offererNim, offererNotification.type as any, offererNotification.data).catch(console.error);
    sendNotificationEmail(takerNim, takerNotification.type as any, takerNotification.data).catch(console.error);

    io.to(`user-${offererNim}`).emit('barter-success', { offerId: offersToProcess[0].id, takerNim });
    io.to(`user-${takerNim}`).emit('barter-success', { offerId: offersToProcess[0].id, offererNim });

    for (const cancelled of offererCancelled) {
      io.emit('offer-taken', { offerId: cancelled.offerId });
      io.to(`user-${offererNim}`).emit('offer-auto-cancelled', cancelled);
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

    let cancelledIds: number[] = [];
    await prisma.$transaction(async (tx) => {
      if (offer.batchGroupId) {
        const batchOffers = await tx.barterOffer.findMany({
          where: { batchGroupId: offer.batchGroupId, status: 'open' },
          include: { myClass: true }
        });
        for (const bo of batchOffers) {
          await tx.barterOffer.update({ where: { id: bo.id }, data: { status: 'cancelled' } });
          cancelledIds.push(bo.id);
          await createNotification(tx, userNim, 'barter_cancelled', {
            offerId: bo.id,
            courseCode: bo.myClass.courseCode,
            classCode: bo.myClass.classCode,
            reason: 'self_cancelled'
          });
        }
      } else {
        await tx.barterOffer.update({ where: { id: offerId }, data: { status: 'cancelled' } });
        cancelledIds.push(offerId);
        await createNotification(tx, userNim, 'barter_cancelled', {
          offerId,
          courseCode: offer.myClass.courseCode,
          classCode: offer.myClass.classCode,
          reason: 'self_cancelled'
        });
      }
    });

    await logActivity('BARTER_CANCELLED', userNim, `Cancelled open barter offer(s) (Offer ID: ${cancelledIds.join(', ')}).`);

    // Ambil notifikasi yang di-generate buat dikirim lewat socket
    const notifications = await prisma.notification.findMany({
      where: { recipientNim: userNim, type: 'barter_cancelled' },
      orderBy: { createdAt: 'desc' },
      take: cancelledIds.length > 0 ? cancelledIds.length : 1
    });

    if (notifications && Array.isArray(notifications)) {
      for (const notification of notifications) {
        io.to(`user-${userNim}`).emit('new-notification', notification);
        sendNotificationEmail(userNim, notification.type as any, notification.data).catch(console.error);
      }
    }
    
    for (const cid of cancelledIds) {
      io.emit('offer-taken', { offerId: cid });
    }
    res.json({ message: 'Offer cancelled' });
  }));

  return router;
}