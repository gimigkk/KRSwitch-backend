import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { Server } from 'socket.io';
import { requireAuth, clearAllAuthCookies } from '../middleware/authMiddleware';
import { asyncHandler, validate } from '../middleware/helpers';
import { logActivity } from '../utils/activity';
import { prisma } from '../prisma/db';
import { getOnlineCount } from '../socket/socketHandler';
import { randomizeEnrollments } from '../utils/seeding';
import { createNotification } from '../controllers/offerController';

// ─── Zod Validation Schemas ──────────────────────────────────────────────────
const createUserSchema = z.object({
  nim:   z.string().min(1).max(30),
  name:  z.string().min(1).max(100),
  email: z.string().email(),
});

const createAdminSchema = z.object({
  name:  z.string().min(1).max(100),
  email: z.string().email(),
  role:  z.enum(['operator', 'super_admin']),
});

const updateAdminSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(['operator', 'super_admin']).optional(),
  isActive: z.boolean().optional(),
});

const resetConfirmSchema = z.object({
  confirm: z.literal('RESET_ALL_DATA'),
});

// Sanitize fields that could be interpreted as spreadsheet formulas (CSV Injection)
function sanitizeCsv(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export default (io: Server) => {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: (_req: any, file: any, cb: any) => {
      if (!file.originalname.toLowerCase().endsWith('.csv')) {
        return cb(new Error('Only CSV files are allowed'));
      }
      cb(null, true);
    },
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

// CRIT-1 fix: removed ghost 'admin' role. MED-5 fix: check isActive on every protected request.
const requireAdmin = asyncHandler(async (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'super_admin' && req.user.role !== 'operator') {
    return res.status(403).json({ error: 'Forbidden: admin/operator only' });
  }
  next();
});

const requireSuperAdmin = asyncHandler(async (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: super admin only' });
  }
  next();
});

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

// ─── Logs (Real Audit Trail) ────────────────────────────────────────────────

// GET /api/admin/logs
router.get('/logs', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
  try {
    const logs = await (prisma as any).activityLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (err: any) {
    console.warn('ActivityLog table not ready or missing:', err.message);
    res.json([]); // Return empty array to prevent frontend crash
  }
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



    const stripHtml = (str: string) => str.replace(/<[^>]*>?/gm, '');

    const data = rows.map((row, idx) => {
      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const foundKey = Object.keys(row).find(k => k.replace(/^\ufeff/, '').trim().toLowerCase() === key.toLowerCase());
          if (foundKey) return row[foundKey];
        }
        return '';
      };

      const mapped = {
        courseCode: stripHtml(String(getVal(['courseCode', 'course_code', 'kode_matkul'])).trim()),
        courseName: stripHtml(String(getVal(['courseName', 'course_name', 'nama_matkul'])).trim()),
        classCode: stripHtml(String(getVal(['classCode', 'class_code', 'kelas'])).trim()),
        day: mapDay(stripHtml(String(getVal(['day', 'hari'])).trim())),
        timeStart: stripHtml(String(getVal(['timeStart', 'time_start', 'jam_mulai', 'ts'])).trim()),
        timeEnd: stripHtml(String(getVal(['timeEnd', 'time_end', 'jam_selesai', 'te'])).trim()),
        room: stripHtml(String(getVal(['room', 'ruang'])).trim()),
      };

      return mapped;
    }).filter(d => d.courseCode && d.classCode);

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

    const result = await prisma.$transaction(async (tx) => {
      await tx.parallelClass.deleteMany({});
      return await tx.parallelClass.createMany({ data, skipDuplicates: true });
    });
    
    // SAVE FILE TO DISK
    const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_classes.csv');
    fs.writeFileSync(storagePath, req.file.buffer);

    io.emit('admin-schedule-updated', { count: result.count });
    io.emit('admin-master-files-updated', { type: 'classes', exists: true });
    
    await logActivity('IMPORT_CLASSES', (req as any).user.nim, `Imported ${result.count} classes from CSV.`);

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

    const stripHtml = (str: string) => str.replace(/<[^>]*>?/gm, '');

    const data = rows.map(row => {
      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const foundKey = Object.keys(row).find(k => k.replace(/^\ufeff/, '').toLowerCase() === key.toLowerCase());
          if (foundKey) return row[foundKey];
        }
        return '';
      };

      return {
        nim: stripHtml(String(getVal(['nim', 'student_id'])).toUpperCase().trim()),
        name: stripHtml(String(getVal(['name', 'nama', 'full_name'])).trim()),
        email: stripHtml(String(getVal(['email'])).toLowerCase().trim()),
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

    // Clear old students first (Master Data Reset) inside transaction
    console.log('Cleaning old students data inside atomic transaction...');
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { role: 'student' } });
      return await tx.user.createMany({ data, skipDuplicates: true });
    });

    // SAVE FILE TO DISK
    const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_students.csv');
    fs.writeFileSync(storagePath, req.file.buffer);

    io.emit('admin-user-created', { count: data.length });
    io.emit('admin-master-files-updated', { type: 'students', exists: true });

    await logActivity('IMPORT_STUDENTS', (req as any).user.nim, `Imported ${data.length} students from CSV.`);

    res.json({ message: `${data.length} data mahasiswa berhasil di-import.`, count: data.length });
  })
);

