import { timingSafeEqual } from "node:crypto";

import { Logger, type OnApplicationBootstrap } from "@nestjs/common";

import type { AppConfig } from "../config/app-config.js";
import type { FetchLike } from "../vault/github.js";
import type { VaultService } from "../vault/vault.service.js";
import { DOWNLOAD_LIMIT_BYTES, TelegramBotApi, type TgFile, type TgMessage, type TgUpdate } from "./bot-api.js";
import { messageMarkdown, messageText, titleForMessage } from "./messages.js";
import { DeepgramTranscriber, type Transcriber } from "./transcriber.js";

/** Forwards arriving this soon after the last capture join its note. */
export const APPEND_WINDOW_MS = 30_000;
/** A message that keeps failing is given up after this many deliveries. */
const MAX_ATTEMPTS = 3;

export interface TelegramCommand {
    description: string
    run (args: string): Promise<string>
}

type Vault = Pick<VaultService, "capture" | "append" | "saveAttachment" | "search" | "inbox">;

const HELP = `Send me anything to keep: text, voice notes, photos, files. Forward messages from any chat; forward several at once and they share one note.
Everything lands in the vault's inbox for Sunday's sort.`;

/**
 * The Brain bot: whatever Edward sends it becomes an inbox note. Telegram is
 * the queue (see CLAUDE.md): the webhook answers only once the note is saved,
 * one update at a time, and a failure makes Telegram deliver it again.
 */
export class TelegramService implements OnApplicationBootstrap {
    private readonly logger = new Logger(TelegramService.name);
    private readonly api?: TelegramBotApi;
    private readonly transcriber?: Transcriber;
    private readonly now: () => number;
    private readonly commands = new Map<string, TelegramCommand>();
    private readonly seen = new Set<number>();
    private readonly failures = new Map<number, number>();
    private last?: { path: string; title: string; at: number };

    constructor (
        private readonly config: AppConfig,
        private readonly vault: Vault,
        // Test seams: Telegram's and Deepgram's HTTP, and the clock.
        deps: { fetchImpl?: FetchLike; now?: () => number; transcriber?: Transcriber } = {}
    ) {
        const { env } = config;
        const fetchImpl = deps.fetchImpl ?? fetch;
        this.now = deps.now ?? Date.now;
        if (env.TELEGRAM_BOT_TOKEN) {
            this.api = new TelegramBotApi(env.TELEGRAM_BOT_TOKEN, fetchImpl);
        }
        this.transcriber = deps.transcriber ?? (env.DEEPGRAM_API_KEY
            ? new DeepgramTranscriber({ apiKey: env.DEEPGRAM_API_KEY, url: env.DEEPGRAM_URL, model: env.DEEPGRAM_MODEL, language: env.DEEPGRAM_LANGUAGE }, fetchImpl)
            : undefined);
        this.registerCommand("inbox", { description: "What waits to be sorted", run: () => this.inboxCommand() });
        this.registerCommand("find", { description: "Search the vault: /find words", run: args => this.findCommand(args) });
    }

