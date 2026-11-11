// Turns the starter into a named project, once, then deletes itself.
//
//   pnpm init-project <name> ["Display name"]
//
// Renames the @starter/* packages, the queue prefix, the database and the
// titles, gives the project a port band of its own, removes README's template
// blurb, refreshes the lockfile, and lists what still says "starter". It
// leaves CLAUDE.md's "Starting a project from this" in place: its remaining
// steps (the worker, the todo example) are decisions for whoever runs it, and
// the last one replaces the section.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const [name, displayName] = process.argv.slice(2);
if (!name || !/^[a-z][a-z0-9-]{1,38}$/.test(name)) {
    console.error("usage: pnpm init-project <name> [\"Display name\"]   (name: lower-case, digits and dashes)");
    process.exit(1);
}
const title = displayName ?? name.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
// Postgres identifiers: no dashes.
const dbName = name.replaceAll("-", "_");

// A band of five ports derived from the name, clear of the well-known ones.
const COMMON = [5000, 5173, 5432, 5672, 6379, 8000, 8080, 8443, 8888, 9000, 9090, 9200];
function portBand () {
    let hash = 2166136261;
    for (const char of name) {
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    }
    for (;; hash++) {
        const base = 4000 + (hash % 590) * 10;
        if (base !== 4310 && !COMMON.some(port => port >= base && port < base + 10)) {
            return base;
        }
    }
}
const base = portBand();

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\n")
    .filter(file => file && file !== "pnpm-lock.yaml" && file !== "scripts/init-project.mjs" && !/\.(png|ico|jpg|woff2?)$/.test(file));
// Where "starter" names the database or its user rather than a package.
const DATABASE_FILES = new Set(["docker-compose.yaml", ".env.example", ".github/workflows/pr-check.yml", ".github/workflows/build.yml"]);

const changed = [];
for (const file of [...files, ".env"]) {
    let text;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        continue;
    }
    let next = text
        .replaceAll("@starter/", `@${name}/`)
        .replaceAll("Starter API", `${title} API`)
        .replace(/\b431([0-4])\b/g, (_, digit) => String(base + Number(digit)));
    if (file === "package.json") {
        next = next.replace(/"name": "starter"/, `"name": "${name}"`)
            .replace(/\n\s*"init-project": "[^"]*",?/, "")
            .replace(/,(\n\s*})/, "$1");
    }
    if (file === "packages/queues/src/index.ts") {
        next = next.replace(/QUEUE_PREFIX = "starter"/, `QUEUE_PREFIX = "${name}"`);
    }
    if (file === "services/client/index.html" || file.startsWith("services/client/src/locales/")) {
        next = next.replace(/<title>Starter<\/title>/, `<title>${title}</title>`).replace(/"name": "Starter"/, `"name": "${title}"`);
    }
    if (DATABASE_FILES.has(file) || file === ".env") {
        next = next.replace(/\bstarter\b/g, dbName);
    }
    if (file === "CLAUDE.md") {
        next = next.replace(/^# Starter — agent notes$/m, `# ${title} — agent notes`);
    }
    if (file === "README.md") {
        next = next.replace(/^# Starter$/m, `# ${title}`)
            .replace(/<!-- starter:begin -->[\s\S]*?<!-- starter:end -->\n*/g, "");
    }
    if (next !== text) {
        writeFileSync(file, next);
        changed.push(file);
    }
}

rmSync("scripts/init-project.mjs");
console.log(`Renamed to ${name} ("${title}"), ports ${base}–${base + 4}, ${changed.length} files changed.`);

console.log("Refreshing the lockfile…");
execFileSync("pnpm", ["install"], { stdio: "inherit" });

let leftovers = "(none)";
try {
    leftovers = execFileSync("git", ["grep", "-il", "--untracked", "starter", "--", ".", ":!pnpm-lock.yaml"], { encoding: "utf8" }).trim();
} catch {
    // git grep exits 1 when nothing matches.
}
console.log(`\nFiles that still mention "starter" (decide each one):\n${leftovers}`);
if (changed.includes(".env")) {
    console.log("\n.env was rewritten too: the database name and the ports changed. Run `pnpm db:down` first if the starter's containers are up.");
}
