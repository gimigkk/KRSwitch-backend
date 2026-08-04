import { Router } from 'express';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/authMiddleware';
import { asyncHandler, validate } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { logActivity } from '../../utils/activity';
import { isBarterEnabled, setBarterEnabled } from '../../utils/systemConfig';
import { resetConfirmSchema, sanitizeCsv } from './shared';

const COURSE_REGEX = /^(.*?)\s*\((KOM\w+)\)$/;

export default (io: Server) => {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (!file.originalname.toLowerCase().endsWith('.csv')) {
        return cb(new Error('Only CSV files are allowed'));
      }
      cb(null, true);
    },
  });

  // --- System Operations ---------------------------------------------

  // GET /api/admin/barter-status
  router.get('/barter-status', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
    res.json({ enabled: isBarterEnabled() });
  }));

  // POST /api/admin/barter-toggle
  router.post('/barter-toggle', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Parameter "enabled" (boolean) wajib diisi' });
    }

    setBarterEnabled(enabled);
    
    // Broadcast status change to all connected clients
    io.emit('barter-status-changed', { enabled });
    
    const statusText = enabled ? 'DIBUKA / DIAKTIFKAN' : 'DITUTUP / DIJEDA';
    await logActivity('SYSTEM_BARTER_TOGGLE', req.user!.nim, `Sistem barter telah ${statusText} oleh admin.`);

    res.json({ message: `Sistem barter berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`, enabled });
  }));

  // POST /api/admin/reset
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

  // POST /api/admin/seed-random
  router.post('/seed-random', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Fitur seed-random dinonaktifkan di lingkungan produksi' });
    }
    res.json({ message: 'Seed random completed' });
  }));

  // --- Imports & Phase 2 Data -----------------------------------------

  // POST /api/admin/import-phase2
  router.post(
    '/import-phase2',
    requireAuth,
    requireAdmin,
    upload.single('file'),
    asyncHandler(async (req: any, res: any) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      io.emit('admin-process-start', { message: 'Processing Phase 2 Import...' });

      const results: any[] = [];
      const headersSet = new Set<string>();

      await new Promise<void>((resolve, reject) => {
        Readable.from(req.file.buffer)
          .pipe(csvParser({
            mapHeaders: ({ header }) => header.trim().replace(/^[\uFEFF\xA0]+|[\uFEFF\xA0]+$/g, '')
          }))
          .on('headers', (headers: string[]) => {
            headers.forEach((h: string) => headersSet.add(h.trim()));
          })
          .on('data', (data: any) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });

      const txResult = await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({});
        await tx.barterOffer.deleteMany({});
        await tx.enrollment.deleteMany({});
        await tx.user.deleteMany({ where: { role: 'student' } });
  
        const courseHeaders = Array.from(headersSet).filter(h => COURSE_REGEX.test(h));
        const courseMap = new Map();
        for (const header of courseHeaders) {
          const match = header.match(COURSE_REGEX);
          if (match) {
            courseMap.set(header, { courseName: match[1].trim(), courseCode: match[2].trim().toUpperCase() });
          }
        }
  
        let usersCreated = 0;
        let enrollmentsCreated = 0;
        const processedEmails = new Set<string>();
  
        for (const row of results) {
          const nim = row['NIM']?.trim();
          const name = row['Nama Mahasiswa']?.trim();
          if (!nim || !name) continue;
  
          const emailRaw = row['Email Mahasiswa'] || row['Email'] || row['email'] || row['EMAIL'];
          const email = emailRaw?.trim();
  
          if (!email) continue;

          if (processedEmails.has(email)) continue;
          processedEmails.add(email);
  
          const paket = row['Paket']?.trim();
  
          await tx.user.upsert({
            where: { nim },
            update: { name, email, role: 'student' },
            create: { nim, name, email, role: 'student' }
          });
          usersCreated++;
  
          if (paket !== 'Belum Commit') {
            for (const header of courseHeaders) {
              const rawClassCode = row[header]?.trim();
              if (rawClassCode && rawClassCode !== '-' && rawClassCode !== '') {
                const courseInfo = courseMap.get(header);
                const classCodes = rawClassCode.split('/').map((c: string) => c.trim().toUpperCase()).filter(Boolean);
  
                for (const classCode of classCodes) {
                  let pClass = await tx.parallelClass.findFirst({
                    where: { courseCode: courseInfo.courseCode, classCode }
                  });
  
                  if (!pClass) continue;
  
                  await tx.enrollment.upsert({
                    where: { nim_parallelClassId: { nim, parallelClassId: pClass.id } },
                    update: {},
                    create: { nim, parallelClassId: pClass.id }
                  });
                  enrollmentsCreated++;
                }
              }
            }
          }
        }

        return { usersCreated, enrollmentsCreated };
      }, { timeout: 30000 });

      await logActivity('PHASE2_IMPORT', (req as any).user.nim, `Imported ${txResult.usersCreated} users and ${txResult.enrollmentsCreated} enrollments from Phase 1 data.`);
      
      io.emit('admin-enrollment-updated', { count: txResult.enrollmentsCreated });
      io.emit('admin-process-end', { message: 'Import Complete' });

      res.json({ 
        message: `Phase 2 Data Loaded! ${txResult.usersCreated} students and ${txResult.enrollmentsCreated} enrollments.`,
        usersCount: txResult.usersCreated,
        enrollmentsCount: txResult.enrollmentsCreated
      });
    })
  );

  // --- Master Files & Export -------------------------------------------

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

  // GET /api/admin/master-files
  router.get('/master-files', requireAuth, requireAdmin, asyncHandler(async (_req: any, res: any) => {
    const dir = path.join(process.cwd(), 'storage', 'master');
    const files = {
      students: fs.existsSync(path.join(dir, 'master_students.csv')),
      classes: fs.existsSync(path.join(dir, 'master_classes.csv'))
    };
    res.json(files);
  }));

  // DELETE /api/admin/master-files/:type
  router.delete('/master-files/:type', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const { type } = req.params;
    const fileName = type === 'students' ? 'master_students.csv' : 'master_classes.csv';
    const filePath = path.join(process.cwd(), 'storage', 'master', fileName);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    io.emit('admin-master-files-updated', { type, exists: false });
    res.json({ message: `Master file ${type} berhasil dihapus.` });
  }));

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

  return router;
};
