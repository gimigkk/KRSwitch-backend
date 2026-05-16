import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { Server } from 'socket.io';
import { requireAuth } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/helpers';
import { prisma } from '../prisma/db';
import { getOnlineCount } from '../socket/socketHandler';
import { randomizeEnrollments } from '../utils/seeding';

export default (io: Server) => {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage() });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireAdmin(req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden: admin only' });
  next();
}

const DAY_MAP: Record<string, string> = {
  '1': 'Senin',
  '2': 'Selasa',
  '3': 'Rabu',
  '4': 'Kamis',
  '5': 'Jumat',
  '6': 'Sabtu',
  '7': 'Minggu'
};

function mapDay(day: string): string {
  const d = day.trim();
  return DAY_MAP[d] || d; // Fallback ke string aslinya jika bukan angka 1-7
}

// ─── Stats ───────────────────────────────────────────────────────────────────

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

// ─── Logs (pseudo-log from barter history) ───────────────────────────────────

// GET /api/admin/logs
router.get('/logs', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
  const offers = await prisma.barterOffer.findMany({
    where: { status: { not: 'open' } },
    orderBy: { completedAt: 'desc' },
    take: 100,
    include: {
      offerer: { select: { nim: true, name: true } },
      myClass: { select: { courseCode: true, classCode: true } },
      wantedClass: { select: { courseCode: true, classCode: true } },
    },
  });

  const logs = offers.map(o => ({
    id: o.id,
    timestamp: o.completedAt ?? o.createdAt,
    action_type: o.status === 'matched' ? 'BARTER_MATCHED' : 'BARTER_CANCELLED',
    user_nim: o.offererNim,
    details: `${o.myClass.courseCode} (${o.myClass.classCode} → ${o.wantedClass.classCode})${o.takerNim ? ` | Taker: ${o.takerNim}` : ''}`,
  }));

  res.json(logs);
}));

// ─── Schedule Upload ─────────────────────────────────────────────────────────

// POST /api/admin/upload-schedule  (Legacy alias)
// POST /api/admin/import-classes
router.post(
  ['/upload-schedule', '/import-classes'],
  requireAuth,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rows: any[] = [];
    await new Promise<void>((resolve, reject) => {
      Readable.from(req.file.buffer)
        .pipe(csvParser())
        .on('data', (row: any) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    if (rows.length === 0) return res.status(400).json({ error: 'CSV file is empty or invalid' });

    console.log('Importing classes, rows found:', rows.length);
    if (rows.length > 0) {
      console.log('DEBUG RAW ROW 0:', JSON.stringify(rows[0]));
      console.log('DEBUG KEYS:', Object.keys(rows[0]));
    }

    const data = rows.map((row, idx) => {
      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const foundKey = Object.keys(row).find(k => k.replace(/^\ufeff/, '').trim().toLowerCase() === key.toLowerCase());
          if (foundKey) return row[foundKey];
        }
        return '';
      };

      const mapped = {
        courseCode: String(getVal(['courseCode', 'course_code', 'kode_matkul'])).trim(),
        courseName: String(getVal(['courseName', 'course_name', 'nama_matkul'])).trim(),
        classCode: String(getVal(['classCode', 'class_code', 'kelas'])).trim(),
        day: mapDay(String(getVal(['day', 'hari'])).trim()),
        timeStart: String(getVal(['timeStart', 'time_start', 'jam_mulai', 'ts'])).trim(),
        timeEnd: String(getVal(['timeEnd', 'time_end', 'jam_selesai', 'te'])).trim(),
        room: String(getVal(['room', 'ruang'])).trim(),
      };

      if (idx === 0) console.log('DEBUG MAPPED ROW 0:', JSON.stringify(mapped));
      return mapped;
    }).filter(d => d.courseCode && d.classCode);

    console.log('Valid classes to insert:', data.length);

    if (data.length === 0) {
      return res.status(400).json({ 
        error: 'No valid class data found in CSV', 
        details: 'Pastikan header CSV sesuai: courseCode, courseName, classCode, day, timeStart, timeEnd, room' 
      });
    }

    // NEW: Validation Mode Check
    if (req.query.validate === 'true') {
      return res.json({ 
        message: 'CSV valid dan siap di-import.', 
        count: data.length,
        preview: data[0]
      });
    }

    await prisma.parallelClass.deleteMany({}); // Only delete if we have new data to replace it
    const result = await prisma.parallelClass.createMany({ data });
    
    // SAVE FILE TO DISK
    const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_classes.csv');
    fs.writeFileSync(storagePath, req.file.buffer);

    io.emit('admin-schedule-updated', { count: result.count });
    res.json({ message: `Jadwal berhasil diupload. ${result.count} kelas ditambahkan.`, count: result.count });
  })
);

