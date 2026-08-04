import { z } from 'zod';
import { prisma } from '../prisma/db';

// --- Schemas ---------------------------------------------

export const createOfferSchema = z.object({
  myClassId: z.number().int().positive(),
  wantedClassId: z.number().int().positive(),
}).refine(data => data.myClassId !== data.wantedClassId, {
  message: 'Cannot swap same class',
});

export const createBatchOfferSchema = z.object({
  offers: z.array(
    z.object({
      myClassId: z.number().int().positive(),
      wantedClassId: z.number().int().positive(),
    }).refine(data => data.myClassId !== data.wantedClassId, {
      message: 'Cannot swap same class',
    })
  ).min(1, 'Minimal 1 penawaran').max(15, 'Maksimal 15 penawaran sekaligus'),
});

export const createPickDropOfferSchema = z.object({
  myClassId: z.number().int().positive(),
  reservedForNim: z.string().regex(/^M\d{10}$/).optional().or(z.literal('')),
});

export const takeOfferSchema = z.object({
  takerNim: z.string().regex(/^M\d{10}$/),
});

export const claimPickDropOfferSchema = z.object({
  claimerNim: z.string().regex(/^M\d{10}$/),
});

const staleCancelledOfferSchema = z.object({
  offerId: z.number(),
  reason: z.enum(['no_longer_enrolled', 'schedule_conflict']),
  myClassId: z.number(),
  wantedClassId: z.number(),
  conflictingClass: z.string().optional(),
});

const classRefSchema = z.object({ courseCode: z.string(), classCode: z.string() });
const staleCancelledArray = z.array(staleCancelledOfferSchema);

export const barterMatchedAsOffererDataSchema = z.object({
  offerId: z.number(),
  takerNim: z.string(),
  takerName: z.string(),
  yourOldClass: classRefSchema,
  yourNewClass: classRefSchema,
  staleCancelledOffers: staleCancelledArray,
});

export const barterMatchedAsTakerDataSchema = z.object({
  offerId: z.number(),
  offererNim: z.string(),
  offererName: z.string(),
  yourOldClass: classRefSchema,
  yourNewClass: classRefSchema,
  staleCancelledOffers: staleCancelledArray,
});

const barterAutoMatchedDataSchema = z.object({
  offerId: z.number(),
  counterpartNim: z.string(),
  counterpartName: z.string(),
  yourOldClass: classRefSchema,
  yourNewClass: classRefSchema,
  staleCancelledOffers: staleCancelledArray,
});

export const barterCancelledDataSchema = z.object({
  offerId: z.number(),
  courseCode: z.string(),
  classCode: z.string(),
  reason: z.string().optional(),
});

export const adminEnrollmentUpdatedDataSchema = z.object({
  courseCode: z.string(),
  oldClassCode: z.string(),
  newClassCode: z.string(),
});

export const adminEnrollmentDeletedDataSchema = z.object({
  courseCode: z.string(),
  classCode: z.string(),
});

export const adminOverrideSwapDataSchema = z.object({
  courseCode: z.string(),
  counterpartNim: z.string(),
  counterpartName: z.string(),
  oldClassCode: z.string(),
  newClassCode: z.string(),
});

// --- Types ---------------------------------------------

export type StaleCancelledOffer     = z.infer<typeof staleCancelledOfferSchema>;
export type BarterMatchedAsOffererData = z.infer<typeof barterMatchedAsOffererDataSchema>;
export type BarterMatchedAsTakerData   = z.infer<typeof barterMatchedAsTakerDataSchema>;
export type BarterAutoMatchedData      = z.infer<typeof barterAutoMatchedDataSchema>;
export type BarterCancelledData        = z.infer<typeof barterCancelledDataSchema>;
export type AdminEnrollmentUpdatedData = z.infer<typeof adminEnrollmentUpdatedDataSchema>;
export type AdminEnrollmentDeletedData = z.infer<typeof adminEnrollmentDeletedDataSchema>;
export type AdminOverrideSwapData      = z.infer<typeof adminOverrideSwapDataSchema>;

export type NotificationData = 
  | BarterMatchedAsOffererData 
  | BarterMatchedAsTakerData 
  | BarterAutoMatchedData
  | BarterCancelledData
  | AdminEnrollmentUpdatedData
  | AdminEnrollmentDeletedData
  | AdminOverrideSwapData;

export type NotificationType = 
  | 'barter_matched_as_offerer' 
  | 'barter_matched_as_taker' 
  | 'barter_auto_matched'
  | 'barter_cancelled'
  | 'admin_barter_cancelled'
  | 'admin_enrollment_updated'
  | 'admin_enrollment_deleted'
  | 'admin_override_swap';

