import { gunzipSync } from "node:zlib";

/**
 * Reads the files out of a gzipped tarball, as GitHub serves a branch. GitHub's
 * tarball is `git archive` output: POSIX ustar, where a path longer than 100
 * bytes is split into the header's `prefix` and `name` fields, and a path that
 * cannot be split comes in a pax extended header. Both are read here; a reader
 * that only takes `name` loses every note with a long path.
 */
export interface TarFile {
    path: string
    bytes: Uint8Array
}

const BLOCK = 512;
const decoder = new TextDecoder();

export function readTarGz (gzipped: Uint8Array): TarFile[] {
    return readTar(gunzipSync(gzipped));
}

export function readTar (tar: Uint8Array): TarFile[] {
    const files: TarFile[] = [];
    // Overrides for the next entry: a pax `path`, or a GNU long name.
    let pax: Record<string, string> = {};
    let longName: string | undefined;
    for (let offset = 0; offset + BLOCK <= tar.length;) {
        const header = tar.subarray(offset, offset + BLOCK);
        if (header.every(byte => byte === 0)) {
            break;
        }
        const size = readSize(header.subarray(124, 136));
        const type = String.fromCharCode(header[156] ?? 0);
        const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
        offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

        if (type === "x") {
            pax = readPax(body);
            continue;
        }
        if (type === "L") {
            longName = cString(body);
            continue;
        }
        if (type === "g") {
            // Global header: GitHub puts the commit id there. No paths.
            continue;
        }
        const name = cString(header.subarray(0, 100));
        // The prefix field exists in POSIX ustar only; GNU tar uses those bytes for times.
        const prefix = cString(header.subarray(257, 263)) === "ustar" && header[262] === 0 ? cString(header.subarray(345, 500)) : "";
        const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
        pax = {};
        longName = undefined;
        if (type === "0" || type === "\0" || type === "7") {
            files.push({ path, bytes: body });
        }
    }
    return files;
}

/** Bytes up to the first NUL, as UTF-8. */
function cString (bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/** Octal digits, or base-256 when the high bit of the first byte is set. */
function readSize (field: Uint8Array): number {
    if ((field[0] ?? 0) & 0x80) {
        let size = (field[0] ?? 0) & 0x7f;
        for (const byte of field.subarray(1)) {
            size = size * 256 + byte;
        }
        return size;
    }
    return Number.parseInt(cString(field).trim() || "0", 8);
}

/** pax records: `<length> <key>=<value>\n`, the length counted in bytes. */
function readPax (body: Uint8Array): Record<string, string> {
    const records: Record<string, string> = {};
    for (let at = 0; at < body.length;) {
        const space = body.indexOf(0x20, at);
        if (space === -1) {
            break;
        }
        const length = Number.parseInt(decoder.decode(body.subarray(at, space)), 10);
        if (!Number.isFinite(length) || length <= 0) {
            break;
        }
        const record = decoder.decode(body.subarray(space + 1, at + length)).replace(/\n$/, "");
        const equals = record.indexOf("=");
        if (equals > 0) {
            records[record.slice(0, equals)] = record.slice(equals + 1);
        }
        at += length;
    }
    return records;
}
