console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);

import dotenv from 'dotenv';
dotenv.config();

import { Router, Request, Response } from 'express';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const router = Router();

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const REDIRECT_URI = `${BACKEND_URL}/auth/google/callback`;
const ALLOWED_DOMAIN = 'apps.ipb.ac.id';
const SCOPES = ['openid', 'email', 'profile'];

const client = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
});

interface OAuthContext {
  codeVerifier: string;
  state: string;
}

interface JwtPayload {
  nim: string;
  name: string;
  email: string;
}

function redirectWithError(res: Response, error: string): void {
  res.redirect(`${FRONTEND_URL}/login?error=${error}`);
}

// ===== GET /auth/google =====
// Kick off the OAuth flow — generate PKCE + state, store in short-lived cookie, redirect to Google
router.get('/google', async (_req: Request, res: Response) => {
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('hex');

  const oauthCtx: OAuthContext = { codeVerifier, state };

  res.cookie('oauth_ctx', JSON.stringify(oauthCtx), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 1000, // 2 minutes — just enough for the round-trip
  });

  const authUrl = client.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    hd: ALLOWED_DOMAIN,   // UI hint only, not enforced by Google
    prompt: 'select_account',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  res.redirect(authUrl);
});

// ===== GET /auth/google/callback =====
// Google redirects here — validate state, exchange code, verify token, issue session
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: returnedState, error } = req.query as Record<string, string>;

  if (error) return redirectWithError(res, 'oauth_denied');

  const rawCtx = req.cookies?.oauth_ctx as string | undefined;
  if (!rawCtx || !code) return redirectWithError(res, 'oauth_failed');

  let oauthCtx: OAuthContext;
  try {
    oauthCtx = JSON.parse(rawCtx) as OAuthContext;
  } catch {
    return redirectWithError(res, 'oauth_failed');
  }

  // Consumed — clear immediately regardless of what happens next
  res.clearCookie('oauth_ctx');

  // CSRF check
  if (!returnedState || returnedState !== oauthCtx.state) {
    return redirectWithError(res, 'oauth_failed');
  }

  try {
    const { tokens } = await client.getToken({
      code,
      codeVerifier: oauthCtx.codeVerifier,
    });

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email) return redirectWithError(res, 'oauth_failed');

    // Gate 1 — domain check (our enforcement, not Google's)
    // Personal Gmail has no 'hd' claim, other orgs will have a different one
    if (googlePayload.hd !== ALLOWED_DOMAIN) {
      return redirectWithError(res, 'wrong_domain');
    }

    // Gate 2 — must already exist in the database (platform is exclusive)
    const prisma = req.app.locals.prisma as PrismaClient;
    const user = await prisma.user.findUnique({
      where: { email: googlePayload.email },
      select: { nim: true, name: true, email: true },
    });

    if (!user) return redirectWithError(res, 'not_registered');

    // Issue session JWT
    const jwtPayload: JwtPayload = { nim: user.nim, name: user.name, email: user.email };
    const sessionToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '7d' });

    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN ?? 'localhost',
    });

    res.redirect(`${FRONTEND_URL}/`);

  } catch (err) {
    console.error('[auth] OAuth callback error:', err);
    redirectWithError(res, 'oauth_failed');
  }
});

// ===== POST /auth/logout =====
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    domain: process.env.COOKIE_DOMAIN ?? 'localhost',
  });
  res.json({ message: 'Logged out' });
});

export default router;