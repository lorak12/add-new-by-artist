/**
 * Watch mode — rebuilds on file changes and copies to Spicetify Extensions.
 * After each build, runs `spicetify apply` automatically.
 */

import * as esbuild from "esbuild";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync } from "child_process";

function getSpicetifyExtDir(): string {
  switch (os.platform()) {
    case "win32":
      return path.join(os.homedir(), "AppData", "Roaming", "spicetify", "Extensions");
    case "darwin":
      return path.join(os.homedir(), ".config", "spicetify", "Extensions");
    default:
      return path.join(os.homedir(), ".config", "spicetify", "Extensions");
  }
}

const spicetifyExtDir = getSpicetifyExtDir();

const outFile = path.join(spicetifyExtDir, "add-new-by-artist.js");

if (!fs.existsSync(spicetifyExtDir)) {
  fs.mkdirSync(spicetifyExtDir, { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: ["src/app.tsx"],
  bundle: true,
  outfile: outFile,
  format: "iife",
  define: { "process.env.NODE_ENV": '"development"' },
  minify: false,
  sourcemap: "inline",
  target: "es2020",
  jsx: "transform",
  jsxFactory: "Spicetify.React.createElement",
  jsxFragment: "Spicetify.React.Fragment",
  logLevel: "info",
  plugins: [
    {
      name: "on-rebuild",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            console.log(`[${new Date().toLocaleTimeString()}] Rebuilt → ${outFile}`);
            try {
              execSync("spicetify apply", { stdio: "inherit" });
            } catch {
              console.warn("spicetify apply failed — reload Spotify manually.");
            }
          }
        });
      },
    },
  ],
});

await ctx.watch();
console.log("👀 Watching for changes…");
