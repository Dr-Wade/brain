/**
 * The few GitHub REST calls the connector makes, over plain fetch. One client
 * per token: the vault and the issue repos use different fine-grained tokens.
 */
export class GitHubError extends Error {
    constructor (readonly status: number, message: string) {
        super(message);
        this.name = "GitHubError";
    }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubClient {
    constructor (
        private readonly token: string,
        private readonly fetchImpl: FetchLike = fetch,
        private readonly baseUrl = "https://api.github.com"
    ) {}

    /** The commit a branch points at. */
    async branchSha (repo: string, branch: string): Promise<string> {
        const body = await this.json<{ commit: { sha: string } }>("GET", `/repos/${repo}/branches/${encodeURIComponent(branch)}`);
        return body.commit.sha;
    }

    /** The repo at a commit, as a gzipped tarball. */
    async tarball (repo: string, ref: string): Promise<Uint8Array> {
        // GitHub answers with a redirect to codeload, whose URL carries its own
        // short-lived token: fetch drops our Authorization header there.
        const response = await this.request("GET", `/repos/${repo}/tarball/${encodeURIComponent(ref)}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    /**
     * Creates a file; never overwrites. Answers false when the path is taken,
     * so the caller can pick another name.
     */
    async createFile (repo: string, input: { path: string; content: string; message: string; branch: string }): Promise<{ created: false } | { created: true; htmlUrl: string }> {
        const response = await this.request("PUT", `/repos/${repo}/contents/${encodePath(input.path)}`, {
            message: input.message,
            content: Buffer.from(input.content, "utf8").toString("base64"),
            branch: input.branch
        }, [422]);
        if (response.status === 422) {
            return { created: false };
        }
        const body = await response.json() as { content: { html_url: string } };
        return { created: true, htmlUrl: body.content.html_url };
    }

    async createIssue (repo: string, input: { title: string; body: string }): Promise<{ number: number; htmlUrl: string }> {
        const body = await this.json<{ number: number; html_url: string }>("POST", `/repos/${repo}/issues`, input);
        return { number: body.number, htmlUrl: body.html_url };
    }

    private async json<T> (method: string, path: string, body?: unknown): Promise<T> {
        const response = await this.request(method, path, body);
        return await response.json() as T;
    }

    private async request (method: string, path: string, body?: unknown, allowed: number[] = []): Promise<Response> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method,
            headers: {
                "Accept": "application/vnd.github+json",
                "Authorization": `Bearer ${this.token}`,
                "User-Agent": "brain-connector",
                "X-GitHub-Api-Version": "2022-11-28",
                ...(body === undefined ? {} : { "Content-Type": "application/json" })
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok && !allowed.includes(response.status)) {
            const detail = await response.text().catch(() => "");
            throw new GitHubError(response.status, `GitHub ${method} ${path} answered ${response.status}: ${detail.slice(0, 200)}`);
        }
        return response;
    }
}

/** Each segment percent-encoded, the slashes kept. */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
