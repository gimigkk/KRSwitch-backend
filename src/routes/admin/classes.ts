import { Router } from 'express';
import { Server } from 'socket.io';
import multer from 'multer';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { logActivity } from '../../utils/activity';
import { stripHtml, mapDay } from './shared';

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

    const formattedClasses = classes.map(c => ({
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

    res.json(formattedClasses);
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

  // GET /api/admin/classes/:id/students
  router.get('/classes/:id/students', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const classId = parseInt(req.params.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { parallelClassId: classId },
      include: { user: { select: { nim: true, name: true } } }
    });
    res.json(enrollments.map(e => e.user));
  }));

  // POST /api/admin/upload-schedule / import-classes
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

      const parsedClassesData = rows.map((row) => {
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

      if (parsedClassesData.length === 0) {
        return res.status(400).json({ 
          error: 'No valid class data found in CSV', 
          details: 'Pastikan header CSV sesuai: courseCode, courseName, classCode, day, timeStart, timeEnd, room' 
        });
      }

      if (req.query.validate === 'true') {
        return res.json({ 
          message: 'CSV valid dan siap di-import.', 
          count: parsedClassesData.length,
          preview: parsedClassesData[0]
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.parallelClass.deleteMany({});
        return await tx.parallelClass.createMany({ data: parsedClassesData, skipDuplicates: true });
      });
      
      const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_classes.csv');
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, req.file.buffer);

      io.emit('admin-schedule-updated', { count: result.count });
      io.emit('admin-master-files-updated', { type: 'classes', exists: true });
      
      await logActivity('IMPORT_CLASSES', (req as any).user.nim, `Imported ${result.count} classes from CSV.`);

      res.json({ message: `Jadwal berhasil diupload. ${result.count} kelas ditambahkan.`, count: result.count });
    })
  );

  return router;
};
