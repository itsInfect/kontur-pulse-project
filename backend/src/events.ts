import { Logger } from '@nestjs/common';
import { ConnectedSocket, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { parse as parseCookie } from 'cookie';
import type { Request } from 'express';
import { Server, Socket } from 'socket.io';
import { ConferenceService } from './conferences';
import { RoomEvents } from './room-events';

const room = (id: string) => `conference:${id}`;
const personRoom = (id: string) => `participant:${id}`;

@WebSocketGateway({ namespace: 'events', transports: ['websocket'], cors: { origin: process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173', credentials: true } })
export class EventsGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EventsGateway.name);
  constructor(private conferences: ConferenceService, private events: RoomEvents) {}

  afterInit(server: Server) { this.events.attach(server); }

  private request(client: Socket): Request {
    const token = client.handshake.auth?.accessToken;
    const cookies = parseCookie(client.handshake.headers.cookie || '');
    return { headers: { authorization: typeof token === 'string' ? `Bearer ${token}` : undefined }, cookies } as Request;
  }

  async handleConnection(client: Socket) {
    const conferenceId = client.handshake.auth?.conferenceId;
    if (typeof conferenceId !== 'string') { client.disconnect(true); return; }
    try {
      const { person } = await this.conferences.participant(conferenceId, this.request(client));
      client.data.conferenceId = conferenceId;
      client.data.participantId = person.id;
      await client.join(room(conferenceId));
      await client.join(personRoom(person.id));
      client.emit('state.snapshot', await this.conferences.snapshot(conferenceId, person.id));
    } catch {
      this.logger.warn('Rejected unauthorized realtime connection');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('state.snapshot')
  async snapshot(@ConnectedSocket() client: Socket) {
    const conferenceId = client.data.conferenceId as string | undefined;
    if (!conferenceId) { client.disconnect(true); return; }
    try {
      const { person } = await this.conferences.participant(conferenceId, this.request(client));
      client.emit('state.snapshot', await this.conferences.snapshot(conferenceId, person.id));
    } catch { client.disconnect(true); }
  }
}
