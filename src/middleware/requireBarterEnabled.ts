import { Request, Response, NextFunction } from 'express';
import { isBarterEnabled } from '../utils/systemConfig';

export function requireBarterEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!isBarterEnabled()) {
    return res.status(403).json({
      error: 'Sistem barter sedang ditutup oleh admin. Silakan tunggu pengumuman selanjutnya.',
      barterDisabled: true,
    });
  }
  next();
}
