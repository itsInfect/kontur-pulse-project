import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ConferenceService } from './conferences';
import { Db } from './db';

class InteractionDto {
  @ApiProperty({ example: 'Какой вариант выбираем?' })
  @IsString() @Length(1, 300) question!: string;
  @ApiProperty({ type: [String], minItems: 2, maxItems: 10, example: ['Да', 'Нет'] })
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @IsString({ each: true }) options!: string[];
  @ApiPropertyOptional({ description: 'Только для опросов' })
  @IsBoolean() @IsOptional() multiple?: boolean;
}
class SelectionDto { @ApiProperty({ type: [Number], example: [0] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsInt({ each: true }) @Min(0, { each: true }) @Max(9, { each: true }) selected!: number[]; }
class BallotDto { @ApiProperty({ example: 0 }) @IsInt() @Min(0) @Max(9) selected!: number; }

function clean(dto: InteractionDto) {
  const question = dto.question.trim();
  const options = dto.options.map(text => text.trim());
  if (!question || options.some(text => !text || text.length > 100)) throw new BadRequestException('Заполните вопрос и варианты до 100 символов');
  return { question, options };
}

@Injectable()
export class InteractionService {
  constructor(private db: Db, private conferences: ConferenceService) {}

  async poll(id: string) {
    const poll = await this.db.poll.findUnique({ where: { id }, include: { options: { orderBy: { position: 'asc' } } } });
    if (!poll) throw new NotFoundException('Опрос не найден');
    return poll;
  }
  async vote(id: string) {
    const vote = await this.db.vote.findUnique({ where: { id }, include: { options: { orderBy: { position: 'asc' } } } });
    if (!vote) throw new NotFoundException('Голосование не найдено');
    return vote;
  }
  async managePoll(id: string, req: Request) { const poll = await this.poll(id); await this.conferences.editor(poll.conferenceId, req); return poll; }
  async manageVote(id: string, req: Request) { const vote = await this.vote(id); await this.conferences.editor(vote.conferenceId, req); return vote; }

  async pollResults(id: string) {
    const poll = await this.poll(id);
    const rows = await this.db.pollSelection.groupBy({ by: ['optionId'], where: { response: { pollId: id } }, _count: { optionId: true } });
    const respondents = await this.db.pollResponse.count({ where: { pollId: id } });
    return { id, status: poll.status, respondents, answers: poll.options.map(option => rows.find(row => row.optionId === option.id)?._count.optionId || 0) };
  }
  async voteResults(id: string) {
    const vote = await this.vote(id);
    if (vote.status !== 'CLOSED') throw new ForbiddenException('Итоги доступны после закрытия');
    const [eligible, ballots, rows] = await Promise.all([
      this.db.voteEligible.count({ where: { voteId: id } }),
      this.db.voteBallot.count({ where: { voteId: id } }),
      this.db.voteBallot.groupBy({ by: ['optionId'], where: { voteId: id }, _count: { optionId: true } }),
    ]);
    return { id, status: vote.status, eligible, ballots, missing: eligible - ballots, answers: vote.options.map(option => rows.find(row => row.optionId === option.id)?._count.optionId || 0) };
  }
}

@ApiTags('Опросы и голосования')
@ApiBearerAuth()
@Controller()
export class InteractionController {
  constructor(private db: Db, private conferences: ConferenceService, private service: InteractionService) {}

  @Get('conferences/:id/interactions')
  async list(@Param('id') id: string, @Req() req: Request) {
    const conference = await this.conferences.find(id);
    const person = conference.status === 'SCHEDULED' ? (await this.conferences.owner(id, req), null) : (await this.conferences.viewer(id, req)).person;
    const [polls, votes] = await Promise.all([
      this.db.poll.findMany({ where: { conferenceId: id, ...(person?.role === 'GUEST' ? { status: { not: 'DRAFT' as const } } : {}) }, include: { options: { orderBy: { position: 'asc' } }, responses: { where: { participantId: person?.id || '' }, select: { selections: { select: { optionId: true } } } } } }),
      this.db.vote.findMany({ where: { conferenceId: id, ...(person?.role === 'GUEST' ? { status: { not: 'DRAFT' as const } } : {}) }, include: { options: { orderBy: { position: 'asc' } }, eligible: { where: { participantId: person?.id || '' }, select: { participantId: true } }, ballots: { where: { participantId: person?.id || '' }, select: { id: true } } } }),
    ]);
    return { polls: await Promise.all(polls.map(async poll => ({ id: poll.id, conferenceId: id, question: poll.question, kind: 'poll', status: poll.status, multiple: poll.multiple, options: poll.options.map(option => option.text), selected: poll.options.filter(option => poll.responses[0]?.selections.some(selection => selection.optionId === option.id)).map(option => option.position), ...(poll.status === 'DRAFT' ? {} : { results: await this.service.pollResults(poll.id) }) }))), votes: await Promise.all(votes.map(async vote => ({ id: vote.id, conferenceId: id, question: vote.question, kind: 'vote', status: vote.status, options: vote.options.map(option => option.text), eligible: vote.eligible.length > 0, voted: vote.ballots.length > 0, ...(vote.status === 'CLOSED' ? { results: await this.service.voteResults(vote.id) } : {}) }))) };
  }

  @Post('conferences/:id/polls')
  async createPoll(@Param('id') id: string, @Req() req: Request, @Body() dto: InteractionDto) {
    await this.conferences.editor(id, req);
    const { question, options } = clean(dto);
    const poll = await this.db.poll.create({ data: { conferenceId: id, question, multiple: !!dto.multiple, options: { create: options.map((text, position) => ({ text, position })) } }, include: { options: { orderBy: { position: 'asc' } } } });
    await this.conferences.touch(id, 'state.updated');
    return poll;
  }
  @Patch('polls/:id')
  async editPoll(@Param('id') id: string, @Req() req: Request, @Body() dto: InteractionDto) {
    const poll = await this.service.managePoll(id, req);
    if (poll.status !== 'DRAFT') throw new ConflictException();
    const { question, options } = clean(dto);
    await this.db.$transaction(async tx => {
      await tx.pollOption.deleteMany({ where: { pollId: id } });
      await tx.poll.update({ where: { id }, data: { question, multiple: !!dto.multiple, options: { create: options.map((text, position) => ({ text, position })) } } });
    });
    await this.conferences.touch(poll.conferenceId, 'state.updated');
    return this.service.poll(id);
  }
  @Delete('polls/:id')
  async deletePoll(@Param('id') id: string, @Req() req: Request) {
    const poll = await this.service.managePoll(id, req);
    if (poll.status !== 'DRAFT') throw new ConflictException();
    await this.db.$transaction([this.db.pollOption.deleteMany({ where: { pollId: id } }), this.db.poll.delete({ where: { id } })]);
    await this.conferences.touch(poll.conferenceId, 'state.updated');
    return { ok: true };
  }
  @Post('polls/:id/publish')
  async publishPoll(@Param('id') id: string, @Req() req: Request) {
    const poll = await this.service.managePoll(id, req);
    await this.conferences.moderator(poll.conferenceId, req);
    const changed = await this.db.poll.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'OPEN' } });
    if (changed.count !== 1) throw new ConflictException();
    await this.conferences.touch(poll.conferenceId, 'poll.published', { pollId: id, question: poll.question, multiple: poll.multiple, options: poll.options.map(option => option.text) });
    return { ok: true };
  }
  @Post('polls/:id/responses')
  async answerPoll(@Param('id') id: string, @Req() req: Request, @Body() dto: SelectionDto) {
    const poll = await this.service.poll(id);
    const { person } = await this.conferences.participant(poll.conferenceId, req);
    const selected = [...new Set(dto.selected)];
    if (poll.status !== 'OPEN') throw new ConflictException();
    if (selected.length !== dto.selected.length || (!poll.multiple && selected.length !== 1) || selected.some(i => i >= poll.options.length)) throw new BadRequestException('Неверный выбор');
    try {
      await this.db.$transaction(async tx => {
        const current = await tx.poll.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'OPEN') throw new ConflictException();
        const conference = await tx.conference.findUniqueOrThrow({ where: { id: poll.conferenceId } });
        const actor = await tx.participant.findUniqueOrThrow({ where: { id: person.id } });
        if (conference.status !== 'LIVE' || actor.status !== 'PRESENT') throw new ConflictException('Участник уже не находится во встрече');
        const response = await tx.pollResponse.upsert({ where: { pollId_participantId: { pollId: id, participantId: person.id } }, create: { pollId: id, participantId: person.id }, update: {} });
        await tx.pollSelection.deleteMany({ where: { responseId: response.id } });
        await tx.pollSelection.createMany({ data: selected.map(i => ({ responseId: response.id, optionId: poll.options[i].id })) });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof ConflictException) throw error; throw new ConflictException('Попробуйте отправить ответ повторно'); }
    const results = await this.service.pollResults(id);
    await this.conferences.touch(poll.conferenceId, 'poll.results.updated', { pollId: id, results });
    return results;
  }
  @Post('polls/:id/close')
  async closePoll(@Param('id') id: string, @Req() req: Request) {
    const poll = await this.service.managePoll(id, req);
    await this.conferences.moderator(poll.conferenceId, req);
    const changed = await this.db.poll.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED' } });
    if (changed.count !== 1) throw new ConflictException();
    const results = await this.service.pollResults(id);
    await this.conferences.touch(poll.conferenceId, 'poll.closed', { pollId: id, results });
    return results;
  }
  @Get('polls/:id/results')
  async pollResults(@Param('id') id: string, @Req() req: Request) { const poll = await this.service.poll(id); await this.conferences.viewer(poll.conferenceId, req); return this.service.pollResults(id); }

  @Post('conferences/:id/votes')
  async createVote(@Param('id') id: string, @Req() req: Request, @Body() dto: InteractionDto) {
    await this.conferences.editor(id, req);
    const { question, options } = clean(dto);
    const vote = await this.db.vote.create({ data: { conferenceId: id, question, options: { create: options.map((text, position) => ({ text, position })) } }, include: { options: { orderBy: { position: 'asc' } } } });
    await this.conferences.touch(id, 'state.updated');
    return vote;
  }
  @Patch('votes/:id')
  async editVote(@Param('id') id: string, @Req() req: Request, @Body() dto: InteractionDto) {
    const vote = await this.service.manageVote(id, req);
    if (vote.status !== 'DRAFT') throw new ConflictException();
    const { question, options } = clean(dto);
    await this.db.$transaction(async tx => {
      await tx.voteOption.deleteMany({ where: { voteId: id } });
      await tx.vote.update({ where: { id }, data: { question, options: { create: options.map((text, position) => ({ text, position })) } } });
    });
    await this.conferences.touch(vote.conferenceId, 'state.updated');
    return this.service.vote(id);
  }
  @Delete('votes/:id')
  async deleteVote(@Param('id') id: string, @Req() req: Request) {
    const vote = await this.service.manageVote(id, req);
    if (vote.status !== 'DRAFT') throw new ConflictException();
    await this.db.$transaction([this.db.voteOption.deleteMany({ where: { voteId: id } }), this.db.vote.delete({ where: { id } })]);
    await this.conferences.touch(vote.conferenceId, 'state.updated');
    return { ok: true };
  }
  @Post('votes/:id/open')
  async openVote(@Param('id') id: string, @Req() req: Request) {
    const vote = await this.service.manageVote(id, req);
    await this.conferences.moderator(vote.conferenceId, req);
    try {
      await this.db.$transaction(async tx => {
        const changed = await tx.vote.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'OPEN' } });
        if (changed.count !== 1) throw new ConflictException();
        const conference = await tx.conference.findUniqueOrThrow({ where: { id: vote.conferenceId } });
        if (conference.status !== 'LIVE') throw new ConflictException('Встреча не в эфире');
        const present = await tx.participant.findMany({ where: { conferenceId: vote.conferenceId, status: 'PRESENT' }, select: { id: true } });
        await tx.voteEligible.createMany({ data: present.map(person => ({ voteId: id, participantId: person.id })) });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ConflictException('Голосование уже открыто или повторите запрос');
      throw error;
    }
    await this.conferences.touch(vote.conferenceId, 'vote.opened', { voteId: id, question: vote.question, options: vote.options.map(option => option.text) });
    return { ok: true };
  }
  @Post('votes/:id/ballots')
  async ballot(@Param('id') id: string, @Req() req: Request, @Body() dto: BallotDto) {
    const vote = await this.service.vote(id);
    const { person } = await this.conferences.participant(vote.conferenceId, req);
    const option = vote.options[dto.selected];
    if (!option) throw new BadRequestException('Неверный вариант');
    try {
      await this.db.$transaction(async tx => {
        const current = await tx.vote.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'OPEN') throw new ConflictException('Голосование закрыто');
        const conference = await tx.conference.findUniqueOrThrow({ where: { id: vote.conferenceId } });
        const actor = await tx.participant.findUniqueOrThrow({ where: { id: person.id } });
        if (conference.status !== 'LIVE' || actor.status !== 'PRESENT') throw new ConflictException('Участник уже не находится во встрече');
        const eligible = await tx.voteEligible.findUnique({ where: { voteId_participantId: { voteId: id, participantId: person.id } } });
        if (!eligible) throw new ForbiddenException('Вы не допущены');
        await tx.voteBallot.create({ data: { voteId: id, participantId: person.id, optionId: option.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof ForbiddenException || error instanceof ConflictException) throw error; throw new ConflictException('Бюллетень уже подан или попробуйте повторить'); }
    return { accepted: true };
  }
  @Post('votes/:id/close')
  async closeVote(@Param('id') id: string, @Req() req: Request) {
    const vote = await this.service.manageVote(id, req);
    await this.conferences.moderator(vote.conferenceId, req);
    const changed = await this.db.vote.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED' } });
    if (changed.count !== 1) throw new ConflictException();
    const results = await this.service.voteResults(id);
    await this.conferences.touch(vote.conferenceId, 'vote.closed', { voteId: id, results });
    return results;
  }
  @Get('votes/:id/results')
  async voteResults(@Param('id') id: string, @Req() req: Request) { const vote = await this.service.vote(id); await this.conferences.viewer(vote.conferenceId, req); return this.service.voteResults(id); }
}
