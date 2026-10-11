import { Controller, Injectable, Logger, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { Db } from './db';
import { ConferenceService } from './conferences';

@Injectable()
export class LiveKitWebhookService {
  private readonly logger = new Logger(LiveKitWebhookService.name);
  constructor(private db: Db, private conferences: ConferenceService) {}

  async receive(body: string, authorization?: string) {
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!key || !secret) throw new UnauthorizedException();
    let event;
    try { event = await new WebhookReceiver(key, secret).receive(body, authorization); }
    catch { throw new UnauthorizedException('Недействительная подпись LiveKit'); }
    const conferenceId = event.room?.name;
    const participantId = event.participant?.identity;
    if (!conferenceId || !participantId) return { ok: true };
    const person = await this.db.participant.findFirst({ where: { id: participantId, conferenceId } });
    if (!person) return { ok: true };
    const conference = await this.db.conference.findUnique({ where: { id: conferenceId } });
    if (event.event === 'participant_joined') {
      if (!conference || conference.status !== 'LIVE' || person.status !== 'PRESENT') {
        await this.conferences.disconnectMedia(conferenceId, participantId);
        this.logger.warn(`Rejected media reconnect for participant ${participantId}`);
        return { ok: true };
      }
      await this.db.participant.update({ where: { id: participantId }, data: { mediaConnected: true } });
      await this.conferences.touch(conferenceId, 'participant.updated', { participantId, mediaConnected: true });
    }
    if (event.event === 'participant_left') {
      await this.db.participant.update({ where: { id: participantId }, data: { mediaConnected: false } });
      if (conference) await this.conferences.touch(conferenceId, 'participant.updated', { participantId, mediaConnected: false });
    }
    return { ok: true };
  }
}

@Controller('webhooks')
export class LiveKitWebhookController {
  constructor(private service: LiveKitWebhookService) {}
  @Post('livekit')
  async receive(@Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw new UnauthorizedException('Тело webhook отсутствует');
    return this.service.receive(req.rawBody.toString('utf8'), req.headers.authorization);
  }
}