    get configured (): boolean {
        const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_USER_ID } = this.config.env;
        return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_WEBHOOK_SECRET && TELEGRAM_ALLOWED_USER_ID);
    }

    /** Commands other modules add (meetings: /next). */
    registerCommand (name: string, command: TelegramCommand): void {
        this.commands.set(name, command);
    }

    /** Constant-time check of the secret Telegram sends with every update. */
    acceptsSecret (secret: string | undefined): boolean {
        const expected = this.config.env.TELEGRAM_WEBHOOK_SECRET;
        if (!this.configured || !expected || !secret) {
            return false;
        }
        const a = Buffer.from(secret);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
    }

    /** A message to Edward (the bot's private chat with him). Nothing when unconfigured. */
    async notifyOwner (text: string): Promise<boolean> {
        const owner = this.config.env.TELEGRAM_ALLOWED_USER_ID;
        if (!this.api || !owner) {
            return false;
        }
        await this.api.sendMessage(Number(owner), text);
        return true;
    }

    /** Points Telegram at this server, one update at a time. Production only. */
    async onApplicationBootstrap (): Promise<void> {
        const { env } = this.config;
        if (!this.api || !this.configured || env.NODE_ENV !== "production") {
            return;
        }
        try {
            await this.api.setWebhook({
                url: new URL("/api/telegram/webhook", env.APP_URL).href,
                secret_token: env.TELEGRAM_WEBHOOK_SECRET!,
                max_connections: 1,
                allowed_updates: ["message"]
            });
            await this.api.setMyCommands([...this.commands].map(([command, { description }]) => ({ command, description })));
            this.logger.log("Telegram webhook registered");
        } catch (error) {
            this.logger.error(`Telegram webhook registration failed: ${(error as Error).message}`);
        }
    }

    /**
     * One update. Resolves once handled (or deliberately ignored); throws when
     * Telegram should deliver it again.
     */
    async handle (update: TgUpdate): Promise<void> {
        if (this.seen.has(update.update_id)) {
            return;
        }
        const message = update.message;
        if (!message) {
            this.markSeen(update.update_id);
            return;
        }
        if (message.chat.type !== "private" || String(message.from?.id) !== this.config.env.TELEGRAM_ALLOWED_USER_ID) {
            // Logged with the id, so the owner can find theirs if it is not set yet.
            this.logger.warn(`Ignored a message from Telegram user ${message.from?.id ?? "?"} in a ${message.chat.type} chat`);
            this.markSeen(update.update_id);
            return;
        }
        try {
            await this.process(message);
            this.markSeen(update.update_id);
            this.failures.delete(update.update_id);
        } catch (error) {
            const attempts = (this.failures.get(update.update_id) ?? 0) + 1;
            this.failures.set(update.update_id, attempts);
            this.logger.error(`Telegram update ${update.update_id} failed (attempt ${attempts}): ${(error as Error).message}`);
            if (attempts < MAX_ATTEMPTS) {
                throw error;
            }
            this.markSeen(update.update_id);
            this.failures.delete(update.update_id);
            await this.reply(message, `⚠️ Gave up on this message after ${MAX_ATTEMPTS} tries: ${(error as Error).message}`).catch(() => undefined);
        }
    }

    private async process (message: TgMessage): Promise<void> {
        const text = message.text?.trim() ?? "";
        if (text.startsWith("/") && !message.forward_origin) {
            await this.reply(message, await this.command(text));
            return;
        }
        const now = this.now();
        const { attachments, notes, transcript } = await this.saveFiles(message);
        const own = messageText(message);
        // The title comes from the words, never from a remark like "no transcription".
        const words = [transcript, own].filter(Boolean).join("\n\n");
        const body = [words, ...notes].filter(Boolean).join("\n\n");
        const markdown = messageMarkdown(message, { body, attachments }, this.config.env.VAULT_TIMEZONE);

        const joining = message.forward_origin && this.last && now - this.last.at < APPEND_WINDOW_MS ? this.last : undefined;
        if (joining) {
            await this.vault.append(joining.path, markdown, `Telegram: add to ${joining.title}`);
            joining.at = now;
            await this.reply(message, `➕ Added to “${joining.title}”`);
            return;
        }
        const saved = await this.vault.capture({ text: markdown, title: titleForMessage(message, words), source: "telegram" });
        this.last = { path: saved.path, title: saved.title, at: now };
        await this.reply(message, `✅ Inbox: “${saved.title}”`);
    }

    /** Downloads the message's file into Attachments/, and transcribes a voice note. */
    private async saveFiles (message: TgMessage): Promise<{ attachments: string[]; notes: string[]; transcript?: string }> {
        const attachments: string[] = [];
        const notes: string[] = [];
        let transcript: string | undefined;

        const audio = message.voice ?? message.audio;
        const largestPhoto = message.photo?.at(-1);
        const file: (TgFile & { name: string }) | undefined = audio
            ? { ...audio, name: message.audio?.file_name ?? "voice.ogg" }
            : largestPhoto
                ? { ...largestPhoto, name: "photo.jpg" }
                : message.document
                    ? { ...message.document, name: message.document.file_name ?? "file" }
                    : undefined;

        if (!file) {
            if (message.video || message.video_note || message.sticker) {
                notes.push(`_(${message.sticker ? "sticker" : "video"} not saved)_`);
            }
            return { attachments, notes };
        }
        if ((file.file_size ?? 0) > DOWNLOAD_LIMIT_BYTES) {
            notes.push(`_(${file.name} is over 20 MB, too large for a bot to fetch)_`);
            return { attachments, notes };
        }
        const info = await this.api!.getFile(file.file_id);
        if (!info.file_path) {
            notes.push(`_(${file.name} could not be fetched from Telegram)_`);
            return { attachments, notes };
        }
        const bytes = await this.api!.download(info.file_path);
        attachments.push(await this.vault.saveAttachment(file.name, bytes));

        if (audio) {
            if (!this.transcriber) {
                notes.push("_(voice note: no transcription configured)_");
            } else {
                try {
                    transcript = await this.transcriber.transcribe(bytes, audio.mime_type ?? "audio/ogg") || "_(nothing heard)_";
                } catch (error) {
                    this.logger.error(`Transcription failed: ${(error as Error).message}`);
                    notes.push("_(transcription failed; the audio is attached)_");
                }
            }
        }
        return { attachments, notes, transcript };
    }

    private async command (text: string): Promise<string> {
        const [head = "", ...rest] = text.slice(1).split(/\s+/);
        const name = head.replace(/@.*$/, "").toLowerCase();
        const args = rest.join(" ").trim();
        if (name === "start" || name === "help") {
            const list = [...this.commands].map(([command, { description }]) => `/${command} — ${description}`).join("\n");
            return `${HELP}\n\n${list}`;
        }
        const command = this.commands.get(name);
        return command ? await command.run(args) : `Unknown command /${name}. Try /help.`;
    }

    private async inboxCommand (): Promise<string> {
        const items = await this.vault.inbox();
        if (items.length === 0) {
            return "The inbox is empty.";
        }
        const shown = items.slice(0, 25).map((item, index) => `${index + 1}. ${item.title}`);
        const more = items.length > 25 ? `\n…and ${items.length - 25} more` : "";
        return `${items.length} in the inbox:\n${shown.join("\n")}${more}`;
    }

    private async findCommand (query: string): Promise<string> {
        if (!query) {
            return "What should I look for? /find words";
        }
        const hits = await this.vault.search(query, 5);
        if (hits.length === 0) {
            return `Nothing matches “${query}”.`;
        }
        return hits.map(hit => `• ${hit.title} (${hit.path})\n  ${hit.snippet}`).join("\n\n");
    }

    private async reply (message: TgMessage, text: string): Promise<void> {
        await this.api?.sendMessage(message.chat.id, text);
    }

    private markSeen (updateId: number): void {
        this.seen.add(updateId);
        if (this.seen.size > 500) {
            const oldest = this.seen.values().next().value;
            if (oldest !== undefined) {
                this.seen.delete(oldest);
            }
        }
    }
}
