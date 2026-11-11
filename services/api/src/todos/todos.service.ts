import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Todo as TodoRow } from "@starter/database";
import type { Todo, TodoCreate, TodoUpdate } from "@starter/schemas";

import { PrismaService } from "../prisma/prisma.service.js";
import { TodoRemindersService } from "./todo-reminders.service.js";

/** The row as the API returns it: dates as ISO strings, no owner id. */
export function toTodo (row: TodoRow): Todo {
    return {
        id: row.id,
        title: row.title,
        done: row.done,
        remindAt: row.remindAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
    };
}

// undefined leaves the column as it is; null clears it.
function toDate (value: string | null | undefined) {
    if (value === undefined || value === null) {
        return value;
    }
    return new Date(value);
}

/**
 * Every query is scoped to the caller: `userId` is part of each `where`, so a
 * todo of another user is indistinguishable from one that does not exist (404).
 */
@Injectable()
export class TodosService {
    constructor (
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(TodoRemindersService) private readonly reminders: TodoRemindersService
    ) {}

    async list (userId: string): Promise<Todo[]> {
        const rows = await this.prisma.todo.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
        return rows.map(toTodo);
    }

    async create (userId: string, input: TodoCreate): Promise<Todo> {
        const row = await this.prisma.todo.create({
            data: { userId, title: input.title, remindAt: toDate(input.remindAt) }
        });
        await this.reminders.sync(row);
        return toTodo(row);
    }

    async update (userId: string, id: string, input: TodoUpdate): Promise<Todo> {
        const row = await this.ownedOr404(() => this.prisma.todo.update({
            where: { id, userId },
            data: { title: input.title, done: input.done, remindAt: toDate(input.remindAt) }
        }));
        await this.reminders.sync(row);
        return toTodo(row);
    }

    async remove (userId: string, id: string): Promise<void> {
        await this.ownedOr404(() => this.prisma.todo.delete({ where: { id, userId } }));
        await this.reminders.cancel(id);
    }

    private async ownedOr404<T> (query: () => Promise<T>): Promise<T> {
        try {
            return await query();
        } catch (error) {
            // P2025: no row matched the where, which includes the owner.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
                throw new NotFoundException("Todo not found");
            }
            throw error;
        }
    }
}
