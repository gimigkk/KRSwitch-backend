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
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) {
    res.clearCookie('token'); // Clear potential zombie host-only cookie
    res.clearCookie('token', { domain: 'localhost' }); // Aggressively kill the old ghost explicit-domain cookie
    if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
      res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Extract all tokens sent by the browser to bypass zombie/duplicate cookie lockouts
  const tokens = cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(c => c.startsWith('token='))
    .map(c => c.substring(6));

  if (tokens.length === 0) {
    res.clearCookie('token'); // Clear potential zombie host-only cookie
    res.clearCookie('token', { domain: 'localhost' }); // Aggressively kill the old ghost explicit-domain cookie
    if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
      res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Try verifying all provided tokens until we find a valid one
  for (const token of tokens) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
      return next(); // Found a valid token, proceed
    } catch {
      continue; // This token is invalid/expired (a zombie), try the next one
    }
  }

  // If we exhaust all tokens and none are valid, clear them and return 401
  res.clearCookie('token'); // Clear potential zombie host-only cookie
  res.clearCookie('token', { domain: 'localhost' }); // Aggressively kill the old ghost explicit-domain cookie
  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost') {
    res.clearCookie('token', { domain: process.env.COOKIE_DOMAIN });
  }
  return res.status(401).json({ error: 'Session expired, please log in again' });
}

export function requireStudent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden: student only' });
  next();
}