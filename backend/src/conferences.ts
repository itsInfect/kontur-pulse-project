import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { IsBoolean, IsDateString, IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthService, digest } from './auth';
import { Db } from './db';
import { RoomEvents } from './room-events';
import { logEvent } from './log';

class ConferenceDto {
  @ApiProperty({ example: 'Планёрка команды' })
  @IsString() @Length(1, 120) title!: string;
  @ApiPropertyOptional()
  @IsString() @IsOptional() @Length(0, 2000) description?: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString() startsAt!: string;
  @ApiProperty()
  @IsBoolean() allowGuests!: boolean;
}
class JoinDto { @ApiProperty() @IsString() @Length(1, 50) displayName!: string; }
class ModeratorDto { @ApiProperty() @IsEmail() email!: string; @ApiProperty() @IsBoolean() canEnd!: boolean; }
class ModeratorRightsDto { @ApiProperty() @IsBoolean() canEnd!: boolean; }
const guestCookie = (id: string) => `pulse_guest_${id.replaceAll('-', '')}`;
const guestCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };

@Injectable()
export class ConferenceService {
  constructor(private db: Db, private auth: AuthService, private events: RoomEvents) {}

  async find(id: string) {
    const item = await this.db.conference.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Встреча не найдена');
    return item;
  }

  async owner(id: string, req: Request) {
    const user = await this.auth.userFrom(req);
    const conference = await this.find(id);
    if (conference.ownerId !== user.id) throw new ForbiddenException();
    return { user, conference };
  }

  async viewer(id: string, req: Request) {
    const conference = await this.find(id);
    let person = null;
    if (req.headers.authorization) {
      const user = await this.auth.userFrom(req);
      person = await this.db.participant.findUnique({ where: { conferenceId_userId: { conferenceId: id, userId: user.id } } });
    } else {
      const token = req.cookies?.[guestCookie(id)] as string | undefined;
      if (token) person = await this.db.participant.findUnique({ where: { guestSessionHash: digest(token) } });
    }
    if (!person || person.conferenceId !== id) throw new UnauthorizedException('Сначала войдите во встречу');
    if (person.status === 'REMOVED') throw new ForbiddenException('Вы удалены из встречи');
    return { conference, person };
  }

  async participant(id: string, req: Request) {
    const conference = await this.find(id);
    if (conference.status !== 'LIVE') throw new ConflictException('Встреча не в эфире');
    const { person } = await this.viewer(id, req);
    if (person.status !== 'PRESENT') throw new ForbiddenException('Сначала войдите во встречу повторно');
    return { conference, person };
  }

  async moderator(id: string, req: Request) {
    const context = await this.participant(id, req);
    if (context.person.userId === context.conference.ownerId) return context;
    const assignment = context.person.userId && await this.db.conferenceModerator.findUnique({ where: { conferenceId_userId: { conferenceId: id, userId: context.person.userId } } });
    if (!assignment) throw new ForbiddenException();
    return context;
  }

  async editor(id: string, req: Request) {
    const conference = await this.find(id);
    if (conference.status === 'ENDED' || conference.status === 'CANCELLED') throw new ConflictException('Встреча завершена');
    const user = await this.auth.userFrom(req);
    if (conference.ownerId === user.id) return conference;
    if (conference.status !== 'LIVE') throw new ForbiddenException();
    await this.moderator(id, req);
    return conference;
  }

  async canEnd(id: string, req: Request) {
    const user = await this.auth.userFrom(req);
    const conference = await this.find(id);
    if (conference.ownerId === user.id) return;
    const assignment = await this.db.conferenceModerator.findUnique({ where: { conferenceId_userId: { conferenceId: id, userId: user.id } } });
    if (!assignment?.canEnd) throw new ForbiddenException();
    await this.participant(id, req);
  }

  async touch(id: string, type = 'state.updated', payload: Record<string, unknown> = {}, actorId?: string) { return this.events.publish(id, type, payload, actorId); }

