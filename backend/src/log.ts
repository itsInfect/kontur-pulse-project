import { Logger } from '@nestjs/common';

const logger = new Logger('Audit');
export function logEvent(type: string, fields: Record<string, string | number | boolean> = {}) {
  logger.log(JSON.stringify({ time: new Date().toISOString(), type, ...fields }));
}
