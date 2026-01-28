// server.ts
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
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
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

// ===== BARTER ENDPOINTS =====

// GET /api/offers - Get all open offers
app.get('/api/offers', authenticate, async (req: any, res) => {
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
app.post('/api/offers', authenticate, async (req: any, res) => {
  const { myClassId, wantedClassId } = req.body;
  const offererNim = req.user.nim;

  try {
    // Validate: user is enrolled in myClass
    const enrollment = await prisma.enrollment.findFirst({
      where: { nim: offererNim, classSectionId: myClassId }
    });
    if (!enrollment) {
      return res.status(400).json({ error: 'You are not enrolled in this class' });
    }

    // Validate: same course, same type
    const myClass = await prisma.classSection.findUnique({ where: { id: myClassId } });
    const wantedClass = await prisma.classSection.findUnique({ where: { id: wantedClassId } });
    
    if (!myClass || !wantedClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (myClass.courseCode !== wantedClass.courseCode) {
      return res.status(400).json({ error: 'Must be same course' });
    }

    if (myClass.classCode[0] !== wantedClass.classCode[0]) {
      return res.status(400).json({ error: 'Must be same type (K↔K, P↔P, R↔R)' });
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
app.post('/api/offers/:id/take', authenticate, async (req: any, res) => {
  const offerId = parseInt(req.params.id);
  const takerNim = req.user.nim;

  try {
    // Use transaction with row locking
    const result = await prisma.$transaction(async (tx) => {
      // Lock and fetch offer
      const offer = await tx.barterOffer.findUnique({
        where: { id: offerId },
        include: { myClass: true, wantedClass: true }
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'open') throw new Error('Offer already taken');
      if (offer.offererNim === takerNim) throw new Error('Cannot take your own offer');

      // Validate taker is enrolled in wanted class
      const takerEnrollment = await tx.enrollment.findFirst({
        where: { nim: takerNim, classSectionId: offer.wantedClassId }
      });
      if (!takerEnrollment) throw new Error('You are not enrolled in the wanted class');

      // Update offer
      await tx.barterOffer.update({
        where: { id: offerId },
        data: { 
          status: 'matched', 
          takerNim, 
          completedAt: new Date() 
        }
      });

      // Swap enrollments
      await tx.enrollment.updateMany({
        where: { nim: offer.offererNim, classSectionId: offer.myClassId },
        data: { classSectionId: offer.wantedClassId }
      });

      await tx.enrollment.updateMany({
        where: { nim: takerNim, classSectionId: offer.wantedClassId },
        data: { classSectionId: offer.myClassId }
      });

      return offer;
    });

    // Broadcast success
    io.emit('offer-taken', { offerId });
    io.to(`user-${result.offererNim}`).emit('barter-success', { offerId, takerNim });
    io.to(`user-${takerNim}`).emit('barter-success', { offerId, offererNim: result.offererNim });

    res.json({ message: 'Barter completed successfully' });
  } catch (error: any) {
    console.error('Take offer error:', error);
    
    // Send failure to client
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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join user-specific room for private messages
  socket.on('authenticate', (nim: string) => {
    socket.join(`user-${nim}`);
    console.log(`User ${nim} authenticated`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
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