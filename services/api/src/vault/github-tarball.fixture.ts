import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * These files as GitHub serves a branch's tarball: `git archive` output (ustar
 * with long paths split into prefix and name, pax headers for longer ones)
 * under `<owner>-<repo>-<sha>/`. Built with the real git, for tests only.
 */
export function githubTarball (files: Record<string, string>, root = "Dr-Wade-vault-2d1a89f330b08e721372df5764876f34e0e843bd"): Uint8Array {
    const dir = mkdtempSync(join(tmpdir(), "vault-tarball-"));
    try {
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, path)), { recursive: true });
            writeFileSync(join(dir, path), content);
        }
        const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
            cwd: dir,
            // The machine's own git config (hooks, signing, templates) stays out.
            env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
            stdio: ["ignore", "pipe", "ignore"]
        });
        git("init", "-q");
        git("add", "-A");
        git("commit", "-q", "--allow-empty", "-m", "vault");
        return new Uint8Array(git("archive", "--format=tar.gz", `--prefix=${root}/`, "HEAD"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
