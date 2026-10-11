import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { Db } from './db';

const room = (id: string) => `conference:${id}`;
const personRoom = (id: string) => `participant:${id}`;

@Injectable()
export class RoomEvents {
  private server?: Server;
  constructor(private db: Db) {}
  attach(server: Server) { this.server = server; }

  async publish(conferenceId: string, type: string, payload: Record<string, unknown> = {}, actorId?: string) {
    const event = await this.db.$transaction(async tx => {
      const conference = await tx.conference.update({ where: { id: conferenceId }, data: { version: { increment: 1 } }, select: { version: true } });
      return tx.auditEvent.create({ data: { id: randomUUID(), conferenceId, version: conference.version, type, actorId, payload: payload as Prisma.InputJsonValue } });
    });
    const message = { conferenceId, version: event.version, type, data: payload, at: event.createdAt.toISOString() };
    this.server?.to(room(conferenceId)).emit(type, message);
    return message;
  }

  disconnectParticipant(participantId: string) { this.server?.in(personRoom(participantId)).disconnectSockets(true); }
  disconnectConference(conferenceId: string) { this.server?.in(room(conferenceId)).disconnectSockets(true); }
}
