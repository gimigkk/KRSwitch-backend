import 'dotenv/config';
import { Router, Request, Response } from 'express';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma/db';
import { clearAllAuthCookies } from '../middleware/authMiddleware';

const router = Router();

// --- Constants ---------------------------------------------

const BACKEND_URL    = process.env.BACKEND_URL  ?? 'http://localhost:5000';
const FRONTEND_URL   = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const REDIRECT_URI   = `${BACKEND_URL}/auth/google/callback`;
const SCOPES         = ['openid', 'email', 'profile'];

// --- Types ---------------------------------------------

interface OAuthContext {
  codeVerifier: string;
  state: string;
  frontendUrl?: string;
}

interface JwtPayload {
  nim: string;
  name: string;
  email: string;
  role: string;
  picture?: string;
}

// --- Setup ---------------------------------------------

const client = new OAuth2Client({
  clientId:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri:  REDIRECT_URI,
});

// semua error diarahkan ke halaman callback di popup, AuthCallback.jsx yang handle
function redirectWithError(res: Response, error: string, frontendUrl?: string): void {
  clearAllAuthCookies(res);
  const target = frontendUrl || FRONTEND_URL;
  res.redirect(`${target}/auth/callback?error=${error}`);
}

// --- Routes ---------------------------------------------

router.get('/google', async (req: Request, res: Response) => {
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('hex');

  const referer = req.headers.referer;
  let frontendUrl = FRONTEND_URL;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        frontendUrl = url.origin;
      }
    } catch {}
  }

  // disimpen di httpOnly cookie, expire 2 menit, cukup buat round trip ke Google
  res.cookie('oauth_ctx', JSON.stringify({ codeVerifier, state, frontendUrl } satisfies OAuthContext), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 1000,
  });

  res.redirect(client.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    prompt: 'select_account',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  }));
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: returnedState, error } = req.query as Record<string, string>;

  const rawCtx = req.cookies?.oauth_ctx as string | undefined;
  let oauthCtx: OAuthContext | undefined;
  if (rawCtx) {
    try {
      oauthCtx = JSON.parse(rawCtx);
    } catch {}
  }

  const frontendUrl = oauthCtx?.frontendUrl || FRONTEND_URL;

  if (error) return redirectWithError(res, 'oauth_denied', frontendUrl);
  if (!rawCtx || !code || !oauthCtx) return redirectWithError(res, 'oauth_failed', frontendUrl);

  res.clearCookie('oauth_ctx');

  if (!returnedState || returnedState !== oauthCtx.state) return redirectWithError(res, 'oauth_failed', frontendUrl);

  try {
    const { tokens } = await client.getToken({ code, codeVerifier: oauthCtx.codeVerifier });

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email) return redirectWithError(res, 'oauth_failed', frontendUrl);

    const logId = crypto.createHash('sha256').update(googlePayload.email).digest('hex').slice(0, 8);
    console.log(`[auth] login attempt from user:${logId}`);

    const user = await prisma.user.findUnique({
      where: { email: googlePayload.email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) return redirectWithError(res, 'not_registered', frontendUrl);
    if (user.isActive === false) return redirectWithError(res, 'account_disabled', frontendUrl);

    const jwtPayload: JwtPayload = { nim: user.nim, name: user.name, email: user.email, role: user.role, picture: googlePayload.picture };
    const sessionToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '7d' });

    clearAllAuthCookies(res); // Hapus kemungkinan zombie cookie sebelum pasang token baru yang valid
    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      ...(process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost' ? { domain: process.env.COOKIE_DOMAIN } : {})
    });

    res.redirect(`${frontendUrl}/auth/callback?success=true`);

  } catch (err) {
    console.error('[auth] callback error:', err);
    redirectWithError(res, 'oauth_failed', frontendUrl);
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  clearAllAuthCookies(res);
  res.json({ message: 'Logged out' });
});

export default router;