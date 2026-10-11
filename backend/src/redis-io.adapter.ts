import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private publisher?: Redis;
  private subscriber?: Redis;

  async connect(url: string) {
    this.publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.subscriber = this.publisher.duplicate();
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.publisher && this.subscriber) server.adapter(createAdapter(this.publisher, this.subscriber));
    return server;
  }
}
