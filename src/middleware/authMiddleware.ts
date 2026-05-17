import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    res.clearCookie('token'); // Clear potential zombie host-only cookie
    res.clearCookie('token', { domain: 'localhost' }); // Aggressively kill the old ghost explicit-domain cookie
    if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
      res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    next();
  } catch {
    res.clearCookie('token'); // Clear potential zombie host-only cookie
    res.clearCookie('token', { domain: 'localhost' }); // Aggressively kill the old ghost explicit-domain cookie
    if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
      res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
    }
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export function requireStudent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden: student only' });
  next();
}