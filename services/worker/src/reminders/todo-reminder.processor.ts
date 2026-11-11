import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { QUEUES, TodoReminderJob } from "@starter/queues";
import type { Job } from "bullmq";

import { WorkerConfig } from "../config.js";
import { PrismaService } from "../infrastructure.js";
import { Mailer } from "../mailer.js";

export type ReminderOutcome = "sent" | "gone" | "done" | "moved";

/**
 * Sends the reminder e-mail for one todo. The job only says which todo and
 * when; the todo is re-read here, so a reminder for a todo that was since
 * deleted, completed or moved to another time sends nothing.
 */
@Processor(QUEUES.todoReminders, { concurrency: 5 })
export class TodoReminderProcessor extends WorkerHost {
    private readonly logger = new Logger(TodoReminderProcessor.name);

    constructor (
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(Mailer) private readonly mailer: Mailer,
        @Inject(WorkerConfig) private readonly config: WorkerConfig
    ) {
        super();
    }

    async process (job: Job<unknown>): Promise<ReminderOutcome> {
        const { todoId, remindAt } = TodoReminderJob.parse(job.data);
        const todo = await this.prisma.todo.findUnique({
            where: { id: todoId },
            include: { user: { select: { email: true } } }
        });

        let outcome: ReminderOutcome = "sent";
        if (!todo) {
            outcome = "gone";
        } else if (todo.done) {
            outcome = "done";
        } else if (todo.remindAt?.toISOString() !== remindAt) {
            outcome = "moved";
        } else {
            await this.mailer.send({
                to: todo.user.email,
                subject: `Reminder: ${todo.title}`,
                text: `${todo.title}\n\n${this.config.env.APP_URL}`
            });
        }
        this.logger.log(`Reminder for todo ${todoId}: ${outcome}`);
        return outcome;
    }
}