  async snapshot(id: string, participantId: string) {
    return this.db.$transaction(async tx => {
      const conference = await tx.conference.findUniqueOrThrow({ where: { id } });
      const person = await tx.participant.findUniqueOrThrow({ where: { id: participantId } });
      const [participants, polls, votes, assignment] = await Promise.all([
        tx.participant.findMany({ where: { conferenceId: id }, select: { id: true, displayName: true, role: true, status: true, mediaConnected: true } }),
        tx.poll.findMany({ where: { conferenceId: id, ...(person.role === 'GUEST' ? { status: { not: 'DRAFT' as const } } : {}) }, select: { id: true, question: true, status: true, multiple: true, options: { select: { text: true, position: true }, orderBy: { position: 'asc' } } } }),
        tx.vote.findMany({ where: { conferenceId: id, ...(person.role === 'GUEST' ? { status: { not: 'DRAFT' as const } } : {}) }, select: { id: true, question: true, status: true, options: { select: { text: true, position: true }, orderBy: { position: 'asc' } }, eligible: { where: { participantId: person.id }, select: { participantId: true } }, ballots: { where: { participantId: person.id }, select: { id: true } } } }),
        person.userId ? tx.conferenceModerator.findUnique({ where: { conferenceId_userId: { conferenceId: id, userId: person.userId } }, select: { canEnd: true } }) : Promise.resolve(null),
      ]);
      return { version: conference.version, conference: { id: conference.id, status: conference.status, title: conference.title }, me: { id: person.id, role: person.role, status: person.status, canEnd: person.role === 'ORGANIZER' || !!assignment?.canEnd }, participants, polls, votes: votes.map(vote => ({ id: vote.id, question: vote.question, status: vote.status, options: vote.options, eligible: vote.eligible.length > 0, voted: vote.ballots.length > 0 })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async join(slug: string, dto: JoinDto, req: Request, res: Response) {
    const conference = await this.db.conference.findUnique({ where: { slug } });
    if (!conference) throw new NotFoundException('Встреча не найдена');
    if (conference.status !== 'LIVE') throw new ConflictException('Встреча не в эфире');
    const user = await this.auth.optionalUser(req);
    if (user) {
      const existing = await this.db.participant.findUnique({ where: { conferenceId_userId: { conferenceId: conference.id, userId: user.id } } });
      const assignment = await this.db.conferenceModerator.findUnique({ where: { conferenceId_userId: { conferenceId: conference.id, userId: user.id } } });
      if (!conference.allowGuests && user.id !== conference.ownerId && !assignment) throw new ForbiddenException();
      const role = user.id === conference.ownerId ? 'ORGANIZER' : assignment ? 'MODERATOR' : 'GUEST';
      if (existing?.status === 'REMOVED') throw new ForbiddenException('Вы удалены из встречи');
      let person;
      if (existing) {
        const changed = await this.db.participant.updateMany({ where: { id: existing.id, status: { not: 'REMOVED' } }, data: { status: 'PRESENT', leftAt: null, role, displayName: user.name } });
        if (changed.count !== 1) throw new ForbiddenException('Вы удалены из встречи');
        person = await this.db.participant.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        person = await this.db.participant.create({ data: { conferenceId: conference.id, userId: user.id, displayName: user.name, role } });
      }
      await this.touch(conference.id, 'participant.joined', { participantId: person.id, displayName: person.displayName, role: person.role }, person.id);
      return { conferenceId: conference.id, participantId: person.id, role: person.role };
    }
    if (!conference.allowGuests) throw new ForbiddenException('Вход гостей отключён');
    if (!dto.displayName.trim()) throw new BadRequestException('Укажите имя');
    const current = req.cookies?.[guestCookie(conference.id)] as string | undefined;
    let person = current ? await this.db.participant.findUnique({ where: { guestSessionHash: digest(current) } }) : null;
    if (person?.status === 'REMOVED') throw new ForbiddenException('Вы удалены из встречи');
    let token = current;
    if (!person || person.conferenceId !== conference.id) {
      token = randomBytes(32).toString('base64url');
      person = await this.db.participant.create({ data: { conferenceId: conference.id, guestSessionHash: digest(token), displayName: dto.displayName.trim(), role: 'GUEST' } });
    } else {
      const changed = await this.db.participant.updateMany({ where: { id: person.id, status: { not: 'REMOVED' } }, data: { status: 'PRESENT', leftAt: null } });
      if (changed.count !== 1) throw new ForbiddenException('Вы удалены из встречи');
      person = await this.db.participant.findUniqueOrThrow({ where: { id: person.id } });
    }
    res.cookie(guestCookie(conference.id), token, { ...guestCookieOptions, maxAge: 30 * 86400000 });
    await this.touch(conference.id, 'participant.joined', { participantId: person.id, displayName: person.displayName, role: person.role }, person.id);
    return { conferenceId: conference.id, participantId: person.id, role: person.role };
  }

  async mediaToken(id: string, req: Request) {
    const { person } = await this.participant(id, req);
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
    if (!url || !key || !secret) throw new ServiceUnavailableException('LiveKit не настроен');
    const token = new AccessToken(key, secret, { identity: person.id, name: person.displayName, ttl: '2m' });
    token.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true, canPublishData: false });
    return { url, token: await token.toJwt() };
  }

  async kick(id: string, participantId: string, req: Request) {
    const { person: actor } = await this.moderator(id, req);
    const target = await this.db.participant.findFirst({ where: { id: participantId, conferenceId: id } });
    if (!target) throw new NotFoundException();
    if (target.id === actor.id || target.role === 'ORGANIZER') throw new ForbiddenException();
    await this.db.participant.update({ where: { id: target.id }, data: { status: 'REMOVED', mediaConnected: false, leftAt: new Date() } });
    await this.touch(id, 'participant.removed', { participantId: target.id }, actor.id);
    logEvent('participant.removed', { conferenceId: id, actorId: actor.id, participantId: target.id });
    this.events.disconnectParticipant(target.id);
    await this.disconnectMedia(id, target.id);
    return { ok: true };
  }

  async disconnectMedia(id: string, participantId: string) {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
    if (!url || !key || !secret) return;
    const httpUrl = (process.env.LIVEKIT_INTERNAL_URL || url).replace(/^ws/, 'http');
    try { await new RoomServiceClient(httpUrl, key, secret).removeParticipant(id, participantId); } catch { /* Participant may already be offline. */ }
  }

  async mute(id: string, participantId: string, req: Request) {
    const { person: actor } = await this.moderator(id, req);
    const target = await this.db.participant.findFirst({ where: { id: participantId, conferenceId: id, status: 'PRESENT' } });
    if (!target || target.id === actor.id) throw new NotFoundException('Участник не найден');
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
    if (!url || !key || !secret) throw new ServiceUnavailableException('LiveKit не настроен');
    const client = new RoomServiceClient((process.env.LIVEKIT_INTERNAL_URL || url).replace(/^ws/, 'http'), key, secret);
    const live = await client.getParticipant(id, participantId);
    const mic = live.tracks.find(track => track.source === TrackSource.MICROPHONE && !track.muted);
    if (!mic) throw new ConflictException('Микрофон уже выключен');
    await client.mutePublishedTrack(id, participantId, mic.sid, true);
    await this.touch(id, 'participant.updated', { participantId, microphoneMuted: true }, actor.id);
    return { ok: true };
  }

  async closeMedia(id: string) {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
    if (!url || !key || !secret) return;
    const httpUrl = (process.env.LIVEKIT_INTERNAL_URL || url).replace(/^ws/, 'http');
    try { await new RoomServiceClient(httpUrl, key, secret).deleteRoom(id); } catch { /* Room may never have been created. */ }
  }

  disconnectSockets(id: string) { this.events.disconnectConference(id); }
  disconnectParticipantSocket(id: string) { this.events.disconnectParticipant(id); }
}

@ApiTags('Встречи и участники')
@ApiBearerAuth()
@Controller()
export class ConferenceController {
  constructor(private db: Db, private auth: AuthService, private service: ConferenceService) {}

  @Get('conferences')
  async list(@Req() req: Request, @Query('includeHidden') includeHidden?: string) { const user = await this.auth.userFrom(req); return this.db.conference.findMany({ where: { ownerId: user.id, ...(includeHidden === 'true' ? {} : { hiddenAt: null }) }, orderBy: { startsAt: 'desc' } }); }
  @Post('conferences')
  async create(@Req() req: Request, @Body() dto: ConferenceDto) {
    const user = await this.auth.userFrom(req);
    if (!dto.title.trim()) throw new BadRequestException('Укажите название');
    const conference = await this.db.conference.create({ data: { ownerId: user.id, slug: randomBytes(18).toString('base64url'), title: dto.title.trim(), description: dto.description?.trim() || '', startsAt: new Date(dto.startsAt), allowGuests: dto.allowGuests } });
    await this.service.touch(conference.id, 'conference.created', { title: conference.title });
    return conference;
  }
  @Get('conferences/:id')
  async get(@Param('id') id: string, @Req() req: Request) { return (await this.service.owner(id, req)).conference; }
  @Patch('conferences/:id')
  async update(@Param('id') id: string, @Req() req: Request, @Body() dto: ConferenceDto) {
    const { conference } = await this.service.owner(id, req);
    if (conference.status !== 'SCHEDULED') throw new ConflictException();
    if (!dto.title.trim()) throw new BadRequestException('Укажите название');
    const updated = await this.db.conference.update({ where: { id }, data: { title: dto.title.trim(), description: dto.description?.trim() || '', startsAt: new Date(dto.startsAt), allowGuests: dto.allowGuests } });
    await this.service.touch(id, 'conference.updated', { title: updated.title });
    return updated;
  }
  @Delete('conferences/:id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const { conference } = await this.service.owner(id, req);
    if (conference.status !== 'SCHEDULED') throw new ConflictException();
    const [participants, polls, votes] = await Promise.all([
      this.db.participant.count({ where: { conferenceId: id } }),
      this.db.poll.count({ where: { conferenceId: id } }),
      this.db.vote.count({ where: { conferenceId: id } }),
    ]);
    if (participants || polls || votes) throw new ConflictException('Сначала удалите черновики; встреча с участниками и результатами сохраняется для истории');
    await this.db.conference.delete({ where: { id } });
    return { ok: true };
  }
  @Post('conferences/:id/start')
  async start(@Param('id') id: string, @Req() req: Request) {
    const { user } = await this.service.owner(id, req);
    const changed = await this.db.conference.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'LIVE', startedAt: new Date() } });
    if (changed.count !== 1) throw new ConflictException();
    const person = await this.db.participant.upsert({ where: { conferenceId_userId: { conferenceId: id, userId: user.id } }, create: { conferenceId: id, userId: user.id, displayName: user.name, role: 'ORGANIZER' }, update: { status: 'PRESENT', leftAt: null } });
    await this.service.touch(id, 'conference.started', { participantId: person.id }, person.id);
    logEvent('conference.started', { conferenceId: id, ownerId: user.id });
    return { participantId: person.id, conference: await this.service.find(id) };
  }
  @Post('conferences/:id/end')
  async end(@Param('id') id: string, @Req() req: Request) {
    await this.service.canEnd(id, req);
    const changed = await this.db.conference.updateMany({ where: { id, status: 'LIVE' }, data: { status: 'ENDED', endedAt: new Date() } });
    if (changed.count !== 1) throw new ConflictException();
    await this.db.participant.updateMany({ where: { conferenceId: id, status: 'PRESENT' }, data: { status: 'LEFT', mediaConnected: false, leftAt: new Date() } });
    await this.service.touch(id, 'conference.ended');
    logEvent('conference.ended', { conferenceId: id });
    this.service.disconnectSockets(id);
    await this.service.closeMedia(id);
    return { ok: true };
  }
  @Post('conferences/:id/cancel')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    await this.service.owner(id, req);
    const changed = await this.db.conference.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    if (changed.count !== 1) throw new ConflictException();
    await this.service.touch(id, 'conference.cancelled');
    return { ok: true };
  }
  @Get('join/:slug')
  async invitation(@Param('slug') slug: string) {
    const conference = await this.db.conference.findUnique({ where: { slug }, select: { id: true, slug: true, title: true, description: true, startsAt: true, status: true, allowGuests: true } });
    if (!conference) throw new NotFoundException();
    return conference;
  }
  @Post('join/:slug') join(@Param('slug') slug: string, @Body() dto: JoinDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.service.join(slug, dto, req, res); }
  @Get('conferences/:id/participants')
  async participants(@Param('id') id: string, @Req() req: Request) {
    await this.service.participant(id, req);
    return this.db.participant.findMany({ where: { conferenceId: id }, select: { id: true, displayName: true, role: true, status: true, joinedAt: true } });
  }
  @Delete('conferences/:id/participants/:pid') kick(@Param('id') id: string, @Param('pid') pid: string, @Req() req: Request) { return this.service.kick(id, pid, req); }
  @Post('conferences/:id/participants/:pid/mute') mute(@Param('id') id: string, @Param('pid') pid: string, @Req() req: Request) { return this.service.mute(id, pid, req); }
  @Post('conferences/:id/leave')
  async leave(@Param('id') id: string, @Req() req: Request) {
    const { person } = await this.service.participant(id, req);
    await this.db.participant.update({ where: { id: person.id }, data: { status: 'LEFT', mediaConnected: false, leftAt: new Date() } });
    await this.service.touch(id, 'participant.left', { participantId: person.id }, person.id);
    this.service.disconnectParticipantSocket(person.id);
    return { ok: true };
  }
  @Post('conferences/:id/media-token') mediaToken(@Param('id') id: string, @Req() req: Request) { return this.service.mediaToken(id, req); }
  @Get('conferences/:id/state')
  async state(@Param('id') id: string, @Req() req: Request) {
    const { person } = await this.service.participant(id, req);
    return this.service.snapshot(id, person.id);
  }

  @Get('conferences/:id/moderators')
  async moderators(@Param('id') id: string, @Req() req: Request) {
    await this.service.owner(id, req);
    return this.db.conferenceModerator.findMany({ where: { conferenceId: id }, select: { userId: true, canEnd: true, user: { select: { name: true, email: true } } } });
  }

  @Post('conferences/:id/moderators')
  async addModerator(@Param('id') id: string, @Req() req: Request, @Body() dto: ModeratorDto) {
    const { conference } = await this.service.owner(id, req);
    if (conference.status === 'ENDED' || conference.status === 'CANCELLED') throw new ConflictException();
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user?.emailVerifiedAt) throw new NotFoundException('Подтверждённый пользователь не найден');
    if (user.id === conference.ownerId) throw new ConflictException('Владелец уже управляет встречей');
    const assignment = await this.db.conferenceModerator.upsert({ where: { conferenceId_userId: { conferenceId: id, userId: user.id } }, create: { conferenceId: id, userId: user.id, canEnd: dto.canEnd }, update: { canEnd: dto.canEnd } });
    await this.db.participant.updateMany({ where: { conferenceId: id, userId: user.id, status: { not: 'REMOVED' } }, data: { role: 'MODERATOR' } });
    await this.service.touch(id, 'participant.updated', { userId: user.id, role: 'MODERATOR' });
    return assignment;
  }

  @Patch('conferences/:id/moderators/:userId')
  async updateModerator(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request, @Body() dto: ModeratorRightsDto) {
    await this.service.owner(id, req);
    const changed = await this.db.conferenceModerator.updateMany({ where: { conferenceId: id, userId }, data: { canEnd: dto.canEnd } });
    if (changed.count !== 1) throw new NotFoundException();
    await this.service.touch(id, 'participant.updated', { userId, canEnd: dto.canEnd });
    return { ok: true };
  }

  @Delete('conferences/:id/moderators/:userId')
  async removeModerator(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    await this.service.owner(id, req);
    const changed = await this.db.conferenceModerator.deleteMany({ where: { conferenceId: id, userId } });
    if (changed.count !== 1) throw new NotFoundException();
    await this.db.participant.updateMany({ where: { conferenceId: id, userId }, data: { role: 'GUEST' } });
    await this.service.touch(id, 'participant.updated', { userId, role: 'GUEST' });
    return { ok: true };
  }

  @Post('conferences/:id/hide')
  async hide(@Param('id') id: string, @Req() req: Request) {
    const { conference } = await this.service.owner(id, req);
    if (conference.status === 'LIVE') throw new ConflictException('Идущую встречу скрыть нельзя');
    await this.db.conference.update({ where: { id }, data: { hiddenAt: new Date() } });
    return { ok: true };
  }

  @Get('conferences/:id/events')
  async audit(@Param('id') id: string, @Req() req: Request) {
    await this.service.owner(id, req);
    return this.db.auditEvent.findMany({ where: { conferenceId: id }, select: { version: true, type: true, actorId: true, payload: true, createdAt: true }, orderBy: { version: 'desc' }, take: 100 });
  }
}
