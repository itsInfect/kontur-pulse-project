import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, AuthService } from './auth';
import { ConferenceController, ConferenceService } from './conferences';
import { InteractionController, InteractionService } from './interactions';
import { Db } from './db';
import { RoomEvents } from './room-events';
import { EventsGateway } from './events';
import { LiveKitWebhookController, LiveKitWebhookService } from './livekit-webhook';

try { process.loadEnvFile(); } catch { /* Docker and production provide environment variables directly. */ }

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '15m' } })],
  controllers: [AuthController, ConferenceController, InteractionController, LiveKitWebhookController],
  providers: [Db, RoomEvents, AuthService, ConferenceService, InteractionService, EventsGateway, LiveKitWebhookService],
})
export class AppModule {}