// POST /api/admin/import-students
router.post(
  '/import-students',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rows: any[] = [];
    await new Promise<void>((resolve, reject) => {
      Readable.from(req.file.buffer)
        .pipe(csvParser())
        .on('data', (row: any) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log('Importing students, rows found:', rows.length);
    if (rows.length > 0) console.log('First row keys:', Object.keys(rows[0]));

    const data = rows.map(row => {
      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const foundKey = Object.keys(row).find(k => k.replace(/^\ufeff/, '').toLowerCase() === key.toLowerCase());
          if (foundKey) return row[foundKey];
        }
        return '';
      };

      return {
        nim: String(getVal(['nim', 'student_id'])).toUpperCase().trim(),
        name: String(getVal(['name', 'nama', 'full_name'])).trim(),
        email: String(getVal(['email'])).toLowerCase().trim(),
        role: 'student'
      };
    }).filter(d => d.nim && d.name);

    console.log('Valid students to insert:', data.length);

    if (data.length === 0) return res.status(400).json({ error: 'No valid student data found in CSV' });

    // NEW: Validation Mode Check
    if (req.query.validate === 'true') {
      return res.json({ 
        message: 'CSV valid dan siap di-import.', 
        count: data.length,
        preview: data[0]
      });
    }

    // Clear old students first (Master Data Reset)
    console.log('Cleaning old students data...');
    await prisma.user.deleteMany({ where: { role: 'student' } });

    // Insert students
    // Insert students
    const result = await prisma.user.createMany({ data });

    // SAVE FILE TO DISK
    const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_students.csv');
    fs.writeFileSync(storagePath, req.file.buffer);

    io.emit('admin-user-created', { count: data.length });
    res.json({ message: `${data.length} data mahasiswa berhasil di-import.`, count: data.length });
  })
);

// POST /api/admin/seed-random
router.post(
  '/seed-random',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: any, res: any) => {
    const result = await randomizeEnrollments();
    
    io.emit('admin-enrollment-updated', { count: result.enrollmentCount });
    res.json({ 
      message: `Randomisasi selesai. ${result.studentCount} mahasiswa didaftarkan ke ${result.enrollmentCount} kelas.`,
      ...result 
    });
  })
);

// GET /api/admin/template/:type
router.get('/template/:type', requireAuth, requireAdmin, (req: any, res: any) => {
  const { type } = req.params;
  let csv = '';
  let filename = '';

  if (type === 'students') {
    csv = 'nim,name,email\nM0403241075,Muh Arifaushan,muh@apps.ipb.ac.id\nM0403241117,Gilang Muhamad Widiagung,gnaligilang@apps.ipb.ac.id';
    filename = 'template_mahasiswa.csv';
  } else if (type === 'classes') {
    csv = 'courseCode,courseName,classCode,day,timeStart,timeEnd,room\nKOM1221,Metode Kuantitatif,K1,1,08:00,09:40,Ruang 101\nKOM1221,Metode Kuantitatif,P1,1,13:00,15:00,Lab 1';
    filename = 'template_jadwal.csv';
  } else {
    return res.status(400).json({ error: 'Invalid template type' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// POST /api/admin/reset
router.post(
  '/reset',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: any, res: any) => {
    await prisma.$transaction([
      prisma.notification.deleteMany({}),
      prisma.barterOffer.deleteMany({}),
      prisma.enrollment.deleteMany({}),
      prisma.user.deleteMany({ where: { role: 'student' } }),
      prisma.parallelClass.deleteMany({}),
    ]);
    
    // Clear master files
    const dir = path.join(process.cwd(), 'storage', 'master');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
    }

    io.emit('admin-system-reset', { message: 'System has been reset to zero' });
    res.json({ message: 'Seluruh data berhasil dihapus. Sistem kembali ke nol.' });
  })
);

// GET /api/admin/master-files
router.get(
  '/master-files',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: any, res: any) => {
    const dir = path.join(process.cwd(), 'storage', 'master');
    const files = {
      students: fs.existsSync(path.join(dir, 'master_students.csv')),
      classes: fs.existsSync(path.join(dir, 'master_classes.csv'))
    };
    res.json(files);
  })
);

