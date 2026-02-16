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

// Prisma setup
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE']
  }
});

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// ===== VALIDATION SCHEMAS =====
const createOfferSchema = z.object({
  myClassId: z.number().int().positive(),
  wantedClassId: z.number().int().positive(),
}).refine(data => data.myClassId !== data.wantedClassId, {
  message: 'Cannot swap same class'
});

const takeOfferSchema = z.object({
  takerNim: z.string().regex(/^M\d{10}$/),
});

// ===== MIDDLEWARE =====
// Validation middleware
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

// Async error handler wrapper
const asyncHandler = (fn: Function) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ===== ROUTES =====

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KRSwitch Backend Running' });
});

// GET /api/users
app.get('/api/users', asyncHandler(async (req: express.Request, res: express.Response) => {
  const users = await prisma.user.findMany({
    select: { nim: true, name: true, email: true }
  });
  res.json(users);
}));

// GET /api/me - Hardcoded for testing
app.get('/api/me', asyncHandler(async (req: express.Request, res: express.Response) => {
  const user = await prisma.user.findUnique({
    where: { nim: 'M6401211001' },
    select: { nim: true, name: true, email: true }
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
}));

// GET /api/classes
app.get('/api/classes', asyncHandler(async (req: express.Request, res: express.Response) => {
  const classes = await prisma.parallelClass.findMany({
    orderBy: [{ courseCode: 'asc' }, { classCode: 'asc' }]
  });
  res.json(classes);
}));

// GET /api/enrollments
app.get('/api/enrollments', asyncHandler(async (req: express.Request, res: express.Response) => {
  const enrollments = await prisma.enrollment.findMany();
  res.json(enrollments);
}));

// GET /api/offers
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

// POST /api/offers
app.post('/api/offers', validate(createOfferSchema), asyncHandler(async (req: express.Request, res: express.Response) => {
  const { myClassId, wantedClassId } = req.body;
  const offererNim = req.body.offererNim || 'M6401211001'; // Hardcoded for testing

  // Validate: user is enrolled in myClass
  const enrollment = await prisma.enrollment.findFirst({
    where: { nim: offererNim, parallelClassId: myClassId }
  });
  
  if (!enrollment) {
    return res.status(400).json({ error: 'You are not enrolled in this class' });
  }

  // Validate: same course, same type
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

  // Create offer
  const offer = await prisma.barterOffer.create({
    data: { offererNim, myClassId, wantedClassId, status: 'open' },
    include: {
      offerer: { select: { nim: true, name: true } },
      myClass: true,
      wantedClass: true
    }
  });

  // Broadcast to all clients
  io.emit('new-offer', offer);

  res.status(201).json(offer);
}));

// POST /api/offers/:id/take
app.post('/api/offers/:id/take', validate(takeOfferSchema), asyncHandler(async (req: express.Request, res: express.Response) => {
  const offerId = parseInt(req.params.id as string);
  const { takerNim } = req.body;

  const offer = await prisma.$transaction(async (tx) => {
    const offer = await tx.barterOffer.findUnique({
      where: { id: offerId },
      include: { myClass: true, wantedClass: true }
    });

    if (!offer) throw new Error('Offer not found');
    if (offer.status !== 'open') throw new Error('Offer already taken');
    if (offer.offererNim === takerNim) throw new Error('Cannot take your own offer');

    const takerEnrollment = await tx.enrollment.findFirst({
      where: { nim: takerNim, parallelClassId: offer.wantedClassId }
    });
    
    if (!takerEnrollment) throw new Error('You are not enrolled in the wanted class');

    // Update offer
    await tx.barterOffer.update({
      where: { id: offerId },
      data: { status: 'matched', takerNim, completedAt: new Date() }
    });

    // Swap enrollments
    await tx.enrollment.updateMany({
      where: { nim: offer.offererNim, parallelClassId: offer.myClassId },
      data: { parallelClassId: offer.wantedClassId }
    });

    await tx.enrollment.updateMany({
      where: { nim: takerNim, parallelClassId: offer.wantedClassId },
      data: { parallelClassId: offer.myClassId }
    });

    return offer;
  });

  // Emit socket events
  io.emit('offer-taken', { offerId });
  io.emit('enrollments-swapped', {
    swaps: [
      { nim: offer.offererNim, oldClassId: offer.myClassId, newClassId: offer.wantedClassId },
      { nim: takerNim, oldClassId: offer.wantedClassId, newClassId: offer.myClassId }
    ]
  });
  io.to(`user-${offer.offererNim}`).emit('barter-success', { offerId, takerNim });
  io.to(`user-${takerNim}`).emit('barter-success', { offerId, offererNim: offer.offererNim });

  res.json({ message: 'Barter completed successfully' });
}));

// DELETE /api/offers/:id
app.delete('/api/offers/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const offerId = parseInt(req.params.id as string);
  const userNim = 'M6401211001'; // Hardcoded for testing - your friend will add real auth later

  const offer = await prisma.barterOffer.findUnique({ where: { id: offerId } });
  
  if (!offer) {
    return res.status(404).json({ error: 'Offer not found' });
  }

  if (offer.offererNim !== userNim) {
    return res.status(403).json({ error: 'Not your offer' });
  }

  if (offer.status !== 'open') {
    return res.status(400).json({ error: 'Cannot cancel matched offer' });
  }

  await prisma.barterOffer.update({
    where: { id: offerId },
    data: { status: 'cancelled' }
  });

  // Reuse 'offer-taken' event for consistency with frontend
  io.emit('offer-taken', { offerId });

  res.json({ message: 'Offer cancelled' });
}));

// ===== ERROR HANDLER =====
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  
  res.status(500).json({ 
    error: err.message || 'Internal server error'
  });
});

// ===== WEBSOCKET =====
let onlineUsers = 0;

io.on('connection', (socket) => {
  onlineUsers++;
  console.log('User connected:', socket.id, `(${onlineUsers} online)`);
  io.emit('online-count', onlineUsers);

  socket.on('authenticate', (nim: string) => {
    socket.join(`user-${nim}`);
    console.log(`User ${nim} authenticated`);
  });

  socket.on('disconnect', () => {
    onlineUsers--;
    console.log('User disconnected:', socket.id, `(${onlineUsers} online)`);
    io.emit('online-count', onlineUsers);
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📡 WebSocket ready`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});