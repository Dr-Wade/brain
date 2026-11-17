import type { FetchLike } from "../vault/github.js";

export interface Transcriber {
    /** `keyterms`: names to listen for (the glossary's), spelled as they should come out. */
    transcribe (audio: Uint8Array, mimeType: string, keyterms?: string[]): Promise<string>
}

/** Deepgram's pre-recorded API: one request, the transcript back. */
export class DeepgramTranscriber implements Transcriber {
    constructor (
        private readonly options: { apiKey: string; url: string; model: string; language: string },
        private readonly fetchImpl: FetchLike = fetch
    ) {}

    async transcribe (audio: Uint8Array, mimeType: string, keyterms: string[] = []): Promise<string> {
        const url = new URL("/v1/listen", this.options.url);
        const params = new URLSearchParams({
            model: this.options.model,
            language: this.options.language,
            smart_format: "true",
            punctuate: "true"
        });
        // Keyterm prompting (Nova-3, multilingual too): one parameter per term.
        for (const term of keyterms) {
            params.append("keyterm", term);
        }
        url.search = params.toString();
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
