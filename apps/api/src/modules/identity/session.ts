import type { Request } from 'express';
import { OrgRole, PlatformRole } from './permissions';

export type Audience = 'business' | 'admin';

export const COOKIE_NAMES: Record<Audience, string> = {
  business: 'vp_session',
  admin: 'vp_admin_session',
};

export const SESSION_TTL_HOURS: Record<Audience, number> = {
  business: 12,
  admin: 4,
};

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  audience: Audience;
  mfaVerified: boolean;
  mfaEnabled: boolean;
  platformRole: PlatformRole | null;
}

export interface OrgContext {
  orgId: string;
  role: OrgRole;
}

export interface VitpayRequest extends Request {
  auth?: AuthContext;
  org?: OrgContext;
}

export function clientInfo(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null };
}
