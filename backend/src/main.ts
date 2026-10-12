import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  process.env.DATABASE_URL ||= process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  if (process.env.VERCEL) app.setGlobalPrefix('api');
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  if (redisUrl) {
    const adapter = new RedisIoAdapter(app);
    await adapter.connect(redisUrl);
    app.useWebSocketAdapter(adapter);
  }
  app.useBodyParser('json', { type: ['application/json', 'application/webhook+json'] });
  app.use(helmet());
  app.use(cookieParser());
  const attempts = new Map<string, { count: number; until: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const limited = req.method === 'POST' && (/^(\/api)?\/auth\/(register|login|password\/(forgot|reset)|verify-email(\/resend)?)$/.test(req.path) || /^(\/api)?\/join\/[^/]+$/.test(req.path));
    if (!limited) return next();
    const now = Date.now();
    if (attempts.size > 10000) {
      for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
      if (attempts.size > 10000) attempts.delete(attempts.keys().next().value!);
    }
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim();
    const clientIp = process.env.VERCEL && forwardedIp ? forwardedIp : req.ip;
    const key = `${clientIp}:${req.path}`;
    const entry = attempts.get(key);
    if (!entry || entry.until < now) { attempts.set(key, { count: 1, until: now + 15 * 60000 }); return next(); }
    const limit = req.path.endsWith('/login') ? 20 : req.path.endsWith('/register') ? 10 : 5;
    if (++entry.count > limit) return res.status(429).json({ statusCode: 429, message: 'Слишком много запросов. Повторите позже.' });
    return next();
  });
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: errors => new UnprocessableEntityException(errors) }));
  const config = new DocumentBuilder().setTitle('Kontur Pulse API').setVersion('0.1.0').addBearerAuth().build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
void bootstrap();
