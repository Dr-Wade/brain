import { describe, expect, it, vi } from "vitest";

import { AppConfig } from "../config/app-config.js";
import type { TgMessage, TgUpdate } from "./bot-api.js";
import { messageMarkdown, originLink, textWithLinks, titleForMessage } from "./messages.js";
import { APPEND_WINDOW_MS, TelegramService } from "./telegram.service.js";

const OWNER = 128927407;
const env = {
    DATABASE_URL: "postgresql://unused@localhost/x",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_SECRET: "a-secret-of-sixteen-chars",
    TELEGRAM_ALLOWED_USER_ID: String(OWNER),
    VAULT_TIMEZONE: "Europe/Paris"
};

/** Telegram's Bot API, recording what the bot says and serving files. */
function fakeTelegram (files: Record<string, { path: string; bytes: string; size?: number }> = {}) {
    const sent: { chat: number; text: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        const method = url.split("/").pop()!;
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
        if (url.includes("/file/bot")) {
            const file = Object.values(files).find(candidate => url.endsWith(candidate.path));
            return new Response(file?.bytes ?? "", { status: file ? 200 : 404 });
        }
        if (method === "sendMessage") {
            sent.push({ chat: body.chat_id as number, text: body.text as string });
        }
        if (method === "getFile") {
            const file = files[body.file_id as string];
            return Response.json({ ok: true, result: { file_path: file?.path, file_size: file?.size } });
        }
        return Response.json({ ok: true, result: true });
    });
    return { sent, fetchImpl };
}

function fakeVault () {
    let captures = 0;
    return {
        capture: vi.fn(async (capture: { text: string; title?: string }) => ({ path: `Inbox/capture-${++captures}.md`, url: "u", title: capture.title ?? "Idea" })),
        append: vi.fn(async () => undefined),
        saveAttachment: vi.fn(async (name: string) => `Attachments/2026-11-11 1402 ${name}`),
        search: vi.fn(async () => [{ path: "Notes/Paiements.md", title: "Paiements", snippet: "Suivi des paiements", score: 6 }]),
        inbox: vi.fn(async () => [{ path: "Inbox/a.md", title: "A", preview: "" }])
    };
}

function setup (options: { files?: Parameters<typeof fakeTelegram>[0]; transcript?: string; overrides?: Record<string, string | undefined> } = {}) {
    const telegram = fakeTelegram(options.files);
    const vault = fakeVault();
    let now = 1_794_400_000_000;
    const transcriber = options.transcript === undefined ? undefined : { transcribe: vi.fn(async () => options.transcript!) };
    const service = new TelegramService(new AppConfig({ ...env, ...options.overrides }), vault, { fetchImpl: telegram.fetchImpl, now: () => now, transcriber });
    let id = 0;
    const send = (message: Partial<TgMessage>, updateId = ++id) => service.handle({
        update_id: updateId,
        message: { message_id: updateId, date: 1_794_400_000, chat: { id: OWNER, type: "private" }, from: { id: OWNER, first_name: "Edward" }, ...message }
    } as TgUpdate);
    return { service, vault, telegram, send, transcriber, advance: (ms: number) => (now += ms) };
}

const forwardFrom = (name: string, text: string): Partial<TgMessage> => ({
    text,
    forward_origin: { type: "user", date: 1_794_399_000, sender_user: { id: 5, first_name: name } }
});

