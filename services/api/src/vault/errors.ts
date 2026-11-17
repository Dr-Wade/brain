/**
 * Failures Claude can explain to Edward and act on: they go back as tool
 * errors, not crashes (`answer()` in `mcp/tools.ts`). Anything else throws.
 */
export class VaultError extends Error {
    constructor (message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class NotConfiguredError extends VaultError {
    constructor (what: string) {
        super(`${what} is not configured on this server.`);
    }
}

export class NoteNotFoundError extends VaultError {
    constructor (path: string, hint = "") {
        super(`No note at "${path}".${hint}`);
    }
}

export class RepoNotAllowedError extends VaultError {
    constructor (repo: string, allowed: string[]) {
        super(`Issues can only be filed on: ${allowed.join(", ") || "(none configured)"}. Not on "${repo}".`);
    }
}

/** A path or a change the vault's conventions do not allow. */
export class VaultRuleError extends VaultError {}

/** An edit whose text to find is missing from the note, or there more than once. */
export class EditMismatchError extends VaultError {}
