import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { AppError } from './errors';
import { redactPath } from './observability';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    let status = 500;
    let code = 'internal_error';
    let title = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      title = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'too_many_requests';
      title = 'Too many requests';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? 'not_found' : 'http_error';
      title = exception.message;
    } else {
      // Ne jamais exposer la stack ou le message interne au client.
      this.logger.error({ msg: 'Unhandled error', requestId: req.requestId, path: redactPath(req.url), err: (exception as Error)?.stack ?? String(exception) });
    }

    res
      .status(status)
      .type('application/problem+json')
      // requestId : à communiquer au support pour retrouver la requête dans les journaux.
      .json({ type: `https://docs.vitpay.ma/errors/${code}`, title, status, code, requestId: req.requestId, ...(details ? { details } : {}) });
  }
}