describe("TelegramService", () => {
    it("saves a message to the inbox, as a Telegram capture, and says so", async () => {
        const { vault, telegram, send } = setup();
        await send({ text: "Il faut mieux suivre les paiements des inscriptions" });
        expect(vault.capture).toHaveBeenCalledWith({ text: "Il faut mieux suivre les paiements des inscriptions", title: "Il faut mieux suivre les paiements des inscriptions", source: "telegram" });
        expect(telegram.sent).toEqual([{ chat: OWNER, text: "✅ Inbox: “Il faut mieux suivre les paiements des inscriptions”" }]);
    });

    it("answers only its owner, in private", async () => {
        const { vault, telegram, service } = setup();
        await service.handle({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 9, type: "private" }, from: { id: 9, first_name: "Eve" }, text: "hi" } });
        await service.handle({ update_id: 2, message: { message_id: 2, date: 0, chat: { id: -100, type: "group" }, from: { id: OWNER, first_name: "Edward" }, text: "hi" } });
        expect(vault.capture).not.toHaveBeenCalled();
        expect(telegram.sent).toEqual([]);
    });

    it("joins forwards sent together, after a comment, into one note", async () => {
        const { vault, telegram, send, advance } = setup();
        await send({ text: "Décision du CA sur les cotisations" });
        advance(2_000);
        await send(forwardFrom("Alice", "On passe à 30 €"));
        advance(1_000);
        await send(forwardFrom("Bob", "D'accord"));
        expect(vault.capture).toHaveBeenCalledTimes(1);
        expect(vault.append).toHaveBeenCalledTimes(2);
        expect(vault.append).toHaveBeenNthCalledWith(1, "Inbox/capture-1.md", expect.stringContaining("> **Alice** ·"), "Telegram: add to Décision du CA sur les cotisations");
        expect(telegram.sent.at(-1)?.text).toBe("➕ Added to “Décision du CA sur les cotisations”");

        advance(APPEND_WINDOW_MS + 1);
        await send(forwardFrom("Carol", "Autre sujet"));
        expect(vault.capture).toHaveBeenCalledTimes(2);
        expect(vault.capture).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Carol: Autre sujet" }));
    });

    it("keeps a voice note's audio and its transcript", async () => {
        const { vault, send, transcriber } = setup({ files: { v1: { path: "voice/file_1.oga", bytes: "OGG" } }, transcript: "Penser à réserver la salle" });
        await send({ voice: { file_id: "v1", duration: 4, mime_type: "audio/ogg" } });
        expect(vault.saveAttachment).toHaveBeenCalledWith("voice.ogg", new Uint8Array(Buffer.from("OGG")));
        expect(transcriber?.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/ogg");
        expect(vault.capture).toHaveBeenCalledWith({
            text: "Penser à réserver la salle\n\n![[Attachments/2026-11-11 1402 voice.ogg]]",
            title: "Penser à réserver la salle",
            source: "telegram"
        });
    });

    it("keeps the audio when no transcription is configured", async () => {
        const { vault, send } = setup({ files: { v1: { path: "voice/file_1.oga", bytes: "OGG" } } });
        await send({ voice: { file_id: "v1", duration: 4 } });
        expect(vault.capture).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("no transcription configured"), title: "Voice note" }));
    });

    it("saves the largest photo with its caption, and refuses files over 20 MB", async () => {
        const { vault, send } = setup({ files: { big: { path: "photos/big.jpg", bytes: "JPG" } } });
        await send({ caption: "Tableau du CA", photo: [{ file_id: "small", width: 90, height: 90 }, { file_id: "big", width: 1280, height: 960 }] });
        expect(vault.saveAttachment).toHaveBeenCalledWith("photo.jpg", expect.any(Uint8Array));
        expect(vault.capture).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Tableau du CA\n\n![[Attachments/2026-11-11 1402 photo.jpg]]" }));

        vault.saveAttachment.mockClear();
        await send({ document: { file_id: "huge", file_name: "video.mov", file_size: 50 * 1024 * 1024 } });
        expect(vault.saveAttachment).not.toHaveBeenCalled();
        expect(vault.capture).toHaveBeenLastCalledWith(expect.objectContaining({ text: "_(video.mov is over 20 MB, too large for a bot to fetch)_" }));
    });

    it("answers /help, /inbox, /find and registered commands", async () => {
        const { service, telegram, send } = setup();
        service.registerCommand("next", { description: "Meetings", run: async () => "• Fri 13 Nov 09:00 — Café" });
        await send({ text: "/help" });
        expect(telegram.sent.at(-1)?.text).toContain("/find — Search the vault");
        expect(telegram.sent.at(-1)?.text).toContain("/next — Meetings");
        await send({ text: "/inbox" });
        expect(telegram.sent.at(-1)?.text).toBe("1 in the inbox:\n1. A");
        await send({ text: "/find paiements" });
        expect(telegram.sent.at(-1)?.text).toBe("• Paiements (Notes/Paiements.md)\n  Suivi des paiements");
        await send({ text: "/next@drwade_brain_bot" });
        expect(telegram.sent.at(-1)?.text).toBe("• Fri 13 Nov 09:00 — Café");
        await send({ text: "/nope" });
        expect(telegram.sent.at(-1)?.text).toBe("Unknown command /nope. Try /help.");
    });

    it("handles a redelivered update once", async () => {
        const { vault, send } = setup();
        await send({ text: "once" }, 42);
        await send({ text: "once" }, 42);
        expect(vault.capture).toHaveBeenCalledTimes(1);
    });

    it("asks Telegram to retry a failure, and gives up after three", async () => {
        const { vault, telegram, send } = setup();
        vault.capture.mockRejectedValue(new Error("GitHub is down"));
        await expect(send({ text: "x" }, 7)).rejects.toThrow("GitHub is down");
        await expect(send({ text: "x" }, 7)).rejects.toThrow("GitHub is down");
        await send({ text: "x" }, 7);
        expect(telegram.sent.at(-1)?.text).toBe("⚠️ Gave up on this message after 3 tries: GitHub is down");
        await send({ text: "x" }, 7);
        expect(vault.capture).toHaveBeenCalledTimes(3);
    });

    it("checks the webhook secret, and tells the owner", async () => {
        const { service, telegram } = setup();
        expect(service.acceptsSecret("a-secret-of-sixteen-chars")).toBe(true);
        expect(service.acceptsSecret("a-secret-of-sixteen-charz")).toBe(false);
        expect(service.acceptsSecret(undefined)).toBe(false);
        expect(await service.notifyOwner("📅 hello")).toBe(true);
        expect(telegram.sent).toEqual([{ chat: OWNER, text: "📅 hello" }]);

        const off = setup({ overrides: { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_WEBHOOK_SECRET: undefined } });
        expect(off.service.configured).toBe(false);
        expect(off.service.acceptsSecret("a-secret-of-sixteen-chars")).toBe(false);
        expect(await off.service.notifyOwner("x")).toBe(false);
    });
});

