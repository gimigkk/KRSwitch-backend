import { Router } from 'express';
import { Server } from 'socket.io';
import multer from 'multer';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/authMiddleware';
import { asyncHandler, validate } from '../../middleware/helpers';
import { prisma } from '../../prisma/db';
import { disconnectUserSockets } from '../../socket/socketHandler';
import { logActivity } from '../../utils/activity';
import { stripHtml, createUserSchema } from './shared';

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

  // GET /api/admin/users
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

    const formattedStudents = users.map(u => ({
      nim: u.nim,
      name: u.name,
      email: u.email,
      enrollmentCount: u.enrollments.length,
      activeBarterCount: u.offeredBarters.length
    }));

    res.json(formattedStudents);
  }));

  // GET /api/admin/users/:nim
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
    const { newNim, newName, newEmail } = req.body;

    const existing = await prisma.user.findUnique({ where: { nim: oldNim } });
    if (!existing) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });

    if (newNim && newNim.toUpperCase().trim() !== oldNim.toUpperCase().trim()) {
      const cleanNim = newNim.toUpperCase().trim();
      if (!/^M\d{10}$/.test(cleanNim)) {
        return res.status(400).json({ error: 'Format NIM harus diawali M diikuti 10 digit (contoh: M6401211064)' });
      }
      const nimExists = await prisma.user.findUnique({
        where: { nim: cleanNim }
      });
      if (nimExists) {
        return res.status(400).json({ error: 'NIM sudah terdaftar di sistem' });
      }
    }

    if (newEmail) {
      const emailStr = String(newEmail).toLowerCase().trim();
      if (!z.string().email().safeParse(emailStr).success) {
        return res.status(400).json({ error: 'Format email tidak valid' });
      }
      const emailExists = await prisma.user.findFirst({
        where: { 
          email: emailStr,
          nim: { not: oldNim }
        }
      });
      if (emailExists) {
        return res.status(400).json({ error: 'Email sudah terdaftar di sistem' });
      }
    }

    const updated = await prisma.user.update({
      where: { nim: oldNim },
      data: {
        ...(newNim ? { nim: String(newNim).toUpperCase().trim() } : {}),
        ...(newName ? { name: String(newName).trim() } : {}),
        ...(newEmail ? { email: String(newEmail).toLowerCase().trim() } : {}),
      },
    });

    await logActivity('UPDATE_STUDENT', (req as any).user.nim, `Updated student profile: ${oldNim} -> ${updated.nim} (${updated.name}).`);
    
    if (oldNim.toUpperCase().trim() !== updated.nim.toUpperCase().trim()) {
      disconnectUserSockets(io, oldNim, 'Your NIM has been updated. Please re-authenticate.');
    }

    io.emit('admin-user-updated', { oldNim, updated });
    res.json(updated);
  }));

  // DELETE /api/admin/users/:nim
  router.delete('/users/:nim', requireAuth, requireAdmin, asyncHandler(async (req: any, res: any) => {
    const existing = await prisma.user.findUnique({ where: { nim: req.params.nim } });
    if (!existing) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });

    await prisma.user.delete({ where: { nim: req.params.nim } });
    await logActivity('DELETE_STUDENT', (req as any).user.nim, `Permanently purged student ${existing.name} (${existing.nim}) from the system.`);
    disconnectUserSockets(io, req.params.nim, 'Your account has been deleted.');
    io.emit('admin-user-deleted', { nim: req.params.nim });
    res.json({ message: `Mahasiswa ${req.params.nim} berhasil dihapus dari sistem.` });
  }));

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

      const parsedStudentsData = rows.map(row => {
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

      if (parsedStudentsData.length === 0) return res.status(400).json({ error: 'No valid student data found in CSV' });

      if (req.query.validate === 'true') {
        return res.json({ 
          message: 'CSV valid dan siap di-import.', 
          count: parsedStudentsData.length,
          preview: parsedStudentsData[0]
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.user.deleteMany({ where: { role: 'student' } });
        return await tx.user.createMany({ data: parsedStudentsData, skipDuplicates: true });
      });

      const storagePath = path.join(process.cwd(), 'storage', 'master', 'master_students.csv');
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, req.file.buffer);

      io.emit('admin-user-created', { count: parsedStudentsData.length });
      io.emit('admin-master-files-updated', { type: 'students', exists: true });

      await logActivity('IMPORT_STUDENTS', (req as any).user.nim, `Imported ${parsedStudentsData.length} students from CSV.`);

      res.json({ message: `${parsedStudentsData.length} data mahasiswa berhasil di-import.`, count: parsedStudentsData.length });
    })
  );

  return router;
};
