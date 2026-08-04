import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/helpers';
import { prisma } from '../prisma/db';
import { isBarterEnabled } from '../utils/systemConfig';

const router = Router();

// Rate limiter langsung di router ini biar CodeQL bisa trace-nya tanpa lintas modul
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 300 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(limiter);

// --- General ---------------------------------------------


router.get('/health', (_req, res) => {
  res.json({ status: 'OK', message: 'KRSwitch Backend Running' });
});

router.get('/api/barter-status', (_req, res) => {
  res.json({ enabled: isBarterEnabled() });
});

router.get('/api/me', requireAuth, (req: any, res) => {
  res.json(req.user);
});

router.get('/api/users', requireAuth, asyncHandler(async (_req: any, res: any) => {
  const users = await prisma.user.findMany({ select: { nim: true, name: true, email: true, picture: true, role: true } });
  res.json(users);
}));

// --- Classes & Enrollments -------------------------------------------

router.get('/api/classes', requireAuth, asyncHandler(async (_req: any, res: any) => {
  const classes = await prisma.parallelClass.findMany({
    orderBy: [{ courseCode: 'asc' }, { classCode: 'asc' }],
  });
  res.json(classes);
}));

router.get('/api/enrollments', requireAuth, asyncHandler(async (_req: any, res: any) => {
  const enrollments = await prisma.enrollment.findMany();
  res.json(enrollments);
}));

// --- Socket Auth -------------------------------------------

// httpOnly cookie tidak bisa dibaca JS, jadi kita issue short-lived token khusus buat socket auth
router.get('/api/socket-token', requireAuth, (req: any, res) => {
  const token = jwt.sign(
    { 
      nim: req.user!.nim,
      name: req.user!.name,
      email: req.user!.email,
      role: req.user!.role 
    }, 
    process.env.JWT_SECRET!, 
    { expiresIn: '1m' }
  );
  res.json({ token });
});

// --- Notifications -------------------------------------------

router.get('/api/notifications', requireAuth, asyncHandler(async (req: any, res: any) => {
  const notifications = await prisma.notification.findMany({
    where: { recipientNim: req.user!.nim },
    orderBy: { createdAt: 'desc' },
  });
  res.json(notifications);
}));

router.patch('/api/notifications/read-all', requireAuth, asyncHandler(async (req: any, res: any) => {
  await prisma.notification.updateMany({
    where: { recipientNim: req.user!.nim, read: false },
    data: { read: true },
  });
  res.json({ message: 'All notifications marked as read' });
}));

export default router;