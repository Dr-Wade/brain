import { z } from "zod";

// The contract for todos, shared by the API (validation, OpenAPI) and the
// client (forms). The `id` in `.meta()` names the schema in the OpenAPI
// document, and from there the type in the generated client.

export const TodoTitle = z.string().trim().min(1).max(200);

export const Todo = z.object({
    id: z.uuid(),
    title: z.string(),
    done: z.boolean(),
    // When the worker sends a reminder by e-mail. Null: no reminder.
    remindAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
}).meta({ id: "Todo" });
export type Todo = z.infer<typeof Todo>;

export const TodoList = z.array(Todo).meta({ id: "TodoList" });

export const TodoCreate = z.object({
    title: TodoTitle,
    remindAt: z.iso.datetime().nullable().optional()
}).meta({ id: "TodoCreate" });
export type TodoCreate = z.infer<typeof TodoCreate>;

export const TodoUpdate = z.object({
    title: TodoTitle.optional(),
    done: z.boolean().optional(),
    remindAt: z.iso.datetime().nullable().optional()
}).meta({ id: "TodoUpdate" });
export type TodoUpdate = z.infer<typeof TodoUpdate>;
