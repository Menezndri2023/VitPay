import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { requestContext } from './common/observability';
import { CSRF_HEADER } from './modules/identity/security.guard';

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    rawBody: true, // nécessaire à la vérification des signatures de webhooks
    logger: config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
    bodyParser: true,
  });
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(requestContext({ logRequests: config.NODE_ENV !== 'test' }));
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '20kb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], formAction: ["'self'"], frameAncestors: ["'none'"], imgSrc: ["'self'", 'data:'] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.allowedOrigins,
    credentials: true,
    allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id', CSRF_HEADER],
    exposedHeaders: ['x-request-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  app.enableShutdownHooks();
  return app;
}
