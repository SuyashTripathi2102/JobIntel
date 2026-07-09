import { Queue, Worker } from 'bullmq';
import { ApiClient } from '../api-client';
import { QueueNames } from '../queues/names';
import { createRedisConnection } from '../queues/connection';

/** 8:00 AM IST morning brief + 2:00 PM CONSIDER digest — the workers only pull
 *  the trigger; the API composes and sends (it owns the DB + Telegram). The
 *  job `name` selects which: 'scheduled' = brief, 'consider-digest' = digest. */
export function startDailyBriefWorker(api: ApiClient): Worker {
  return new Worker(
    QueueNames.DAILY_BRIEF,
    async (job) => {
      if (job.name === 'consider-digest') {
        const res = await api.triggerConsiderDigest();
        console.log(`[consider-digest] sent: ${res.sent}`);
        return res;
      }
      const res = await api.triggerDailyBrief();
      console.log(`[daily-brief] sent: ${res.sent}`);
      return res;
    },
    { connection: createRedisConnection() },
  );
}

export async function ensureDailyBriefSchedule(): Promise<void> {
  const queue = new Queue(QueueNames.DAILY_BRIEF, { connection: createRedisConnection() });
  const opts = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
  await queue.upsertJobScheduler(
    'daily-brief-8am-ist',
    { pattern: '30 2 * * *' }, // 02:30 UTC = 08:00 IST
    { name: 'scheduled', opts },
  );
  await queue.upsertJobScheduler(
    'consider-digest-2pm-ist',
    { pattern: '30 8 * * *' }, // 08:30 UTC = 14:00 IST
    { name: 'consider-digest', opts },
  );
  await queue.close();
  console.log('[scheduler] daily-brief: 08:00 IST; consider-digest: 14:00 IST');
}
