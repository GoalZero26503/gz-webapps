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

export function signJwt(payload: Omit<AppJwtPayload, 'iat' | 'exp'>): string {
  const secret = getConfig().jwtSecret;
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AppJwtPayload = { ...payload, iat: now, exp: now + SESSION_TTL_SECONDS };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string): AppJwtPayload {
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

  const payload: AppJwtPayload = JSON.parse(base64UrlDecode(body));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');

  return payload;
}
