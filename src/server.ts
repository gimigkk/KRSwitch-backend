import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { z } from 'zod';

dotenv.config();

const app = express();
const server = http.createServer(app);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE']
  }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// ===== VALIDATION =====
const createOfferSchema = z.object({
  myClassId: z.number().int().positive(),
  wantedClassId: z.number().int().positive(),
}).refine(data => data.myClassId !== data.wantedClassId, {
  message: 'Cannot swap same class'
});

const takeOfferSchema = z.object({
  takerNim: z.string().regex(/^M\d{10}$/),
});

// ===== TYPES =====

type ClassSchedule = { day: string; timeStart: string; timeEnd: string };
type EnrollmentWithClass = {
  parallelClassId: number;
  parallelClass: ClassSchedule & { id: number; classCode: string; courseCode: string };
};

// ===== HELPERS =====

/**
 * Cek apakah dua kelas bentrok jadwalnya.
 * Menggunakan interval overlap: A.start < B.end && B.start < A.end.
 * Asumsi format timeStart/timeEnd: "HH:MM" (zero-padded, aman untuk perbandingan string).
 */
function hasScheduleConflict(classA: ClassSchedule, classB: ClassSchedule): boolean {
  if (classA.day !== classB.day) return false;
  return classA.timeStart < classB.timeEnd && classB.timeStart < classA.timeEnd;
}

/**
 * Ambil semua enrollment user beserta data kelas-nya, kecuali satu kelas yang dikecualikan.
 * Kelas yang dikecualikan adalah kelas yang sedang ditawarkan (akan dilepas saat swap).
 * Menerima tx opsional untuk dipakai di dalam transaksi Prisma.
 */
async function getUserEnrollmentsExcluding(
  nim: string,
  excludeClassId: number,
  tx: any = prisma
): Promise<EnrollmentWithClass[]> {
  return tx.enrollment.findMany({
    where: { nim, parallelClassId: { not: excludeClassId } },
    include: { parallelClass: true }
  });
}

/**
 * Batalkan otomatis penawaran-penawaran terbuka user yang tidak lagi valid setelah swap selesai.
 * Dua kondisi pembatalan:
 *   - 'no_longer_enrolled': myClassId yang ditawarkan sudah bukan milik user.
 *   - 'schedule_conflict': wantedClass di penawaran itu bentrok dengan jadwal baru user.
 * Harus dipanggil di dalam transaksi yang sama dengan swap agar atomik.
 */
async function cancelStaleOffers(
  nim: string,
  newSchedule: EnrollmentWithClass["parallelClass"][],
  lostClassId: number,
  tx: any
): Promise<{ offerId: number; reason: string; conflictingClass?: string }[]> {
  const openOffers = await tx.barterOffer.findMany({
    where: { offererNim: nim, status: 'open' },
    include: { wantedClass: true }
  });

  const cancelled: { offerId: number; reason: string; conflictingClass?: string }[] = [];

  for (const offer of openOffers) {
    if (offer.myClassId === lostClassId) {
      await tx.barterOffer.update({ where: { id: offer.id }, data: { status: 'cancelled' } });
      cancelled.push({ offerId: offer.id, reason: 'no_longer_enrolled' });
      continue;
    }

    const conflict = newSchedule.find(c => hasScheduleConflict(c, offer.wantedClass));
    if (conflict) {
      await tx.barterOffer.update({ where: { id: offer.id }, data: { status: 'cancelled' } });
      cancelled.push({
        offerId: offer.id,
        reason: 'schedule_conflict',
        conflictingClass: `${conflict.courseCode}-${conflict.classCode}`
      });
    }
  }

  return cancelled;
}

// ===== MIDDLEWARE =====
const validate = (schema: z.ZodSchema) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      next(error);
    }
  };
};

const asyncHandler = (fn: Function) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ===== ROUTES =====

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KRSwitch Backend Running' });
});

app.get('/api/users', asyncHandler(async (req: express.Request, res: express.Response) => {
  const users = await prisma.user.findMany({
    select: { nim: true, name: true, email: true }
  });
  res.json(users);
}));

