// Bundle the server and its worker (engine included) into dist/. better-sqlite3 is a native
// module and stays external. A createRequire banner lets bundled CommonJS deps use require().
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/runWorker.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["better-sqlite3"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
