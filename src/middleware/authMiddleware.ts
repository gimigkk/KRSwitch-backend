import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/db';

export interface AuthUser {
  nim: string;
  name: string;
  email: string;
  role: string;
  picture?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Hapus semua kemungkinan cookie auth biar nggak ada zombie cookie yang bikin lockout
export function clearAllAuthCookies(res: Response): void {
  res.clearCookie('token');
  res.clearCookie('token', { domain: 'localhost' });
  res.clearCookie('token', { domain: '.localhost' });
  res.clearCookie('token', { domain: '127.0.0.1' });
  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
    res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
    res.clearCookie('token', { domain: '.' + process.env.COOKIE_DOMAIN });
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) {
    clearAllAuthCookies(res);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Ambil semua token dari cookie buat hindari bentrok zombie cookie
  const tokens = cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(c => c.startsWith('token='))
    .map(c => c.substring(6));

  if (tokens.length === 0) {
    clearAllAuthCookies(res);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Coba verifikasi semua token sampai ketemu yang valid dan aktif
  for (const token of tokens) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
      
      // Cek status aktif user langsung di database
      const dbUser = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { isActive: true }
      });
      
      if (dbUser && dbUser.isActive === false) {
        clearAllAuthCookies(res);
        return res.status(401).json({ error: 'Account has been disabled' });
      }

      if (!dbUser) {
        continue; // User kehapus di DB, coba token berikutnya
      }

      req.user = payload;
      return next(); // Found a valid, active token, proceed
    } catch {
      continue; // Token basi atau invalid, coba token berikutnya
    }
  }

  // Kalau semua token habis dan nggak ada yang valid, hapus semua cookie dan balikin 401
  clearAllAuthCookies(res);
  return res.status(401).json({ error: 'Session expired, please log in again' });
}

export function requireStudent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden: student only' });
  next();
}