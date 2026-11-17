import type { CallToolResult } from "@modelcontextprotocol/server";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * A vault file that is not a note, as Claude can take it in: a photo as an
 * image, a PDF or a text file as its text. Everything else is described.
 */

const IMAGE = /\.(?:jpe?g|png|gif|webp|avif|tiff?)$/i;
const PDF = /\.pdf$/i;
const TEXT = /\.(?:txt|md|csv|tsv|json|xml|html?|ics|vcf|log|ya?ml)$/i;
const AUDIO = /\.(?:ogg|oga|opus|mp3|m4a|wav|aac|flac)$/i;

/**
 * Claude takes at most ~150,000 characters from one tool result, base64
 * images included; a photo is scaled down until it fits well within.
 */
const IMAGE_BUDGET = 110_000;
const SIZES = [{ edge: 1568, quality: 80 }, { edge: 1280, quality: 75 }, { edge: 1024, quality: 70 }, { edge: 800, quality: 65 }, { edge: 640, quality: 60 }];
/** The text of a PDF or a text file, cut here. */
const TEXT_LIMIT = 100_000;

type Content = CallToolResult["content"];

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const cut = (text: string) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n\n[Cut here: the file is longer.]` : text);

export async function attachmentContent (path: string, bytes: Uint8Array): Promise<Content> {
    if (IMAGE.test(path)) {
        return await imageContent(path, bytes);
    }
    if (PDF.test(path)) {
        return await pdfContent(path, bytes);
    }
    if (TEXT.test(path)) {
        return [{ type: "text", text: `${path}\n\n${cut(new TextDecoder().decode(bytes))}` }];
    }
    if (AUDIO.test(path)) {
        return [{ type: "text", text: `${path} is audio (${kb(bytes.length)}). Its transcript, when there is one, is in the note that embeds it.` }];
    }
    return [{ type: "text", text: `${path} (${kb(bytes.length)}) is a kind of file the connector cannot show yet. Edward can open it in Obsidian.` }];
}

async function imageContent (path: string, bytes: Uint8Array): Promise<Content> {
    const source = sharp(bytes, { failOn: "none", animated: false });
    const { width, height } = await source.metadata();
    for (const { edge, quality } of SIZES) {
        const jpeg = await sharp(bytes, { failOn: "none", animated: false })
            .rotate()
            .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
        const data = jpeg.toString("base64");
        if (data.length <= IMAGE_BUDGET) {
            const scaled = width && height && Math.max(width, height) > edge ? `, shown at ${edge} px` : "";
            return [
                { type: "text", text: `${path} (${width ?? "?"}×${height ?? "?"}${scaled})` },
                { type: "image", data, mimeType: "image/jpeg" }
            ];
        }
    }
    return [{ type: "text", text: `${path} is an image too detailed to send even at 640 px (${kb(bytes.length)}).` }];
}

async function pdfContent (path: string, bytes: Uint8Array): Promise<Content> {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const words = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!words) {
        return [{ type: "text", text: `${path}: a PDF of ${totalPages} page${totalPages === 1 ? "" : "s"} with no text in it (a scan or a photo). Edward can open it in Obsidian.` }];
    }
    return [{ type: "text", text: `${path} (PDF, ${totalPages} page${totalPages === 1 ? "" : "s"}), its text:\n\n${cut(words)}` }];
}
