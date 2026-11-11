import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { QUEUES, todoReminderJobId, type TodoReminderJob } from "@brain/queues";
import type { Queue } from "bullmq";

interface Reminder {
    id: string
    done: boolean
    remindAt: Date | null
}

/**
 * Keeps one delayed job per todo in step with its reminder. The API only
 * enqueues; the worker sends the e-mail (services/worker).
 */
@Injectable()
export class TodoRemindersService {
    constructor (@InjectQueue(QUEUES.todoReminders) private readonly queue: Queue<TodoReminderJob>) {}

    async sync (todo: Reminder, now = new Date()) {
        const jobId = todoReminderJobId(todo.id);
        // Removing first is what lets a moved reminder reuse the job id.
        await this.queue.remove(jobId);
        if (todo.done || !todo.remindAt || todo.remindAt <= now) {
            return;
        }
        await this.queue.add(
            "remind",
            { todoId: todo.id, remindAt: todo.remindAt.toISOString() },
            {
                jobId,
                delay: todo.remindAt.getTime() - now.getTime(),
                removeOnComplete: true,
                removeOnFail: { age: 7 * 24 * 3600 }
            }
        );
    }

    async cancel (todoId: string) {
        await this.queue.remove(todoReminderJobId(todoId));
    }
}
