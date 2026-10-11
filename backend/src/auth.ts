import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Patch, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { verify, hash } from 'argon2';
import { Db } from './db';
import { logEvent } from './log';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: process.env.AUTH_COOKIE_PATH || '/api/auth' };

class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail() email!: string;
  @ApiProperty({ example: 'Анна' })
  @IsString() @Length(1, 50) name!: string;
  @ApiProperty({ minLength: 8, example: 'Password123' })
  @IsString() @Length(8, 128) @Matches(/^(?=.*\p{L})(?=.*\d).+$/u) password!: string;
}
class EmailDto { @ApiProperty({ example: 'user@example.com' }) @IsEmail() email!: string; }
class LoginDto extends EmailDto { @ApiProperty() @IsString() password!: string; }
class TokenDto { @ApiProperty() @IsString() token!: string; }
class ResetDto extends TokenDto { @ApiProperty({ minLength: 8 }) @IsString() @Length(8, 128) @Matches(/^(?=.*\p{L})(?=.*\d).+$/u) password!: string; }
class ProfileDto { @ApiProperty({ minLength: 1, maxLength: 50 }) @IsString() @Length(1, 50) name!: string; }

@Injectable()
export class AuthService {
  constructor(private db: Db, private jwt: JwtService) {}

  async userFrom(req: Request) {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(bearer);
      const user = await this.db.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.emailVerifiedAt) throw new UnauthorizedException();
      return user;
    } catch { throw new UnauthorizedException(); }
  }

  async optionalUser(req: Request) {
    if (!req.headers.authorization) return null;
    return this.userFrom(req);
  }

  private async sendAction(email: string, kind: 'verify' | 'reset', token: string) {
    const origin = (process.env.FRONTEND_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:5173')).replace(/\/$/, '');
    const path = kind === 'verify' ? 'verify-email' : 'reset-password';
    const message = {
      from: process.env.MAIL_FROM || 'no-reply@pulse.local',
      to: email,
      subject: kind === 'verify' ? 'Подтвердите email' : 'Сброс пароля',
      text: `${origin}/${path}?token=${encodeURIComponent(token)}`,
    };
    try {
      if (process.env.RESEND_API_KEY) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        });
        if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
      } else {
        const host = process.env.SMTP_HOST;
        if (!host) throw new Error('SMTP_HOST or RESEND_API_KEY is required for email actions');
        const port = Number(process.env.SMTP_PORT || 1025);
        const transport = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: process.env.SMTP_USER && process.env.SMTP_PASSWORD
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined,
        });
        await transport.sendMail(message);
      }
    }
    catch { throw new ServiceUnavailableException('Почта временно недоступна. Повторите отправку позже.'); }
  }

  async createAction(userId: string, email: string, kind: 'verify' | 'reset') {
    const token = randomToken();
    await this.db.actionToken.create({ data: { userId, kind, tokenHash: digest(token), expiresAt: new Date(Date.now() + (kind === 'verify' ? 86400000 : 3600000)) } });
    await this.sendAction(email, kind, token);
  }

  async useAction(token: string, kind: 'verify' | 'reset', passwordHash?: string) {
    try { return await this.db.$transaction(async tx => {
      const record = await tx.actionToken.findUnique({ where: { tokenHash: digest(token) } });
      if (!record || record.kind !== kind || record.usedAt || record.expiresAt <= new Date()) throw new BadRequestException('Ссылка недействительна или истекла');
      const changed = await tx.actionToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (changed.count !== 1) throw new BadRequestException('Ссылка уже использована');
      if (kind === 'verify') await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
      else {
        if (!passwordHash) throw new BadRequestException();
        await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
        await tx.refreshSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return record.userId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new BadRequestException('Ссылка уже использована');
      throw error;
    }
  }

  async issue(userId: string, res: Response) {
    const refresh = randomToken();
    await this.db.refreshSession.create({ data: { userId, tokenHash: digest(refresh), expiresAt: new Date(Date.now() + 30 * 86400000) } });
    res.cookie('pulse_refresh', refresh, { ...cookieOptions, maxAge: 30 * 86400000 });
    const accessToken = await this.jwt.signAsync({ sub: userId });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true } });
    return { accessToken, user };
  }

  async rotate(req: Request, res: Response) {
    const token = req.cookies?.pulse_refresh as string | undefined;
    if (!token) throw new UnauthorizedException();
    const record = await this.db.refreshSession.findUnique({ where: { tokenHash: digest(token) } });
    if (!record || record.revokedAt || record.expiresAt <= new Date()) throw new UnauthorizedException();
    const refresh = randomToken();
    await this.db.$transaction(async tx => {
      const changed = await tx.refreshSession.updateMany({ where: { id: record.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      if (changed.count !== 1) throw new UnauthorizedException();
      await tx.refreshSession.create({ data: { userId: record.userId, tokenHash: digest(refresh), expiresAt: new Date(Date.now() + 30 * 86400000) } });
    });
    res.cookie('pulse_refresh', refresh, { ...cookieOptions, maxAge: 30 * 86400000 });
    const accessToken = await this.jwt.signAsync({ sub: record.userId });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: record.userId }, select: { id: true, email: true, name: true } });
    return { accessToken, user };
  }

  async logout(req: Request, res: Response) {
    const token = req.cookies?.pulse_refresh as string | undefined;
    if (token) await this.db.refreshSession.updateMany({ where: { tokenHash: digest(token), revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie('pulse_refresh', cookieOptions);
    return { ok: true };
  }
}

@ApiTags('Авторизация')
@Controller('auth')
export class AuthController {
  constructor(private db: Db, private auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.db.user.findUnique({ where: { email } })) throw new ConflictException('Email уже зарегистрирован');
    if (!dto.name.trim()) throw new BadRequestException('Укажите имя');
    let user;
    try { user = await this.db.user.create({ data: { email, name: dto.name.trim(), passwordHash: await hash(dto.password) } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email уже зарегистрирован'); throw error; }
    await this.auth.createAction(user.id, user.email, 'verify');
    return { ok: true };
  }

  @Post('verify-email')
  async verifyEmail(@Body() dto: TokenDto) {
    await this.auth.useAction(dto.token, 'verify');
    return { ok: true };
  }

  @Post('verify-email/resend')
  async resend(@Body() dto: EmailDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (user && !user.emailVerifiedAt) await this.auth.createAction(user.id, user.email, 'verify');
    return { ok: true };
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await verify(user.passwordHash, dto.password))) throw new UnauthorizedException('Неверный email или пароль');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Подтвердите email');
    logEvent('auth.login', { userId: user.id });
    return this.auth.issue(user.id, res);
  }

  @Post('refresh') refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.rotate(req, res); }
  @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res); }
  @ApiBearerAuth()
  @Get('me') async me(@Req() req: Request) { const user = await this.auth.userFrom(req); return { id: user.id, email: user.email, name: user.name }; }
  @ApiBearerAuth()
  @Patch('me') async updateMe(@Req() req: Request, @Body() dto: ProfileDto) {
    const user = await this.auth.userFrom(req);
    if (!dto.name.trim()) throw new BadRequestException('Укажите имя');
    return this.db.user.update({ where: { id: user.id }, data: { name: dto.name.trim() }, select: { id: true, email: true, name: true } });
  }

  @Post('password/forgot')
  async forgot(@Body() dto: EmailDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (user?.emailVerifiedAt) await this.auth.createAction(user.id, user.email, 'reset');
    return { ok: true };
  }

  @Post('password/reset')
  async reset(@Body() dto: ResetDto) {
    await this.auth.useAction(dto.token, 'reset', await hash(dto.password));
    return { ok: true };
  }
}