type ClassSchedule = { day: string; timeStart: string; timeEnd: string };
export type EnrollmentWithClass = {
  parallelClassId: number;
  parallelClass: ClassSchedule & { id: number; classCode: string; courseCode: string };
};

// --- Helpers ---------------------------------------------

// irisan interval: A.start < B.end && B.start < A.end
// aman pakai perbandingan string karena format "HH:MM" zero-padded
export function hasScheduleConflict(a: ClassSchedule, b: ClassSchedule): boolean {
  if (a.day !== b.day) return false;
  return a.timeStart < b.timeEnd && b.timeStart < a.timeEnd;
}

export async function getUserEnrollmentsExcluding(
  nim: string,
  excludeClassId: number,
  tx: any = prisma
): Promise<EnrollmentWithClass[]> {
  return tx.enrollment.findMany({
    where: { nim, parallelClassId: { not: excludeClassId } },
    include: { parallelClass: true },
  });
}

export async function cancelStaleOffers(
  nim: string,
  newSchedule: EnrollmentWithClass['parallelClass'][],
  lostClassId: number,
  tx: any
): Promise<StaleCancelledOffer[]> {
  const openOffers = await tx.barterOffer.findMany({
    where: { offererNim: nim, status: 'open' },
    include: { wantedClass: true, myClass: true },
  });

  const cancelled: StaleCancelledOffer[] = [];
  const processedBatchGroupIds = new Set<string>();

  for (const offer of openOffers) {
    // Skip if already cancelled as part of a batch
    if (cancelled.some(c => c.offerId === offer.id)) continue;

    let shouldCancel = false;
    let cancelReason: 'no_longer_enrolled' | 'schedule_conflict' = 'no_longer_enrolled';
    let conflictingClassStr: string | undefined;

    if (offer.myClassId === lostClassId) {
      shouldCancel = true;
      cancelReason = 'no_longer_enrolled';
    } else {
      const scheduleWithoutMyClass = newSchedule.filter(c => c.id !== offer.myClassId);
      const conflict = scheduleWithoutMyClass.find(c => hasScheduleConflict(c, offer.wantedClass));
      if (conflict) {
        shouldCancel = true;
        cancelReason = 'schedule_conflict';
        conflictingClassStr = `${conflict.courseCode}-${conflict.classCode}`;
      }
    }

    if (shouldCancel) {
      if (offer.batchGroupId && !processedBatchGroupIds.has(offer.batchGroupId)) {
        processedBatchGroupIds.add(offer.batchGroupId);
        // Cascade to all sibling offers in this batch
        const batchSiblings = openOffers.filter((o: any) => o.batchGroupId === offer.batchGroupId);
        for (const sibling of batchSiblings) {
          await tx.barterOffer.update({ where: { id: sibling.id }, data: { status: 'cancelled' } });
          cancelled.push({
            offerId: sibling.id,
            reason: cancelReason,
            myClassId: sibling.myClassId,
            wantedClassId: sibling.wantedClassId,
            conflictingClass: conflictingClassStr,
          });
        }
      } else if (!offer.batchGroupId) {
        await tx.barterOffer.update({ where: { id: offer.id }, data: { status: 'cancelled' } });
        cancelled.push({
          offerId: offer.id,
          reason: cancelReason,
          myClassId: offer.myClassId,
          wantedClassId: offer.wantedClassId,
          conflictingClass: conflictingClassStr,
        });
      }
    }
  }

  return cancelled;
}

export async function createNotification(
  tx: any,
  recipientNim: string,
  type: NotificationType,
  data: NotificationData
) {
  return tx.notification.create({ data: { recipientNim, type, data } });
}

