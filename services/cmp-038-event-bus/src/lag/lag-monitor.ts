import { committedOffset, consumerLag } from '@serviceform/outbox';
import type { EventTransport } from '@serviceform/outbox';
import type pg from 'pg';

export async function recordLag(
  pool: pg.Pool,
  transport: EventTransport,
  topic: string,
  group: string,
): Promise<void> {
  const end = await transport.logEndOffsets(topic);
  const committed = await transport.committedOffsets(group, topic);
  const client = await pool.connect();
  try {
    for (const [partition, logEnd] of end) {
      const c = committed.get(partition) ?? 0n;
      const lag = logEnd > c ? logEnd - c : 0n;
      await client.query(
        `INSERT INTO sf_event_bus.consumer_checkpoint
           (consumer_group, topic_name, partition, committed_offset, log_end_offset, lag, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (consumer_group, topic_name, partition) DO UPDATE SET
           committed_offset = EXCLUDED.committed_offset,
           log_end_offset = EXCLUDED.log_end_offset,
           lag = EXCLUDED.lag,
           observed_at = now()`,
        [group, topic, partition, c.toString(), logEnd.toString(), lag.toString()],
      );
      consumerLag.record(Number(lag), {
        'sf.eventbus.topic': topic,
        'sf.eventbus.consumer_group': group,
        'sf.eventbus.partition': String(partition),
      });
      committedOffset.record(Number(c), {
        'sf.eventbus.topic': topic,
        'sf.eventbus.consumer_group': group,
        'sf.eventbus.partition': String(partition),
      });
    }
  } finally {
    client.release();
  }
}
