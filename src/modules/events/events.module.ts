import { Global, Module } from '@nestjs/common';
import { EventOutboxService } from './event.outbox';
import { EventProducer } from './event.producer';
import { OutboxRelayService } from './outbox.relay';
import { AuditWriterConsumer } from './consumers/audit-writer.consumer';
import { NotificationProjectorConsumer } from './consumers/notification-projector.consumer';
import { DashboardProjectorConsumer } from './consumers/dashboard-projector.consumer';

/**
 * Global event backbone: any service can inject EventOutboxService to record
 * events transactionally, and the relay + built-in consumers run app-wide.
 */
@Global()
@Module({
  providers: [
    EventProducer,
    EventOutboxService,
    OutboxRelayService,
    AuditWriterConsumer,
    NotificationProjectorConsumer,
    DashboardProjectorConsumer,
  ],
  exports: [EventOutboxService, EventProducer],
})
export class EventsModule {}
