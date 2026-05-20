import { Router } from 'express';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/authMiddleware';
import { asyncHandler, validate } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { randomizeEnrollments } from '../../utils/seeding';
import { logActivity } from '../../utils/activity';
import { resetConfirmSchema, sanitizeCsv } from './shared';

export default (io: Server) => {
  const router = Router();

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

  // GET /api/admin/master-files
  router.get(
    '/master-files',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: any, res: any) => {
      const dir = path.join(process.cwd(), 'storage', 'master');
      const masterFilesStatus = {
        students: fs.existsSync(path.join(dir, 'master_students.csv')),
        classes: fs.existsSync(path.join(dir, 'master_classes.csv'))
      };
      res.json(masterFilesStatus);
    })
  );

  // DELETE /api/admin/master-files/:type
  router.delete(
    '/master-files/:type',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: any, res: any) => {
      const { type } = req.params;
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