describe("Telegram messages as Markdown", () => {
    it("quotes a forward under its author and date, with a link for channel posts", () => {
        const message = { message_id: 1, date: 0, chat: { id: 1, type: "private" as const }, forward_origin: { type: "channel" as const, date: 1_794_399_000, chat: { id: -1001234, type: "channel" as const, title: "BCC infos" }, message_id: 77 } };
        expect(originLink(message.forward_origin)).toBe("https://t.me/c/1234/77");
        expect(originLink({ ...message.forward_origin, chat: { ...message.forward_origin.chat, username: "bccnancy" } })).toBe("https://t.me/bccnancy/77");
        expect(messageMarkdown(message, { body: "Line 1\n\nLine 2", attachments: [] }, "Europe/Paris"))
            .toBe("> **BCC infos** · 11 Nov 2026 13:10 · [open](https://t.me/c/1234/77)\n> Line 1\n>\n> Line 2");
    });

    it("shows hidden links and titles a forward by its author", () => {
        expect(textWithLinks("See the minutes and the sheet", [{ type: "text_link", offset: 8, length: 7, url: "https://docs.example/m" }]))
            .toBe("See the [minutes](https://docs.example/m) and the sheet");
        const forward = { message_id: 1, date: 0, chat: { id: 1, type: "private" as const }, forward_origin: { type: "user" as const, date: 0, sender_user: { id: 2, first_name: "Alice", username: "alice" } } };
        expect(titleForMessage(forward, "Budget voté.")).toBe("Alice: Budget voté");
        expect(titleForMessage(forward, "")).toBe("From Alice");
    });
});
