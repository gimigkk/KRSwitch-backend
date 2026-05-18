import express from 'express';
import cookieParser from 'cookie-parser';
import { mockIo } from './mocks/io';
import { doubleCsrfProtection, trustedOriginBypass } from '../middleware/csrf';

// Pakai dynamic import biar vi.mock() di test file sudah di-hoist duluan
// sebelum route module resolve prisma singleton-nya
export async function createTestApp() {
  const { default: adminRouter }  = await import('../routes/admin');
  const { default: adminApiRouter } = await import('../routes/adminRoutes');
  const { createOffersRouter }    = await import('../routes/offers');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(trustedOriginBypass);
  app.use(doubleCsrfProtection);

  app.use('/', adminRouter);
  app.use('/api/admin', adminApiRouter(mockIo as any));
  app.use('/api/offers', createOffersRouter(mockIo as any));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}