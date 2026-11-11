import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerConfig } from "../config.js";
import type { PrismaService } from "../infrastructure.js";
import type { Mailer } from "../mailer.js";
import { TodoReminderProcessor } from "./todo-reminder.processor.js";

const TODO_ID = "0190f0a0-0000-7000-8000-000000000001";
const REMIND_AT = "2026-11-05T09:00:00.000Z";

// Services take their dependencies through the constructor, so a test passes
// fakes directly: no Nest testing module, no database.
function setup (todo: object | null) {
    const prisma = { todo: { findUnique: vi.fn().mockResolvedValue(todo) } };
    const mailer = { send: vi.fn().mockResolvedValue(undefined) };
    const config = new WorkerConfig({ DATABASE_URL: "postgresql://x@localhost/x", REDIS_URL: "redis://localhost" });
    const processor = new TodoReminderProcessor(prisma as unknown as PrismaService, mailer as unknown as Mailer, config);
    const run = () => processor.process({ data: { todoId: TODO_ID, remindAt: REMIND_AT } } as Job);
    return { mailer, run };
}

const todo = (overrides: object = {}) => ({
    id: TODO_ID,
    title: "Call the bank",
    done: false,
    remindAt: new Date(REMIND_AT),
    user: { email: "ada@example.com" },
    ...overrides
});

describe("TodoReminderProcessor", () => {
    beforeEach(() => vi.clearAllMocks());

    it("mails the owner when the reminder is still due", async () => {
        const { mailer, run } = setup(todo());
        await expect(run()).resolves.toBe("sent");
        expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.com", subject: "Reminder: Call the bank" }));
    });

    it.each([
        ["gone", null],
        ["done", todo({ done: true })],
        ["moved", todo({ remindAt: new Date("2026-11-06T09:00:00.000Z") })]
    ])("sends nothing when the todo is %s", async (outcome, row) => {
        const { mailer, run } = setup(row);
        await expect(run()).resolves.toBe(outcome);
        expect(mailer.send).not.toHaveBeenCalled();
    });
});