// POST /api/admin/seed-random
router.post(
  '/seed-random',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: any, res: any) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Randomisasi dinonaktifkan di environment production.' });
    }

    io.emit('admin-process-start', { message: 'Randomizing enrollments...' });
    const result = await randomizeEnrollments();
    
    io.emit('admin-enrollment-updated', { count: result.enrollmentCount });
    io.emit('admin-process-end', { message: 'Randomization complete' });

    await logActivity('RANDOMIZE_SYSTEM', (req as any).user.nim, `Randomized ${result.enrollmentCount} enrollments for ${result.studentCount} students.`);

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

// POST /api/admin/reset  — CRIT-2: requires superAdmin + server-side confirm token
router.post(
  '/reset',
  requireAuth,
  requireSuperAdmin,
  validate(resetConfirmSchema),
  asyncHandler(async (req: any, res: any) => {
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
    io.emit('admin-master-files-updated', { type: 'all', exists: false });

    await logActivity('SYSTEM_RESET', (req as any).user.nim, 'Full system reset performed. All enrollments and master data cleared.');

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
    // HIGH-5 fix: use an explicit map — never derive filenames from user input
    const FILE_MAP: Record<string, string> = {
      students: 'master_students.csv',
      classes:  'master_classes.csv',
    };
    if (!FILE_MAP[type]) return res.status(400).json({ error: 'Invalid type' });

    const filePath = path.join(process.cwd(), 'storage', 'master', FILE_MAP[type]);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    io.emit('admin-master-files-updated', { type, exists: false });
    
    await logActivity('DELETE_MASTER', (req as any).user.nim, `Deleted master CSV file for: ${type}. Live database remains intact.`);

    res.json({ message: `Data ${type} berhasil dihapus.` });
  })
);

// ─── Class / Course Management ─────────────────────────────────────────────────

// GET /api/admin/classes
router.get('/classes', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const search = String(req.query.search ?? '').trim();

  const classes = await prisma.parallelClass.findMany({
    where: search ? {
      OR: [
        { courseCode: { contains: search, mode: 'insensitive' } },
        { courseName: { contains: search, mode: 'insensitive' } },
        { classCode: { contains: search, mode: 'insensitive' } },
      ]
    } : {},
    include: {
      _count: {
        select: { enrollments: true }
      }
    },
    orderBy: [{ courseCode: 'asc' }, { classCode: 'asc' }],
  });

  const formatted = classes.map(c => ({
    id: c.id,
    courseCode: c.courseCode,
    courseName: c.courseName,
    classCode: c.classCode,
    day: mapDay(c.day),
    timeStart: c.timeStart,
    timeEnd: c.timeEnd,
    room: c.room,
    enrollmentCount: c._count.enrollments
  }));

  res.json(formatted);
}));

// POST /api/admin/classes
router.post('/classes', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { courseCode, courseName, classCode, day, timeStart, timeEnd, room } = req.body;

  if (!courseCode || !courseName || !classCode) {
    return res.status(400).json({ error: 'courseCode, courseName, dan classCode wajib diisi' });
  }

  if (timeStart && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(timeStart)) {
    return res.status(400).json({ error: 'Format timeStart tidak valid (HH:MM)' });
  }
  if (timeEnd && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(timeEnd)) {
    return res.status(400).json({ error: 'Format timeEnd tidak valid (HH:MM)' });
  }

  const newClass = await prisma.parallelClass.create({
    data: { 
      courseCode: String(courseCode).trim().toUpperCase(), 
      courseName: String(courseName).trim(), 
      classCode: String(classCode).trim().toUpperCase(), 
      day: String(day ? mapDay(String(day)) : '').trim(), 
      timeStart: String(timeStart || '').trim(), 
      timeEnd: String(timeEnd || '').trim(), 
      room: String(room || '').trim() 
    }
  });

  await logActivity('CREATE_CLASS', (req as any).user.nim, `Manually created class: ${newClass.courseCode} - ${newClass.classCode}.`);
  io.emit('admin-schedule-updated', { count: 1 });
  res.status(201).json(newClass);
}));

