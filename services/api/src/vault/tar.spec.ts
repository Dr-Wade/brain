import { describe, expect, it } from "vitest";

import { githubTarball } from "./github-tarball.fixture.js";
import { readTarGz } from "./tar.js";

/** As GitHub names it: owner, repo and the full commit sha. */
const ROOT = "Dr-Wade-vault-2d1a89f330b08e721372df5764876f34e0e843bd";

describe("readTarGz", () => {
    it("reads every path of a GitHub tarball, the long ones too", () => {
        // Over 100 bytes with the root: git splits it into the prefix and name fields.
        const long = "Inbox/2026-11-16 1832 To-do pour demain (17 novembre 2026) — corrigée.md";
        // One segment over 100 bytes: git writes a pax header for it.
        const longer = `Notes/${"Réorganisation des Drives partagés ".repeat(4).trim()}.md`;
        const files = { "Home.md": "# Home", [long]: "# To-do", [longer]: "# Drives", "Projects/.gitkeep": "" };
        const read = readTarGz(githubTarball(files, ROOT));
        const decoder = new TextDecoder();
        const byPath = Object.fromEntries(read.map(file => [file.path, decoder.decode(file.bytes)]));
        expect(byPath).toEqual({
            [`${ROOT}/Home.md`]: "# Home",
            [`${ROOT}/${long}`]: "# To-do",
            [`${ROOT}/${longer}`]: "# Drives",
            [`${ROOT}/Projects/.gitkeep`]: ""
        });
    });
});