export async function autoMatch(newOffer: {
  id: number;
  offererNim: string;
  myClassId: number;
  wantedClassId: number;
}, externalTx?: any): Promise<{
  matched: boolean;
  matchingOffer?: any;
  offer?: any;
  offererNotification?: any;
  takerNotification?: any;
  offererCancelled?: StaleCancelledOffer[];
  takerCancelled?: StaleCancelledOffer[];
  swaps?: { nim: string; oldClassId: number; newClassId: number }[];
}> {
  const run = async (tx: any) => {
    // lock offer yang cocok langsung di dalam transaksi biar ga race condition
    const matchingOffer = await tx.barterOffer.findFirst({
      where: {
        status: 'open',
        myClassId: newOffer.wantedClassId,
        wantedClassId: newOffer.myClassId,
        offererNim: { not: newOffer.offererNim },
      },
      include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true } } },
    });

    if (!matchingOffer) return { matched: false };

    const offer = await tx.barterOffer.findUnique({
      where: { id: newOffer.id },
      include: { myClass: true, wantedClass: true, offerer: { select: { nim: true, name: true } } },
    });

    if (!offer) return { matched: false };

    const [offererStillEnrolled, takerStillEnrolled] = await Promise.all([
      tx.enrollment.findFirst({ where: { nim: matchingOffer.offererNim, parallelClassId: matchingOffer.myClassId } }),
      tx.enrollment.findFirst({ where: { nim: offer.offererNim, parallelClassId: offer.myClassId } }),
    ]);

    if (!offererStillEnrolled || !takerStillEnrolled) return { matched: false };

    const [offererOtherEnrollments, takerOtherEnrollments] = await Promise.all([
      getUserEnrollmentsExcluding(matchingOffer.offererNim, matchingOffer.myClassId, tx),
      getUserEnrollmentsExcluding(offer.offererNim, offer.myClassId, tx),
    ]);

    const offererConflict = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, matchingOffer.wantedClass));
    const takerConflict   = takerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.wantedClass));

    // kalo ada konflik, biarkan user handle manual
    if (offererConflict || takerConflict) return { matched: false };

    const now = new Date();

    // Atomic conditional status update to claim both offers and fully prevent concurrent collisions
    const [matchingOfferUpdate, offerUpdate] = await Promise.all([
      tx.barterOffer.updateMany({
        where: { id: matchingOffer.id, status: 'open' },
        data: { status: 'matched', takerNim: offer.offererNim, completedAt: now }
      }),
      tx.barterOffer.updateMany({
        where: { id: offer.id, status: 'open' },
        data: { status: 'matched', takerNim: matchingOffer.offererNim, completedAt: now }
      })
    ]);

    if (matchingOfferUpdate.count === 0 || offerUpdate.count === 0) {
      throw new Error('Concurrent auto-match collision: offer already claimed');
    }

    await Promise.all([
      tx.enrollment.updateMany({ where: { nim: matchingOffer.offererNim, parallelClassId: matchingOffer.myClassId }, data: { parallelClassId: matchingOffer.wantedClassId } }),
      tx.enrollment.updateMany({ where: { nim: offer.offererNim, parallelClassId: offer.myClassId }, data: { parallelClassId: offer.wantedClassId } }),
    ]);

    const offererNewSchedule = [...offererOtherEnrollments.map(e => e.parallelClass), matchingOffer.wantedClass];
    const takerNewSchedule   = [...takerOtherEnrollments.map(e => e.parallelClass), offer.wantedClass];

    const [offererCancelled, takerCancelled] = await Promise.all([
      cancelStaleOffers(matchingOffer.offererNim, offererNewSchedule, matchingOffer.myClassId, tx),
      cancelStaleOffers(offer.offererNim, takerNewSchedule, offer.myClassId, tx),
    ]);

    const [offererNotification, takerNotification] = await Promise.all([
      createNotification(tx, matchingOffer.offererNim, 'barter_auto_matched', {
        offerId: matchingOffer.id,
        counterpartNim: offer.offererNim,
        counterpartName: offer.offerer.name,
        yourOldClass: { courseCode: matchingOffer.myClass.courseCode, classCode: matchingOffer.myClass.classCode },
        yourNewClass: { courseCode: matchingOffer.wantedClass.courseCode, classCode: matchingOffer.wantedClass.classCode },
        staleCancelledOffers: offererCancelled,
      }),
      createNotification(tx, offer.offererNim, 'barter_auto_matched', {
        offerId: offer.id,
        counterpartNim: matchingOffer.offererNim,
        counterpartName: matchingOffer.offerer.name,
        yourOldClass: { courseCode: offer.myClass.courseCode, classCode: offer.myClass.classCode },
        yourNewClass: { courseCode: offer.wantedClass.courseCode, classCode: offer.wantedClass.classCode },
        staleCancelledOffers: takerCancelled,
      }),
    ]);

    return {
      matched: true,
      matchingOffer,
      offer,
      offererNotification,
      takerNotification,
      offererCancelled,
      takerCancelled,
      swaps: [
        { nim: matchingOffer.offererNim, oldClassId: matchingOffer.myClassId, newClassId: matchingOffer.wantedClassId },
        { nim: offer.offererNim, oldClassId: offer.myClassId, newClassId: offer.wantedClassId },
      ],
    };
  };

  if (externalTx) {
    return run(externalTx);
  }
  return prisma.$transaction(run);
}