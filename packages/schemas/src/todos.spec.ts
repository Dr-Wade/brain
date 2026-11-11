import { describe, expect, it } from "vitest";

import { TodoCreate, TodoUpdate } from "./todos.js";

describe("TodoCreate", () => {
    it("trims the title", () => {
        expect(TodoCreate.parse({ title: "  Buy milk " })).toEqual({ title: "Buy milk" });
    });

    it("rejects a title that is only whitespace", () => {
        expect(TodoCreate.safeParse({ title: "   " }).success).toBe(false);
    });

    it("rejects a reminder that is not an ISO date-time", () => {
        expect(TodoCreate.safeParse({ title: "Call", remindAt: "tomorrow" }).success).toBe(false);
    });
});

describe("TodoUpdate", () => {
    it("accepts an empty patch", () => {
        expect(TodoUpdate.parse({})).toEqual({});
    });
});
