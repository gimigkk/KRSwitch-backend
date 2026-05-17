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

/**
 * Aggressively clear all possible auth cookie scopes to prevent zombie/duplicate cookie lockouts
 */
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

  // Extract all tokens sent by the browser to bypass zombie/duplicate cookie lockouts
  const tokens = cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(c => c.startsWith('token='))
    .map(c => c.substring(6));

  if (tokens.length === 0) {
    clearAllAuthCookies(res);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Try verifying all provided tokens until we find a valid and active one
  for (const token of tokens) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
      
      // Fast active session lookup inside database
      const dbUser = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { isActive: true }
      });
      
      if (dbUser && dbUser.isActive === false) {
        clearAllAuthCookies(res);
        return res.status(401).json({ error: 'Account has been disabled' });
      }

      if (!dbUser) {
        continue; // User is deleted, try the next token (if any)
      }

      req.user = payload;
      return next(); // Found a valid, active token, proceed
    } catch {
      continue; // This token is invalid/expired (a zombie), try the next one
    }
  }

  // If we exhaust all tokens and none are valid or active, clear them and return 401
  clearAllAuthCookies(res);
  return res.status(401).json({ error: 'Session expired, please log in again' });
}

export function requireStudent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden: student only' });
  next();
}