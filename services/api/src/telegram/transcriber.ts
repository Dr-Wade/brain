import type { FetchLike } from "../vault/github.js";

export interface Transcriber {
    transcribe (audio: Uint8Array, mimeType: string): Promise<string>
}

/** Deepgram's pre-recorded API: one request, the transcript back. */
export class DeepgramTranscriber implements Transcriber {
    constructor (
        private readonly options: { apiKey: string; url: string; model: string; language: string },
        private readonly fetchImpl: FetchLike = fetch
    ) {}

    async transcribe (audio: Uint8Array, mimeType: string): Promise<string> {
        const url = new URL("/v1/listen", this.options.url);
        url.search = new URLSearchParams({
            model: this.options.model,
            language: this.options.language,
            smart_format: "true",
            punctuate: "true"
        }).toString();
        const response = await this.fetchImpl(url.href, {
            method: "POST",
            headers: { "Authorization": `Token ${this.options.apiKey}`, "Content-Type": mimeType },
            body: Buffer.from(audio)
        });
        if (!response.ok) {
            throw new Error(`Deepgram answered ${response.status}`);
        }
        const body = await response.json() as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
        return body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    }
}