// DELETE /api/admin/master-files/:type
router.delete(
  '/master-files/:type',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: any, res: any) => {
    const { type } = req.params;
    const fileName = type === 'students' ? 'master_students.csv' : 'master_classes.csv';
    const filePath = path.join(process.cwd(), 'storage', 'master', fileName);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    if (type === 'students') {
      await prisma.$transaction([
        prisma.notification.deleteMany({}),
        prisma.barterOffer.deleteMany({}),
        prisma.enrollment.deleteMany({}),
        prisma.user.deleteMany({ where: { role: 'student' } })
      ]);
    } else {
      await prisma.$transaction([
        prisma.notification.deleteMany({}),
        prisma.barterOffer.deleteMany({}),
        prisma.enrollment.deleteMany({}),
        prisma.parallelClass.deleteMany({})
      ]);
    }

    res.json({ message: `Data ${type} berhasil dihapus.` });
  })
);

// ─── Class Student List ──────────────────────────────────────────────────────

// GET /api/admin/classes/:id/students
router.get('/classes/:id/students', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const classId = parseInt(req.params.id);
  const enrollments = await prisma.enrollment.findMany({
    where: { parallelClassId: classId },
    include: { user: { select: { nim: true, name: true } } }
  });
  res.json(enrollments.map(e => e.user));
}));

// ─── Purge Offers ────────────────────────────────────────────────────────────

// DELETE /api/admin/purge-offers
router.delete('/purge-offers', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
  const result = await prisma.barterOffer.deleteMany({ where: { status: 'open' } });
  io.emit('admin-offers-purged', { count: result.count });
  res.json({ message: `${result.count} penawaran barter aktif berhasil dihapus.`, count: result.count });
}));

// ─── Export Recap ─────────────────────────────────────────────────────────────

