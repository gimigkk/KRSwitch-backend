import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Prisma 7 requires adapter for PostgreSQL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({
  origin: 'http://localhost:5173'
}));
app.use(express.json());

// Auth middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KRSwitch Backend Running' });
});

// ===== USER ENDPOINTS =====

// GET /api/users - Get all users
app.get('/api/users', async (req: any, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { nim: true, name: true, email: true }
    });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/me - Get current user (for testing, hardcoded)
app.get('/api/me', async (req: any, res) => {
  try {
    // Hardcoded for testing - replace with authenticate middleware later
    const user = await prisma.user.findUnique({
      where: { nim: 'M6401211002' },
      select: { nim: true, name: true, email: true }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ===== CLASS ENDPOINTS =====

// GET /api/classes - Get all parallel classes
app.get('/api/classes', async (req: any, res) => {
  try {
    const classes = await prisma.parallelClass.findMany({
      orderBy: [
        { courseCode: 'asc' },
        { classCode: 'asc' }
      ]
    });
    res.json(classes);
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// ===== ENROLLMENT ENDPOINTS =====

// GET /api/enrollments - Get all enrollments
app.get('/api/enrollments', async (req: any, res) => {
  try {
    const enrollments = await prisma.enrollment.findMany();
    res.json(enrollments);
  } catch (error) {
    console.error('Get enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// ===== BARTER ENDPOINTS =====

// GET /api/offers - Get all open offers
app.get('/api/offers', async (req: any, res) => {
  try {
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
  } catch (error) {
    console.error('Get offers error:', error);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

// POST /api/offers - Create new offer
app.post('/api/offers', async (req: any, res) => {
  const { myClassId, wantedClassId } = req.body;
  const offererNim = req.body.offererNim || 'M6401211002'; // Hardcoded for testing

  try {
    // Validate: user is enrolled in myClass
    const enrollment = await prisma.enrollment.findFirst({
      where: { nim: offererNim, parallelClassId: myClassId }
    });
    if (!enrollment) {
      return res.status(400).json({ error: 'You are not enrolled in this class' });
    }

    // Validate: same course, same type
    const myClass = await prisma.parallelClass.findUnique({ where: { id: myClassId } });
    const wantedClass = await prisma.parallelClass.findUnique({ where: { id: wantedClassId } });
    
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
      data: {
        offererNim,
        myClassId,
        wantedClassId,
        status: 'open'
      },
      include: {
        offerer: { select: { nim: true, name: true } },
        myClass: true,
        wantedClass: true
      }
    });

    // Broadcast to all clients
    io.emit('new-offer', offer);

    res.status(201).json(offer);
  } catch (error) {
    console.error('Create offer error:', error);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// POST /api/offers/:id/take - Take an offer (RACE CONDITION PROTECTED)
app.post('/api/offers/:id/take', async (req: any, res) => {
  const offerId = parseInt(req.params.id);
  const takerNim = req.body.takerNim;

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      await tx.barterOffer.update({
        where: { id: offerId },
        data: { 
          status: 'matched', 
          takerNim, 
          completedAt: new Date() 
        }
      });

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

    io.emit('offer-taken', { offerId });
    io.emit('enrollments-swapped', {
      swaps: [
        { nim: result.offererNim, oldClassId: result.myClassId, newClassId: result.wantedClassId },
        { nim: takerNim, oldClassId: result.wantedClassId, newClassId: result.myClassId }
      ]
    });
    io.to(`user-${result.offererNim}`).emit('barter-success', { offerId, takerNim });
    io.to(`user-${takerNim}`).emit('barter-success', { offerId, offererNim: result.offererNim });

    res.json({ message: 'Barter completed successfully' });
  } catch (error: any) {
    console.error('Take offer error:', error);
    
    io.to(`user-${takerNim}`).emit('barter-failed', { 
      offerId, 
      reason: error.message 
    });

    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/offers/:id - Cancel offer
app.delete('/api/offers/:id', authenticate, async (req: any, res) => {
  const offerId = parseInt(req.params.id);
  const userNim = req.user.nim;

  try {
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

    // Broadcast cancellation
    io.emit('offer-cancelled', { offerId });

    res.json({ message: 'Offer cancelled' });
  } catch (error) {
    console.error('Cancel offer error:', error);
    res.status(500).json({ error: 'Failed to cancel offer' });
  }
});

// ===== WEBSOCKET EVENTS =====

// Track online users
let onlineUsers = 0;

io.on('connection', (socket) => {
  onlineUsers++;
  console.log('User connected:', socket.id, `(${onlineUsers} online)`);
  
  // Broadcast updated online count to all clients
  io.emit('online-count', onlineUsers);

  // Join user-specific room for private messages
  socket.on('authenticate', (nim: string) => {
    socket.join(`user-${nim}`);
    console.log(`User ${nim} authenticated`);
  });

  socket.on('disconnect', () => {
    onlineUsers--;
    console.log('User disconnected:', socket.id, `(${onlineUsers} online)`);
    
    // Broadcast updated online count to all clients
    io.emit('online-count', onlineUsers);
  });
});

// Start server
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