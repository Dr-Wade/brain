import type { FetchLike } from "../vault/github.js";

/** The parts of Telegram's Bot API types this bot reads. */
export interface TgUser {
    id: number
    is_bot?: boolean
    first_name: string
    last_name?: string
    username?: string
}

export interface TgChat {
    id: number
    type: "private" | "group" | "supergroup" | "channel"
    title?: string
    username?: string
}

export type TgOrigin =
    | { type: "user"; date: number; sender_user: TgUser }
    | { type: "hidden_user"; date: number; sender_user_name: string }
    | { type: "chat"; date: number; sender_chat: TgChat; author_signature?: string }
    | { type: "channel"; date: number; chat: TgChat; message_id: number; author_signature?: string };

export interface TgFile {
    file_id: string
    file_size?: number
    mime_type?: string
    file_name?: string
}

export interface TgEntity {
    type: string
    offset: number
    length: number
    url?: string
}

export interface TgMessage {
    message_id: number
    date: number
    chat: TgChat
    from?: TgUser
    text?: string
    caption?: string
    entities?: TgEntity[]
    caption_entities?: TgEntity[]
    forward_origin?: TgOrigin
    voice?: TgFile & { duration: number }
    audio?: TgFile & { duration: number }
    photo?: (TgFile & { width: number; height: number })[]
    document?: TgFile
    video?: TgFile
    video_note?: TgFile
    sticker?: TgFile
    reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] }
}

export interface TgCallbackQuery {
    id: string
    from: TgUser
    message?: TgMessage
    data?: string
}

export interface TgUpdate {
    update_id: number
    message?: TgMessage
    callback_query?: TgCallbackQuery
}

/** A row of buttons under a message; `data` comes back in a callback query. */
export type TgKeyboard = { text: string; data: string }[][];

const markup = (buttons?: TgKeyboard) =>
    buttons?.length ? { reply_markup: { inline_keyboard: buttons.map(row => row.map(button => ({ text: button.text, callback_data: button.data }))) } } : {};

/** Telegram's own limit for bots downloading a file. */
export const DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

/** The Bot API calls this bot makes, over plain fetch. */
export class TelegramBotApi {
    constructor (
        private readonly token: string,
        private readonly fetchImpl: FetchLike = fetch,
        private readonly baseUrl = "https://api.telegram.org"
    ) {}

    sendMessage (chatId: number, text: string, buttons?: TgKeyboard): Promise<TgMessage> {
        return this.call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...markup(buttons) });
    }

    /** Replaces a message's text and buttons (none: the buttons go). */
    async editMessageText (chatId: number, messageId: number, text: string, buttons?: TgKeyboard): Promise<void> {
        try {
            await this.call("editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text,
                link_preview_options: { is_disabled: true },
                reply_markup: { inline_keyboard: (buttons ?? []).map(row => row.map(button => ({ text: button.text, callback_data: button.data }))) }
            });
        } catch (error) {
            // A second tap on the same button: nothing to change.
            if (!/message is not modified/i.test((error as Error).message)) {
                throw error;
            }
        }
    }

    /** Stops the button's spinner; `text` shows briefly at the top of the chat. */
    answerCallbackQuery (id: string, text?: string): Promise<unknown> {
        return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
    }

    getFile (fileId: string): Promise<{ file_path?: string; file_size?: number }> {
        return this.call("getFile", { file_id: fileId });
    }

    async download (filePath: string): Promise<Uint8Array> {
        const response = await this.fetchImpl(`${this.baseUrl}/file/bot${this.token}/${filePath}`);
        if (!response.ok) {
            throw new Error(`Telegram file download answered ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }

    setWebhook (params: { url: string; secret_token: string; max_connections: number; allowed_updates: string[] }): Promise<unknown> {
        return this.call("setWebhook", params);
    }

    setMyCommands (commands: { command: string; description: string }[]): Promise<unknown> {
        return this.call("setMyCommands", { commands });
    }

    private async call<T> (method: string, params: object): Promise<T> {
        const response = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params)
        });
        const body = await response.json() as { ok: boolean; result?: T; description?: string };
        if (!body.ok) {
            // Never the URL: it holds the token.
            throw new Error(`Telegram ${method} failed: ${body.description ?? response.status}`);
        }
        return body.result as T;
    }
}
