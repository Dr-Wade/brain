import { describe, expect, it } from "vitest";

import { loggerOptions } from "./index.js";

describe("loggerOptions", () => {
    it("is silent in tests unless LOG_LEVEL says otherwise", () => {
        expect(loggerOptions({ NODE_ENV: "test" }).level).toBe("silent");
        expect(loggerOptions({ NODE_ENV: "test", LOG_LEVEL: "debug" }).level).toBe("debug");
        expect(loggerOptions({ NODE_ENV: "production" }).level).toBe("info");
    });

    it("never logs the session cookie or a password", () => {
        const { redact } = loggerOptions({});
        const paths = typeof redact === "object" && !Array.isArray(redact) ? redact.paths : [];
        expect(paths).toEqual(expect.arrayContaining(["req.headers.cookie", "*.password"]));
    });
});