// PUT /api/admin/classes/:id
router.put('/classes/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const { courseCode, courseName, classCode, day, timeStart, timeEnd, room } = req.body;

  if (timeStart && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(timeStart)) {
    return res.status(400).json({ error: 'Format timeStart tidak valid (HH:MM)' });
  }
  if (timeEnd && !/^([01]\d|2[0-3]):?([0-5]\d)$/.test(timeEnd)) {
    return res.status(400).json({ error: 'Format timeEnd tidak valid (HH:MM)' });
  }

  const existing = await prisma.parallelClass.findUnique({ where: { id: parseInt(id) } });
  if (!existing) return res.status(404).json({ error: 'Kelas tidak ditemukan' });

  const updatedClass = await prisma.parallelClass.update({
    where: { id: parseInt(id) },
    data: { 
      ...(courseCode && { courseCode: String(courseCode).trim().toUpperCase() }),
      ...(courseName && { courseName: String(courseName).trim() }),
      ...(classCode && { classCode: String(classCode).trim().toUpperCase() }),
      ...(day !== undefined && { day: String(mapDay(String(day))).trim() }),
      ...(timeStart !== undefined && { timeStart: String(timeStart).trim() }),
      ...(timeEnd !== undefined && { timeEnd: String(timeEnd).trim() }),
      ...(room !== undefined && { room: String(room).trim() })
    }
  });

  await logActivity('UPDATE_CLASS', (req as any).user.nim, `Updated class details for: ${updatedClass.courseCode} - ${updatedClass.classCode}.`);
  io.emit('admin-schedule-updated', { count: 1 });
  res.json(updatedClass);
}));

// DELETE /api/admin/classes/:id
router.delete('/classes/:id', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;

  const existing = await prisma.parallelClass.findUnique({ where: { id: parseInt(id) } });
  if (!existing) return res.status(404).json({ error: 'Kelas tidak ditemukan' });

  await prisma.parallelClass.delete({ where: { id: parseInt(id) } });

  await logActivity('DELETE_CLASS', (req as any).user.nim, `Deleted class: ${existing.courseCode} - ${existing.classCode}.`);
  io.emit('admin-schedule-updated', { count: -1 });
  res.json({ message: 'Kelas berhasil dihapus' });
}));

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
router.delete('/purge-offers', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const result = await prisma.barterOffer.deleteMany({ where: { status: 'open' } });
  io.emit('admin-offers-purged', { count: result.count });
  
  await logActivity('PURGE_OFFERS', (req as any).user.nim, `Purged ${result.count} active barter offers from the system.`);

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

  // MED-6 fix: sanitize fields to prevent CSV injection (formula chars prefixed with ')
  const header = 'NIM,Nama,Email,Kode Matkul,Nama Matkul,Kelas,Hari,Jam Mulai,Jam Selesai,Ruang\n';
  const rows = enrollments.map(e =>
    [
      sanitizeCsv(e.user.nim),
      `"${sanitizeCsv(e.user.name)}"`,
      sanitizeCsv(e.user.email),
      sanitizeCsv(e.parallelClass.courseCode),
      `"${sanitizeCsv(e.parallelClass.courseName)}"`,
      sanitizeCsv(e.parallelClass.classCode),
      sanitizeCsv(e.parallelClass.day),
      sanitizeCsv(e.parallelClass.timeStart),
      sanitizeCsv(e.parallelClass.timeEnd),
      sanitizeCsv(e.parallelClass.room),
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
    where: {
      role: 'student',
      ...(search ? {
        OR: [
          { nim: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      } : {})
    },
    include: {
      enrollments: { select: { id: true } },
      offeredBarters: { 
        where: { status: 'open' },
        select: { id: true }
      }
    },
    orderBy: { nim: 'asc' },
  });

  const formatted = users.map(u => ({
    nim: u.nim,
    name: u.name,
    email: u.email,
    enrollmentCount: u.enrollments.length,
    activeBarterCount: u.offeredBarters.length
  }));

  res.json(formatted);
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
router.post('/users', requireAuth, requireAdmin, validate(createUserSchema), asyncHandler(async (req: any, res: any) => {
  const { nim, name, email } = req.body;

  if (!nim || !name || !email) {
    return res.status(400).json({ error: 'NIM, nama, dan email wajib diisi' });
  }

  const user = await prisma.user.create({
    data: { nim: String(nim).toUpperCase().trim(), name: String(name).trim(), email: String(email).toLowerCase().trim() },
  });

  await logActivity('CREATE_STUDENT', (req as any).user.nim, `Manually created student record: ${user.name} (${user.nim}).`);
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

  await logActivity('UPDATE_STUDENT', (req as any).user.nim, `Updated student profile: ${oldNim} -> ${updated.nim} (${updated.name}).`);
  io.emit('admin-user-updated', { oldNim, updated });
  res.json(updated);
}));

// DELETE /api/admin/users/:nim
router.delete('/users/:nim', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.user.findUnique({ where: { nim: req.params.nim } });
  if (!existing) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });

  await prisma.user.delete({ where: { nim: req.params.nim } });
  await logActivity('DELETE_STUDENT', (req as any).user.nim, `Permanently purged student ${existing.name} (${existing.nim}) from the system.`);
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

  const notification = await createNotification(prisma, updated.nim, 'admin_enrollment_updated', {
    courseCode: updated.parallelClass.courseCode,
    oldClassCode: existing.parallelClass?.classCode || 'Unknown', // we didn't include parallelClass in existing, let's fix that below if needed, but wait existing doesn't include it. We should fetch it.
    newClassCode: updated.parallelClass.classCode
  });

  await logActivity('UPDATE_KRS', (req as any).user.nim, `Manual KRS move for ${updated.user.name}: assigned to class ${updated.parallelClass.classCode} (${updated.parallelClass.courseCode}).`);
  
  io.emit('admin-enrollment-updated', updated);
  // Also notify the student specifically
  io.to(`user-${updated.nim}`).emit('enrollment-updated', updated);
  io.to(`user-${updated.nim}`).emit('new-notification', notification);
  
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
  
  const notification = await createNotification(prisma, nim, 'admin_enrollment_deleted', {
    courseCode: existing.parallelClass.courseCode,
    classCode: existing.parallelClass.classCode
  });
  
  io.emit('admin-enrollment-deleted', { id: enrollmentId, nim });
  io.to(`user-${nim}`).emit('enrollment-deleted', { id: enrollmentId });
  io.to(`user-${nim}`).emit('new-notification', notification);
  
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
  }
  
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

  // log activity uses u1 and u2 which were fetched above

  await logActivity('ADMIN_OVERRIDE_SWAP', (req as any).user.nim, `FORCED SWAP: ${u1?.name} <-> ${u2?.name} for course ${courseCode}.`);

  res.json({
    message: `Override berhasil. Jadwal ${courseCode} antara ${nim1} dan ${nim2} telah ditukar.`,
    swapped: {
      nim1: { from: enroll1.parallelClass.classCode, to: enroll2.parallelClass.classCode },
      nim2: { from: enroll2.parallelClass.classCode, to: enroll1.parallelClass.classCode },
    },
  });
}));

