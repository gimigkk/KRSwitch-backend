import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  nim: string;
  name: string;
  email: string;
}

// Extend Express Request so req.user is typed throughout the app
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
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    req.user = payload;
    next();
  } catch {
    // Token expired or tampered — clear the bad cookie
    res.clearCookie('token');
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}