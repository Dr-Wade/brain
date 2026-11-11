import { Redis } from "ioredis";
import { z } from "zod";

/**
 * The Redis key prefix of every queue and worker in this project.
 *
 * BullMQ's default is `bull`. Two projects that share a Redis and both name a
 * queue `notifications` would then take each other's jobs, and the worker that
 * finds no matching row drops the job as done. A prefix of our own keeps the
 * keys apart. Both sides must pass it: a worker without it listens under
 * `bull:` and never sees a job, with no error to say so.
 *
 * Changing it strands the jobs already waiting under the old prefix.
 */
export const QUEUE_PREFIX = "brain";

export const QUEUES = {
    todoReminders: "todo-reminders"
} as const;

/**
 * A reminder for one todo, due at `remindAt`. The worker re-reads the todo
 * when the job runs and sends nothing when it was done, deleted or moved to
 * another time since: the job is a wake-up call, the database is the truth.
 */
export const TodoReminderJob = z.object({
    todoId: z.uuid(),
    remindAt: z.iso.datetime()
});
export type TodoReminderJob = z.infer<typeof TodoReminderJob>;

/**
 * One job per todo, so moving a reminder replaces the job instead of adding one.
 * BullMQ refuses a custom id containing `:`.
 */
export const todoReminderJobId = (todoId: string) => `todo-reminder-${todoId}`;

/**
 * The Redis client BullMQ uses. BullMQ 6 loads ioredis itself only under
 * CommonJS; in an ES module it needs a client instance. BullMQ does not close a
 * client it was given, so the service that creates one closes it on shutdown.
 */
export function createRedisClient (url: string) {
    // Workers block on Redis; ioredis must not give up on their commands.
    return new Redis(url, { maxRetriesPerRequest: null });
}
