import dotenv from 'dotenv';
dotenv.config();

import { Router, Request, Response } from 'express';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const router = Router();

const BACKEND_URL    = process.env.BACKEND_URL  ?? 'http://localhost:5000';
const FRONTEND_URL   = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const REDIRECT_URI   = `${BACKEND_URL}/auth/google/callback`;
const ALLOWED_DOMAIN = 'apps.ipb.ac.id';
const SCOPES = ['openid', 'email', 'profile'];

const client = new OAuth2Client({
  clientId:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri:  REDIRECT_URI,
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

// semua error diarahin ke halaman callback di popup, bukan /login
// ntar AuthCallback.jsx yang handle — dia postMessage ke parent window terus nutup diri
function redirectWithError(res: Response, error: string): void {
  res.redirect(`${FRONTEND_URL}/auth/callback?error=${error}`);
}


// ===== GET /auth/google =====
router.get('/google', async (_req: Request, res: Response) => {
  // bikin PKCE pair — codeVerifier disimpen di cookie, codeChallenge dikirim ke Google
  // ini buat mastiin yang nuker code di callback beneran dari kita, bukan orang lain yang nyegat
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  // state random buat anti-CSRF, divalidasi pas callback
  const state = crypto.randomBytes(32).toString('hex');

  const oauthCtx: OAuthContext = { codeVerifier, state };

  // simpen di httpOnly cookie, expire 2 menit — cukup buat round trip ke Google
  res.cookie('oauth_ctx', JSON.stringify(oauthCtx), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 1000,
  });

  const authUrl = client.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    hd: ALLOWED_DOMAIN,   // ini cuma hint buat Google biar filter akun IPB di UI-nya, bukan enforcement
    prompt: 'select_account',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  res.redirect(authUrl);
});


// ===== GET /auth/google/callback =====
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: returnedState, error } = req.query as Record<string, string>;

  // user cancel di halaman Google
  if (error) return redirectWithError(res, 'oauth_denied');

  const rawCtx = req.cookies?.oauth_ctx as string | undefined;
  if (!rawCtx || !code) return redirectWithError(res, 'oauth_failed');

  let oauthCtx: OAuthContext;
  try {
    oauthCtx = JSON.parse(rawCtx) as OAuthContext;
  } catch {
    return redirectWithError(res, 'oauth_failed');
  }

  // langsung hapus cookie-nya, udah ga perlu lagi
  res.clearCookie('oauth_ctx');

  // cek state cocok ga — kalau beda berarti request ini bukan dari flow yang kita mulai
  if (!returnedState || returnedState !== oauthCtx.state) {
    return redirectWithError(res, 'oauth_failed');
  }

  try {
    // tuker authorization code sama token, sambil kirim codeVerifier buat PKCE
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

    // cek domain — akun Gmail biasa ga punya field 'hd', org lain punya nilai beda
    // ini enforcement kita sendiri, bukan dari Google
    if (googlePayload.hd !== ALLOWED_DOMAIN) {
      return redirectWithError(res, 'wrong_domain');
    }

    // cek apakah emailnya udah ada di database — platform ini eksklusif, ga ada registrasi mandiri
    const prisma = req.app.locals.prisma as PrismaClient;
    const user = await prisma.user.findUnique({
      where: { email: googlePayload.email },
      select: { nim: true, name: true, email: true },
    });

    if (!user) return redirectWithError(res, 'not_registered');

    // semua oke, bikin session JWT
    const jwtPayload: JwtPayload = { nim: user.nim, name: user.name, email: user.email };
    const sessionToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '7d' });

    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN ?? 'localhost',
    });

    // arahin ke callback page di popup — AuthCallback.jsx yang handle sisanya
    res.redirect(`${FRONTEND_URL}/auth/callback?success=true`);

  } catch (err) {
    console.error('[auth] callback error:', err);
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