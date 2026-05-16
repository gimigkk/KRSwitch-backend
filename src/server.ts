import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { prisma } from './prisma/db';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import adminApiRouter from './routes/adminRoutes';
import { createOffersRouter } from './routes/offers';
import { setupSocket } from './socket/socketHandler';

const app    = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST', 'DELETE', 'PATCH'], credentials: true },
});

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/', adminRouter);
app.use('/api/admin', adminApiRouter(io));
app.use('/api/offers', createOffersRouter(io));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

setupSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});