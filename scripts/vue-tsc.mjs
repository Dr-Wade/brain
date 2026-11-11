// Runs vue-tsc on TypeScript 6's JavaScript compiler, so .vue files are
// type-checked while the workspace itself stays on TypeScript 7.
//
// Usage, from a workspace that lists vue-tsc and @typescript/typescript6
// (services/client):
//
//   node ../../scripts/vue-tsc.mjs -p tsconfig.json --noEmit
//
// The arguments go to tsc unchanged, and the exit code is tsc's.
//
// Why not plain `vue-tsc`: vue-tsc works by patching the JavaScript tsc as it
// loads it, and TypeScript 7 ships no JavaScript compiler; its
// `typescript/lib/tsc.js` only launches the native binary. vue-tsc takes
// `typescript` as a peer, and pnpm resolves that peer to the workspace's
// TypeScript 7; one package's peer cannot be pointed elsewhere. Aliasing the
// client's own `typescript` to 6 would work for vue-tsc but also changes the
// peer `vue` resolves against, splitting Vue into two instances.
//
// So this calls the run(tscPath) that vue-tsc exports, with the tsc from
// @typescript/typescript6, the side-by-side TypeScript 6 Microsoft publishes
// for tools that still need the JavaScript API. TypeScript 7 is a port of 6,
// so both check the same language.
//
// Delete this script and call `vue-tsc` directly once vue-tsc runs on
// TypeScript 7.
import { createRequire } from "node:module";
import { join } from "node:path";

const requireFromWorkspace = createRequire(join(process.cwd(), "package.json"));
const { run } = requireFromWorkspace("vue-tsc");

run(requireFromWorkspace.resolve("@typescript/typescript6/lib/tsc"));
