import "reflect-metadata";

import { getQueueToken } from "@nestjs/bullmq";
import type { INestApplication } from "@nestjs/common";
import { QUEUES, todoReminderJobId } from "@brain/queues";
import type { Todo } from "@brain/schemas";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../setup-app.js";

// Against the real database and Redis (`pnpm db:up`, or the CI services),
// through HTTP, the way the client calls it.
describe.skipIf(!process.env.DATABASE_URL)("todos API", () => {
    let app: INestApplication;
    let base: string;
    const origin = process.env.APP_URL ?? "http://localhost:4691";

    beforeAll(async () => {
        ({ app } = await createApp());
        await app.listen(0);
        base = `${await app.getUrl()}/api`.replace("[::1]", "localhost");
    });

    afterAll(async () => {
        await app?.close();
    });

    /** Signs a new user up and returns their session cookie. */
    async function signUp () {
        const email = `user-${crypto.randomUUID()}@example.com`;
        const response = await fetch(`${base}/auth/sign-up/email`, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify({ email, password: "correct horse battery", name: "Test" })
        });
        expect(response.status).toBe(200);
        return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    }

    const call = (cookie: string, method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });

    it("needs a session", async () => {
        expect((await fetch(`${base}/todos`)).status).toBe(401);
    });

    it("creates, lists, updates and deletes the caller's todos", async () => {
        const cookie = await signUp();

        const created = await call(cookie, "POST", "/todos", { title: "  Water the plants " });
        expect(created.status).toBe(201);
        const todo = await created.json() as Todo;
        expect(todo).toMatchObject({ title: "Water the plants", done: false, remindAt: null });

        const listed = await (await call(cookie, "GET", "/todos")).json() as Todo[];
        expect(listed.map(t => t.id)).toEqual([todo.id]);

        const updated = await (await call(cookie, "PATCH", `/todos/${todo.id}`, { done: true })).json() as Todo;
        expect(updated.done).toBe(true);

        expect((await call(cookie, "DELETE", `/todos/${todo.id}`)).status).toBe(204);
        expect(await (await call(cookie, "GET", "/todos")).json()).toEqual([]);
    });

    it("hides another user's todos", async () => {
        const owner = await signUp();
        const other = await signUp();
        const todo = await (await call(owner, "POST", "/todos", { title: "Mine" })).json() as Todo;

        expect(await (await call(other, "GET", "/todos")).json()).toEqual([]);
        expect((await call(other, "PATCH", `/todos/${todo.id}`, { done: true })).status).toBe(404);
        expect((await call(other, "DELETE", `/todos/${todo.id}`)).status).toBe(404);
    });

    it("rejects an invalid body", async () => {
        const cookie = await signUp();
        expect((await call(cookie, "POST", "/todos", { title: "" })).status).toBe(400);
        expect((await call(cookie, "PATCH", "/todos/not-a-uuid", { done: true })).status).toBe(400);
    });

    it("schedules a reminder and cancels it with the todo", async () => {
        const queue = app.get<Queue>(getQueueToken(QUEUES.todoReminders));
        const cookie = await signUp();
        const remindAt = new Date(Date.now() + 3_600_000).toISOString();

        const todo = await (await call(cookie, "POST", "/todos", { title: "Call", remindAt })).json() as Todo;
        const job = await queue.getJob(todoReminderJobId(todo.id));
        expect(job?.data).toEqual({ todoId: todo.id, remindAt });

        await call(cookie, "DELETE", `/todos/${todo.id}`);
        expect(await queue.getJob(todoReminderJobId(todo.id))).toBeUndefined();
    });
});
