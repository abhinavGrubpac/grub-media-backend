import { registerAs } from '@nestjs/config';

/**
 * Kafka/Redpanda connection for the event backbone. SASL is optional and
 * enables scram-sha-256 with TLS when a username is present (same contract
 * as the other GrubMedia portals).
 */
export default registerAs('kafka', () => ({
  brokers: (process.env.REDPANDA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean),
  clientId: process.env.REDPANDA_CLIENT_ID ?? 'grub-media-backend',
  saslUsername: process.env.REDPANDA_SASL_USERNAME,
  saslPassword: process.env.REDPANDA_SASL_PASSWORD,
  ssl: Boolean(process.env.REDPANDA_SASL_USERNAME),
}));
