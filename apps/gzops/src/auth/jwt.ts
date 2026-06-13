import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config.js';
import type { AppJwtPayload } from './types.js';

const SESSION_TTL_SECONDS = 604800; // 7 days

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

interface Timestamped {
  iat: number;
  exp: number;
}

/** Generic HS256 token signer — `payload` is stamped with iat/exp. */
export function signToken<T extends object>(payload: T, ttlSeconds: number): string {
  const secret = getConfig().jwtSecret;
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSeconds };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(full));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken<T extends Timestamped>(token: string): T {
  const secret = getConfig().jwtSecret;
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, signature] = parts;
  const expectedSig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }

  const payload = JSON.parse(base64UrlDecode(body)) as T;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

export function signJwt(payload: Omit<AppJwtPayload, 'iat' | 'exp'>): string {
  return signToken(payload, SESSION_TTL_SECONDS);
}

export function verifyJwt(token: string): AppJwtPayload {
  return verifyToken<AppJwtPayload>(token);
}
