/**
 * Telegram messages as vault Markdown. Pure: the service downloads files and
 * passes their vault paths in.
 */
import type { TgEntity, TgMessage, TgOrigin, TgUser } from "./bot-api.js";

const userName = (user: TgUser) => [user.first_name, user.last_name].filter(Boolean).join(" ") + (user.username ? ` (@${user.username})` : "");

/** Who wrote a forwarded message, as Telegram tells a bot. */
export function originLabel (origin: TgOrigin): string {
    switch (origin.type) {
        case "user": return userName(origin.sender_user);
        case "hidden_user": return origin.sender_user_name;
        case "chat": return [origin.sender_chat.title ?? "a group", origin.author_signature].filter(Boolean).join(" · ");
        case "channel": return [origin.chat.title ?? "a channel", origin.author_signature].filter(Boolean).join(" · ");
    }
}

/**
 * A t.me link to the original, which Telegram only gives for channel posts.
 * A message forwarded from a group carries its author, never the group.
 */
export function originLink (origin: TgOrigin): string | undefined {
    if (origin.type !== "channel") {
        return undefined;
    }
    if (origin.chat.username) {
        return `https://t.me/${origin.chat.username}/${origin.message_id}`;
    }
    // Private channels: -100<id> → t.me/c/<id>/<message>.
    const internal = String(origin.chat.id).replace(/^-100/, "");
    return `https://t.me/c/${internal}/${origin.message_id}`;
}

/** "11 Nov 2026 14:02", in the vault's zone. */
export function formatDate (unixSeconds: number, timeZone: string): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(new Date(unixSeconds * 1000)).replace(",", "");
}

/** The text with its hidden links (`text_link` entities) made visible as Markdown links. */
export function textWithLinks (text: string, entities: TgEntity[] = []): string {
    const links = entities.filter(entity => entity.type === "text_link" && entity.url).sort((a, b) => b.offset - a.offset);
    let result = text;
    for (const link of links) {
        const label = result.slice(link.offset, link.offset + link.length);
        result = `${result.slice(0, link.offset)}[${label}](${link.url})${result.slice(link.offset + link.length)}`;
    }
    return result;
}

/** The message's own words: its text, or a media caption. */
export function messageText (message: TgMessage): string {
    if (message.text) {
        return textWithLinks(message.text, message.entities);
    }
    return message.caption ? textWithLinks(message.caption, message.caption_entities) : "";
}

/** An embed for a saved file: images, PDFs and audio show inline, the rest link. */
export function embed (vaultPath: string): string {
    return /\.(png|jpe?g|gif|webp|pdf|ogg|oga|mp3|m4a|wav)$/i.test(vaultPath) ? `![[${vaultPath}]]` : `[[${vaultPath}]]`;
}

/**
 * One message as Markdown: own words as they are, a forwarded one as a quote
 * headed by its author and date (and its link when Telegram gives one).
 */
export function messageMarkdown (message: TgMessage, parts: { body: string; attachments: string[] }, timeZone: string): string {
    const blocks = [parts.body.trim(), ...parts.attachments.map(embed)].filter(Boolean);
    const content = blocks.join("\n\n") || "_(empty message)_";
    const origin = message.forward_origin;
    if (!origin) {
        return content;
    }
    const link = originLink(origin);
    const header = `**${originLabel(origin)}** · ${formatDate(origin.date, timeZone)}${link ? ` · [open](${link})` : ""}`;
    return [header, ...content.split("\n")].map(line => (line ? `> ${line}` : ">")).join("\n");
}

/** A title for the note a message starts. */
export function titleForMessage (message: TgMessage, body: string): string | undefined {
    const words = body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim().split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    const short = words.replace(/[.,;:!?]+$/, "");
    if (message.forward_origin) {
        const from = originLabel(message.forward_origin).replace(/\s*\(@[^)]*\)$/, "");
        return short ? `${from}: ${short}` : `From ${from}`;
    }
    if (short) {
        return short;
    }
    if (message.voice || message.audio) {
        return "Voice note";
    }
    return message.photo ? "Photo" : message.document ? (message.document.file_name ?? "File") : undefined;
}
