import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { attachmentContent } from "./attachments.js";

/** A one-page PDF saying `text`, with a correct cross-reference table. */
function pdfSaying (text: string): Uint8Array {
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ];
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(body);
}

describe("attachmentContent", () => {
    it("scales a large photo down until it fits in a tool result", async () => {
        // Noise compresses badly: the worst case for size.
        const noise = Buffer.alloc(3000 * 2000 * 3);
        for (let index = 0; index < noise.length; index++) {
            noise[index] = (index * 2_654_435_761) >>> 24;
        }
        const photo = await sharp(noise, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
        const [caption, image] = await attachmentContent("Attachments/photo.jpg", new Uint8Array(photo));
        expect(caption).toMatchObject({ type: "text", text: expect.stringMatching(/^Attachments\/photo\.jpg \(3000×2000, shown at \d+ px\)$/) });
        expect(image).toMatchObject({ type: "image", mimeType: "image/jpeg" });
        const data = (image as { data: string }).data;
        expect(data.length).toBeLessThanOrEqual(110_000);
        const { width } = await sharp(Buffer.from(data, "base64")).metadata();
        expect(width).toBeLessThanOrEqual(1568);
    });

    it("gives a PDF's text, and says what it cannot show", async () => {
        const [pdf] = await attachmentContent("Attachments/devis.pdf", pdfSaying("Devis 2026 pour BCC Nancy"));
        expect(pdf).toEqual({ type: "text", text: "Attachments/devis.pdf (PDF, 1 page), its text:\n\nDevis 2026 pour BCC Nancy" });
        const [voice] = await attachmentContent("Attachments/voice.ogg", new Uint8Array(4096));
        expect((voice as { text: string }).text).toBe("Attachments/voice.ogg is audio (4 KB). Its transcript, when there is one, is in the note that embeds it.");
        const [sheet] = await attachmentContent("Attachments/budget.xlsx", new Uint8Array(10));
        expect((sheet as { text: string }).text).toMatch(/cannot show yet/);
    });
});