// ─── Super Admin Routes (Admin Management) ────────────────────────────────────

router.get('/admins', requireAuth, requireSuperAdmin, asyncHandler(async (req: any, res: any) => {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['operator', 'super_admin'] } },
    select: { nim: true, name: true, email: true, role: true, isActive: true },
    orderBy: { role: 'desc' }
  });
  res.json(admins);
}));

router.post('/admins', requireAuth, requireSuperAdmin, validate(createAdminSchema), asyncHandler(async (req: any, res: any) => {
  const { name, email, role } = req.body;

  // MED-4 fix: use cryptographically random NIM (not Math.random)
  const nim = `ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: 'User with this email already exists' });
  }

  const newAdmin = await prisma.user.create({
    data: {
      nim,
      name,
      email,
      role, // operator or super_admin
      isActive: true
    }
  });

  await logActivity('ADMIN_CREATED', (req as any).user.nim, `Created ${role}: ${name} (${email})`);
  io.emit('superadmin-user-created', newAdmin);
  res.status(201).json(newAdmin);
}));

router.put('/admins/:nim', requireAuth, requireSuperAdmin, validate(updateAdminSchema), asyncHandler(async (req: any, res: any) => {
  const { nim } = req.params;
  const { name, role, isActive } = req.body;
  
  if ((req as any).user.nim === nim) {
    if (role !== undefined || isActive !== undefined) {
      return res.status(403).json({ error: 'Cannot modify your own admin account (role or status) to prevent lockout' });
    }
  }

  const updated = await prisma.user.update({
    where: { nim },
    data: {
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(isActive !== undefined && { isActive })
    }
  });

  await logActivity('ADMIN_MODIFIED', (req as any).user.nim, `Modified admin ${updated.name} (Role: ${role}, Active: ${isActive})`);
  io.emit('superadmin-user-updated', updated);
  res.json(updated);
}));

router.delete('/admins/:nim', requireAuth, requireSuperAdmin, asyncHandler(async (req: any, res: any) => {
  const { nim } = req.params;
  
  if ((req as any).user.nim === nim) {
    return res.status(403).json({ error: 'Cannot delete your own admin account' });
  }

  const admin = await prisma.user.findUnique({ where: { nim } });
  if (!admin) return res.status(404).json({ error: 'Admin not found' });

  await prisma.user.delete({ where: { nim } });

  await logActivity('ADMIN_DELETED', (req as any).user.nim, `Deleted admin ${admin.name} (${admin.email})`);
  io.emit('superadmin-user-deleted', { nim });
  res.json({ message: 'Admin deleted successfully' });
}));

  return router;
};
