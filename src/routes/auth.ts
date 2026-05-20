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
    path: '/',
    secure: process.env.NODE_ENV === 'production' || process.env.BACKEND_URL?.startsWith('https://'),
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
    } catch (parseErr) {
      console.error('[google/callback] Failed to parse oauth_ctx:', parseErr);
    }
  }

  const frontendUrl = oauthCtx?.frontendUrl || FRONTEND_URL;

  // Jika user sudah memiliki token sesi yang valid di cookie (terjadi pada request ganda/retried),
  // langsung bypass dan arahkan ke halaman callback sukses.
  const existingToken = req.cookies?.token;
  if (existingToken) {
    try {
      jwt.verify(existingToken, process.env.JWT_SECRET!);
      console.log('[google/callback] Existing valid session token found. Redirecting to success directly.');
      return res.redirect(`${frontendUrl}/auth/callback?success=true`);
    } catch (jwtErr) {
      console.log('[google/callback] Existing token found but invalid/expired:', jwtErr instanceof Error ? jwtErr.message : jwtErr);
    }
  }

  if (error) {
    console.error('[google/callback] Error parameter found in query:', error);
    return redirectWithError(res, 'oauth_denied', frontendUrl);
  }

  if (!rawCtx) {
    console.error('[google/callback] Validation failed: rawCtx is missing');
    return redirectWithError(res, 'oauth_failed', frontendUrl);
  }
  if (!code) {
    console.error('[google/callback] Validation failed: authorization code is missing');
    return redirectWithError(res, 'oauth_failed', frontendUrl);
  }
  if (!oauthCtx) {
    console.error('[google/callback] Validation failed: oauthCtx is missing or invalid');
    return redirectWithError(res, 'oauth_failed', frontendUrl);
  }

  res.clearCookie('oauth_ctx');
  console.log('[google/callback] Cleared oauth_ctx cookie');

  if (!returnedState || returnedState !== oauthCtx.state) {
    console.error('[google/callback] Validation failed: state mismatch');
    return redirectWithError(res, 'oauth_failed', frontendUrl);
  }

  try {
    console.log('[google/callback] Exchanging authorization code for tokens...');
    const { tokens } = await client.getToken({ code, codeVerifier: oauthCtx.codeVerifier });
    console.log('[google/callback] Tokens retrieved successfully');

    console.log('[google/callback] Verifying ID token...');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const googlePayload = ticket.getPayload();
    console.log('[google/callback] ID token payload email:', googlePayload?.email);

    if (!googlePayload?.email) {
      console.error('[google/callback] Google payload has no email');
      return redirectWithError(res, 'oauth_failed', frontendUrl);
    }

    const logId = crypto.createHash('sha256').update(googlePayload.email).digest('hex').slice(0, 8);
    console.log(`[auth] login attempt from user:${logId}`);

    console.log('[google/callback] Querying user in DB for email:', googlePayload.email);
    const user = await prisma.user.findUnique({
      where: { email: googlePayload.email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      console.error('[google/callback] User not registered in DB:', googlePayload.email);
      return redirectWithError(res, 'not_registered', frontendUrl);
    }
    if (user.isActive === false) {
      console.error('[google/callback] User account is disabled in DB:', googlePayload.email);
      return redirectWithError(res, 'account_disabled', frontendUrl);
    }

    if (googlePayload.picture) {
      console.log('[google/callback] Updating user profile picture in DB...');
      await prisma.user.update({
        where: { email: googlePayload.email },
        data: { picture: googlePayload.picture }
      });
    }

    console.log('[google/callback] User authorized successfully. Generating session JWT...');
    const jwtPayload: JwtPayload = { nim: user.nim, name: user.name, email: user.email, role: user.role, picture: googlePayload.picture };
    const sessionToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '7d' });

    clearAllAuthCookies(res); // Hapus kemungkinan zombie cookie sebelum pasang token baru yang valid
    console.log('[google/callback] Cleared all old auth cookies');

    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production' || process.env.BACKEND_URL?.startsWith('https://'),
      maxAge: 7 * 24 * 60 * 60 * 1000,
      ...(process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost' ? { domain: process.env.COOKIE_DOMAIN } : {})
    });
    console.log('[google/callback] Successfully set new session cookie');

    const redirectUrl = `${frontendUrl}/auth/callback?success=true`;
    console.log('[google/callback] Redirecting popup to success callback');
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('[auth] callback error:', err);
    redirectWithError(res, 'oauth_failed', frontendUrl);
  }
});

router.get('/dev-login', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).send('Forbidden in production');
  }
  const email = (req.query.email as string) || 'budi@apps.ipb.ac.id';
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { nim: true, name: true, email: true, role: true, isActive: true },
    });
    if (!user) {
      return res.status(404).send('Mock user not found');
    }
    const jwtPayload = { nim: user.nim, name: user.name, email: user.email, role: user.role };
    const sessionToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '7d' });
    
    clearAllAuthCookies(res);
    
    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    console.error('[dev-login] error:', err);
    res.status(500).send('Dev login failed');
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  clearAllAuthCookies(res);
  res.json({ message: 'Logged out' });
});

export default router;