// GET /api/admin/export-recap
router.get('/export-recap', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
  const enrollments = await prisma.enrollment.findMany({
    include: {
      user: { select: { nim: true, name: true, email: true } },
      parallelClass: true,
    },
    orderBy: [{ user: { nim: 'asc' } }, { parallelClass: { courseCode: 'asc' } }],
  });

  const header = 'NIM,Nama,Email,Kode Matkul,Nama Matkul,Kelas,Hari,Jam Mulai,Jam Selesai,Ruang\n';
  const rows = enrollments.map(e =>
    [
      e.user.nim,
      `"${e.user.name}"`,
      e.user.email,
      e.parallelClass.courseCode,
      `"${e.parallelClass.courseName}"`,
      e.parallelClass.classCode,
      e.parallelClass.day,
      e.parallelClass.timeStart,
      e.parallelClass.timeEnd,
      e.parallelClass.room,
    ].join(',')
  );

  const csv = header + rows.join('\n');
  const filename = `Rekap_Jadwal_KRSwitch_${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

// ─── User / Mahasiswa Management ─────────────────────────────────────────────

// GET /api/admin/users?search=
router.get('/users', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const search = String(req.query.search ?? '').trim();

  const users = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { nim: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: { nim: true, name: true, email: true, role: true },
    orderBy: { nim: 'asc' },
  });

  res.json(users);
}));

// GET /api/admin/users/:nim  (full detail with enrollments + active barter offers)
router.get('/users/:nim', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const user = await prisma.user.findUnique({
    where: { nim: req.params.nim },
    include: {
      enrollments: {
        include: { parallelClass: true },
      },
      offeredBarters: {
        where: { status: 'open' },
        include: {
          myClass: true,
          wantedClass: true,
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  res.json(user);
}));

// POST /api/admin/users
router.post('/users', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { nim, name, email } = req.body;

  if (!nim || !name || !email) {
    return res.status(400).json({ error: 'NIM, nama, dan email wajib diisi' });
  }

  const user = await prisma.user.create({
    data: { nim: String(nim).toUpperCase().trim(), name: String(name).trim(), email: String(email).toLowerCase().trim() },
  });

  io.emit('admin-user-created', user);
  res.status(201).json(user);
}));

// PUT /api/admin/users/:oldNim
router.put('/users/:oldNim', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { oldNim } = req.params;
  const { newNim, newName } = req.body;

  const existing = await prisma.user.findUnique({ where: { nim: oldNim } });
  if (!existing) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });

  const updated = await prisma.user.update({
    where: { nim: oldNim },
    data: {
      ...(newNim ? { nim: String(newNim).toUpperCase().trim() } : {}),
      ...(newName ? { name: String(newName).trim() } : {}),
    },
  });

  io.emit('admin-user-updated', { oldNim, updated });
  res.json(updated);
}));

// DELETE /api/admin/users/:nim
router.delete('/users/:nim', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.user.findUnique({ where: { nim: req.params.nim } });
  if (!existing) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });

  await prisma.user.delete({ where: { nim: req.params.nim } });
  io.emit('admin-user-deleted', { nim: req.params.nim });
  res.json({ message: `Mahasiswa ${req.params.nim} berhasil dihapus dari sistem.` });
}));

// ─── Enrollment / KRS Management ─────────────────────────────────────────────

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

// PUT /api/admin/enrollments/:id  —  pindah ke kelas lain (newParallelClassId)
router.put('/enrollments/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const enrollmentId = parseInt(req.params.id);
  const { newParallelClassId } = req.body;

  if (!newParallelClassId) {
    return res.status(400).json({ error: 'newParallelClassId wajib diisi' });
  }

  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) return res.status(404).json({ error: 'Enrollment tidak ditemukan' });

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { parallelClassId: Number(newParallelClassId) },
    include: { parallelClass: true },
  });

  io.emit('admin-enrollment-updated', updated);
  // Also notify the student specifically
  io.to(`user-${updated.nim}`).emit('enrollment-updated', updated);
  
  res.json(updated);
}));

// DELETE /api/admin/enrollments/:id
router.delete('/enrollments/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const enrollmentId = parseInt(req.params.id);

  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) return res.status(404).json({ error: 'Enrollment tidak ditemukan' });

  const nim = existing.nim;
  await prisma.enrollment.delete({ where: { id: enrollmentId } });
  
  io.emit('admin-enrollment-deleted', { id: enrollmentId, nim });
  io.to(`user-${nim}`).emit('enrollment-deleted', { id: enrollmentId });
  
  res.json({ message: 'Mata kuliah berhasil di-drop dari KRS.' });
}));

// ─── Barter Management ───────────────────────────────────────────────────────

// DELETE /api/admin/offers/:id  —  force-cancel any open barter offer
router.delete('/offers/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const offerId = parseInt(req.params.id);

  const offer = await prisma.barterOffer.findUnique({ where: { id: offerId } });
  if (!offer) return res.status(404).json({ error: 'Penawaran barter tidak ditemukan' });
  if (offer.status !== 'open') return res.status(400).json({ error: 'Hanya penawaran berstatus open yang bisa dibatalkan' });

  await prisma.barterOffer.update({ where: { id: offerId }, data: { status: 'cancelled' } });
  
  io.emit('offer-taken', { offerId });
  io.to(`user-${offer.offererNim}`).emit('offer-auto-cancelled', { 
    offerId, 
    reason: 'admin_cancelled' 
  });

  res.json({ message: `Penawaran barter #${offerId} berhasil dibatalkan secara paksa.` });
}));

// ─── Override Swap ────────────────────────────────────────────────────────────

// POST /api/admin/override-swap
// Body: { nim1, nim2, courseCode }
// Swaps the parallelClass between nim1 and nim2 for the given courseCode
router.post('/override-swap', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { nim1, nim2, courseCode } = req.body;

  if (!nim1 || !nim2 || !courseCode) {
    return res.status(400).json({ error: 'nim1, nim2, dan courseCode wajib diisi' });
  }

  if (nim1 === nim2) {
    return res.status(400).json({ error: 'NIM mahasiswa tidak boleh sama' });
  }

  // Find enrollments for both students in the given courseCode
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

  // Swap in a transaction
  await prisma.$transaction([
    prisma.enrollment.update({
      where: { id: enroll1.id },
      data: { parallelClassId: enroll2.parallelClassId },
    }),
    prisma.enrollment.update({
      where: { id: enroll2.id },
      data: { parallelClassId: enroll1.parallelClassId },
    }),
  ]);

  // Cancel any open barter offers for these students on this course (now stale)
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

  // Emit events
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