// TODO: ganti dengan auth middleware setelah implementasi login
app.get('/api/me', asyncHandler(async (req: express.Request, res: express.Response) => {
  const user = await prisma.user.findUnique({
    where: { nim: 'M6401211001' },
    select: { nim: true, name: true, email: true }
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}));

app.get('/api/classes', asyncHandler(async (req: express.Request, res: express.Response) => {
  const classes = await prisma.parallelClass.findMany({
    orderBy: [{ courseCode: 'asc' }, { classCode: 'asc' }]
  });
  res.json(classes);
}));

app.get('/api/enrollments', asyncHandler(async (req: express.Request, res: express.Response) => {
  const enrollments = await prisma.enrollment.findMany();
  res.json(enrollments);
}));

app.get('/api/offers', asyncHandler(async (req: express.Request, res: express.Response) => {
  const offers = await prisma.barterOffer.findMany({
    where: { status: 'open' },
    include: {
      offerer: { select: { nim: true, name: true } },
      myClass: true,
      wantedClass: true
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(offers);
}));

app.post('/api/offers', validate(createOfferSchema), asyncHandler(async (req: express.Request, res: express.Response) => {
  const { myClassId, wantedClassId } = req.body;
  const offererNim = req.body.offererNim || 'M6401211001';

  const enrollment = await prisma.enrollment.findFirst({
    where: { nim: offererNim, parallelClassId: myClassId }
  });
  if (!enrollment) {
    return res.status(400).json({ error: 'You are not enrolled in this class' });
  }

  const duplicateOffer = await prisma.barterOffer.findFirst({
    where: { offererNim, myClassId, status: 'open' }
  });
  if (duplicateOffer) {
    return res.status(400).json({ error: 'You already have an open offer for this class' });
  }

  const [myClass, wantedClass] = await Promise.all([
    prisma.parallelClass.findUnique({ where: { id: myClassId } }),
    prisma.parallelClass.findUnique({ where: { id: wantedClassId } })
  ]);

  if (!myClass || !wantedClass) {
    return res.status(404).json({ error: 'Class not found' });
  }

  if (myClass.courseCode !== wantedClass.courseCode) {
    return res.status(400).json({ error: 'Must be same course' });
  }

  if (myClass.classCode[0] !== wantedClass.classCode[0]) {
    return res.status(400).json({ error: 'Must be same type (K⇌K, P⇌P, R⇌R)' });
  }

  const offererOtherEnrollments = await getUserEnrollmentsExcluding(offererNim, myClassId);
  const conflictingClass = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, wantedClass));
  if (conflictingClass) {
    return res.status(400).json({
      error: `Jadwal bentrok: ${wantedClass.courseCode}-${wantedClass.classCode} bertabrakan dengan ${conflictingClass.parallelClass.courseCode}-${conflictingClass.parallelClass.classCode} (${conflictingClass.parallelClass.day} ${conflictingClass.parallelClass.timeStart}–${conflictingClass.parallelClass.timeEnd})`
    });
  }

  const offer = await prisma.barterOffer.create({
    data: { offererNim, myClassId, wantedClassId, status: 'open' },
    include: {
      offerer: { select: { nim: true, name: true } },
      myClass: true,
      wantedClass: true
    }
  });

  io.emit('new-offer', offer);
  res.status(201).json(offer);
}));

app.post('/api/offers/:id/take', validate(takeOfferSchema), asyncHandler(async (req: express.Request, res: express.Response) => {
  const offerId = parseInt(req.params.id as string);
  const { takerNim } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.barterOffer.findUnique({
      where: { id: offerId },
      include: { myClass: true, wantedClass: true }
    });

    if (!offer) throw new Error('Offer not found');
    if (offer.status !== 'open') throw new Error('Offer already taken');
    if (offer.offererNim === takerNim) throw new Error('Cannot take your own offer');

    // Validasi ulang: offerer mungkin sudah swap di penawaran lain sejak offer ini dibuat
    const offererStillEnrolled = await tx.enrollment.findFirst({
      where: { nim: offer.offererNim, parallelClassId: offer.myClassId }
    });
    if (!offererStillEnrolled) throw new Error('Offerer no longer has this class');

    const takerEnrollment = await tx.enrollment.findFirst({
      where: { nim: takerNim, parallelClassId: offer.wantedClassId }
    });
    if (!takerEnrollment) throw new Error('You are not enrolled in the wanted class');

    const takerOtherEnrollments = await getUserEnrollmentsExcluding(takerNim, offer.wantedClassId, tx);
    const takerConflict = takerOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.myClass));
    if (takerConflict) {
      throw new Error(
        `Jadwal bentrok: ${offer.myClass.courseCode}-${offer.myClass.classCode} bertabrakan dengan ${takerConflict.parallelClass.courseCode}-${takerConflict.parallelClass.classCode} (${takerConflict.parallelClass.day} ${takerConflict.parallelClass.timeStart}–${takerConflict.parallelClass.timeEnd})`
      );
    }

    // Re-validasi jadwal offerer — bisa berubah sejak offer dibuat
    const offererOtherEnrollments = await getUserEnrollmentsExcluding(offer.offererNim, offer.myClassId, tx);
    const offererConflict = offererOtherEnrollments.find(e => hasScheduleConflict(e.parallelClass, offer.wantedClass));
    if (offererConflict) {
      throw new Error('Offerer now has a schedule conflict with the wanted class');
    }

    await tx.barterOffer.update({
      where: { id: offerId },
      data: { status: 'matched', takerNim, completedAt: new Date() }
    });

    await tx.enrollment.updateMany({
      where: { nim: offer.offererNim, parallelClassId: offer.myClassId },
      data: { parallelClassId: offer.wantedClassId }
    });
    await tx.enrollment.updateMany({
      where: { nim: takerNim, parallelClassId: offer.wantedClassId },
      data: { parallelClassId: offer.myClassId }
    });

    const offererNewSchedule = [...offererOtherEnrollments.map(e => e.parallelClass), offer.wantedClass];
    const takerNewSchedule = [...takerOtherEnrollments.map(e => e.parallelClass), offer.myClass];

    const offererCancelled = await cancelStaleOffers(offer.offererNim, offererNewSchedule, offer.myClassId, tx);
    const takerCancelled = await cancelStaleOffers(takerNim, takerNewSchedule, offer.wantedClassId, tx);

    return { offer, offererCancelled, takerCancelled };
  });

  const { offer, offererCancelled, takerCancelled } = result;

  io.emit('offer-taken', { offerId });
  io.emit('enrollments-swapped', {
    swaps: [
      { nim: offer.offererNim, oldClassId: offer.myClassId, newClassId: offer.wantedClassId },
      { nim: takerNim, oldClassId: offer.wantedClassId, newClassId: offer.myClassId }
    ]
  });
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

app.delete('/api/offers/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const offerId = parseInt(req.params.id as string);
  const userNim = 'M6401211001';

  const offer = await prisma.barterOffer.findUnique({ where: { id: offerId } });
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.offererNim !== userNim) return res.status(403).json({ error: 'Not your offer' });
  if (offer.status !== 'open') return res.status(400).json({ error: 'Cannot cancel matched offer' });

  await prisma.barterOffer.update({
    where: { id: offerId },
    data: { status: 'cancelled' }
  });

  io.emit('offer-taken', { offerId });
  res.json({ message: 'Offer cancelled' });
}));

// ===== ERROR HANDLER =====
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ===== WEBSOCKET =====
let onlineUsers = 0;

io.on('connection', (socket) => {
  onlineUsers++;
  io.emit('online-count', onlineUsers);

  socket.on('authenticate', (nim: string) => {
    socket.join(`user-${nim}`);
  });

  socket.on('disconnect', () => {
    onlineUsers--;
    io.emit('online-count', onlineUsers);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});