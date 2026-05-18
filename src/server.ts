import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { prisma } from './prisma/db';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import adminApiRouter from './routes/adminRoutes';
import { createOffersRouter } from './routes/offers';
import { setupSocket } from './socket/socketHandler';
import { setActivityIo } from './utils/activity';
import { doubleCsrfProtection, trustedOriginBypass } from './middleware/csrf';

const app    = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const allowedOrigins = [CORS_ORIGIN, 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

const io = new Server(server, {
  cors: { 
    origin: corsOptions.origin as any, 
    methods: ['GET', 'POST', 'DELETE', 'PATCH'], 
    credentials: true 
  },
});

setActivityIo(io);

app.use(helmet({
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const isProd = process.env.NODE_ENV === 'production';
const apiLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: isProd ? 200  : 1000, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: isProd ? 30   : 100,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);
app.use(trustedOriginBypass);
app.use(doubleCsrfProtection);


app.use('/auth', authRouter);
app.use('/', adminRouter);
app.use('/api/admin', adminApiRouter(io));
app.use('/api/offers', createOffersRouter(io));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
});

setupSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

const gracefulShutdown = async (signal: string) => {
  console.log(`[Server] ${signal} received. Shutting down gracefully...`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));