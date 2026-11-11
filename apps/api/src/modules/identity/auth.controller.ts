import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../../config';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService, LoginResult } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { AllowPendingMfa, Auth, ForAudience, Public } from './decorators';
import { Audience, AuthContext, clientInfo, COOKIE_NAMES, VitpayRequest } from './session';

const Register = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  fullName: z.string().trim().min(2).max(120),
  organizationName: z.string().trim().min(2).max(120),
  organizationType: z.enum(['business', 'personal']).default('business'),
  locale: z.enum(['fr', 'ar', 'en']).optional(),
});
const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
const Forgot = z.object({ email: z.string().email().max(254) });
const VerifyEmail = z.object({ token: z.string().min(20).max(100) });
const Reset = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(128) });
const Code = z.object({ code: z.string().regex(/^\d{6}$/) });
const AdminSetup = z.object({ enrollmentToken: z.string().min(16).max(64) });
const AdminEnable = Code.extend({ enrollmentToken: z.string().min(16).max(64) });

abstract class BaseAuthController {
  protected abstract readonly audience: Audience;

  constructor(
    protected readonly auth: AuthService,
    protected readonly config: AppConfig,
  ) {}

  protected setCookie(res: Response, r: LoginResult): void {
    res.cookie(COOKIE_NAMES[this.audience], r.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      expires: r.expiresAt,
    });
  }

  protected loginResponse(r: LoginResult) {
    return { mfaRequired: r.mfaRequired, mfaEnrollmentRequired: r.mfaEnrollmentRequired, expiresAt: r.expiresAt.toISOString() };
  }
}

@Controller('v1/auth')
export class AuthController extends BaseAuthController {
  protected readonly audience = 'business' as const;

  constructor(
    auth: AuthService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly resets: PasswordResetService,
    private readonly verification: EmailVerificationService,
  ) {
    super(auth, config);
  }

  /** Réponse identique que le compte existe ou non (pas d'énumération). */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('password/forgot')
  async forgot(@Body(new ZodPipe(Forgot)) body: z.infer<typeof Forgot>, @Req() req: VitpayRequest) {
    // Traitement en arrière-plan : temps de réponse identique que le compte existe ou non.
    const meta = clientInfo(req);
    setImmediate(() => void this.resets.request(body.email, meta).catch(() => undefined));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  async reset(@Body(new ZodPipe(Reset)) body: z.infer<typeof Reset>, @Req() req: VitpayRequest) {
    await this.resets.reset(body.token, body.password, clientInfo(req));
    return { ok: true };
  }

  /** Le jeton suffit (lien ouvert éventuellement sur un autre appareil que celui de l'inscription). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('email/verify')
  async verifyEmail(@Body(new ZodPipe(VerifyEmail)) body: z.infer<typeof VerifyEmail>, @Req() req: VitpayRequest) {
    await this.verification.verify(body.token, clientInfo(req));
    return { ok: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('email/resend')
  async resendVerification(@Auth() a: AuthContext, @Req() req: VitpayRequest) {
    await this.verification.resend(a, clientInfo(req));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodPipe(Register)) body: z.infer<typeof Register>, @Req() req: VitpayRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(body, clientInfo(req));
    this.setCookie(res, r);
    return { ...this.loginResponse(r), organizationId: r.orgId };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: VitpayRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body, 'business', clientInfo(req));
    this.setCookie(res, r);
    return this.loginResponse(r);
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/verify')
  async mfaVerify(@Auth() a: AuthContext, @Body(new ZodPipe(Code)) body: z.infer<typeof Code>, @Req() req: VitpayRequest) {
    await this.auth.mfaVerify(a, body.code, clientInfo(req));
    return { ok: true };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() a: AuthContext) {
    return this.auth.mfaSetup(a);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  async mfaEnable(@Auth() a: AuthContext, @Body(new ZodPipe(Code)) body: z.infer<typeof Code>, @Req() req: VitpayRequest) {
    await this.auth.mfaEnable(a, body.code, clientInfo(req));
    return { ok: true };
  }

  @AllowPendingMfa()
  @HttpCode(200)
  @Post('logout')
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.sessionId);
    res.clearCookie(COOKIE_NAMES.business, { path: '/' });
    return { ok: true };
  }

  @AllowPendingMfa()
  @Get('me')
  me(@Auth() a: AuthContext) {
    return this.auth.me(a);
  }
}

@ForAudience('admin')
@Controller('v1/admin/auth')
export class AdminAuthController extends BaseAuthController {
  protected readonly audience = 'admin' as const;

  constructor(auth: AuthService, @Inject(APP_CONFIG) config: AppConfig) {
    super(auth, config);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: VitpayRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body, 'admin', clientInfo(req));
    this.setCookie(res, r);
    return this.loginResponse(r);
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/setup')
  mfaSetup(@Auth() a: AuthContext, @Body(new ZodPipe(AdminSetup)) body: z.infer<typeof AdminSetup>) {
    return this.auth.mfaSetup(a, body.enrollmentToken);
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/enable')
  async mfaEnable(@Auth() a: AuthContext, @Body(new ZodPipe(AdminEnable)) body: z.infer<typeof AdminEnable>, @Req() req: VitpayRequest) {
    await this.auth.mfaEnable(a, body.code, clientInfo(req), body.enrollmentToken);
    return { ok: true };
  }

  @AllowPendingMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/verify')
  async mfaVerify(@Auth() a: AuthContext, @Body(new ZodPipe(Code)) body: z.infer<typeof Code>, @Req() req: VitpayRequest) {
    await this.auth.mfaVerify(a, body.code, clientInfo(req));
    return { ok: true };
  }

  @AllowPendingMfa()
  @HttpCode(200)
  @Post('logout')
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.sessionId);
    res.clearCookie(COOKIE_NAMES.admin, { path: '/' });
    return { ok: true };
  }

  @AllowPendingMfa()
  @Get('me')
  me(@Auth() a: AuthContext) {
    return this.auth.me(a);
  }
}
