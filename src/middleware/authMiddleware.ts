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

export function clearAllAuthCookies(res: Response): void {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.BACKEND_URL?.startsWith('https://');
  const clearOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax' as const,
    path: '/'
  };

  res.clearCookie('token', clearOptions);
  res.clearCookie('token', { ...clearOptions, domain: 'localhost' });
  res.clearCookie('token', { ...clearOptions, domain: '.localhost' });
  res.clearCookie('token', { ...clearOptions, domain: '127.0.0.1' });
  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
    res.clearCookie('token', { ...clearOptions, domain: process.env.COOKIE_DOMAIN });
    res.clearCookie('token', { ...clearOptions, domain: '.' + process.env.COOKIE_DOMAIN });
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
    .map(c => {
      let val = c.substring(6);
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      return val;
    });

  if (tokens.length === 0) {
    clearAllAuthCookies(res);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Coba verifikasi semua token sampai ketemu yang valid dan aktif
  for (const token of tokens) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
      console.log('[requireAuth] JWT verified successfully for user:', payload.email);
      
      // Cek status aktif user langsung di database
      const dbUser = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { isActive: true }
      });
      
      if (dbUser && dbUser.isActive === false) {
        console.log('[requireAuth] User account has been disabled in DB:', payload.email);
        clearAllAuthCookies(res);
        return res.status(401).json({ error: 'Account has been disabled' });
      }

      if (!dbUser) {
        console.log('[requireAuth] User not found in DB:', payload.email);
        continue; // User kehapus di DB, coba token berikutnya
      }

      req.user = payload;
      return next(); // Found a valid, active token, proceed
    } catch (err) {
      console.log('[requireAuth] Token verification failed:', err instanceof Error ? err.message : err);
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