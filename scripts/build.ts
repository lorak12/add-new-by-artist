/**
 * Build script — bundles the extension into a single .js file
 * and copies it to the Spicetify Extensions folder.
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
      // Spicetify on macOS defaults to ~/.config/spicetify or ~/spicetify_data
      return path.join(os.homedir(), ".config", "spicetify", "Extensions");
    default:
      // Linux
      return path.join(os.homedir(), ".config", "spicetify", "Extensions");
  }
}

const spicetifyExtDir = getSpicetifyExtDir();

const outFile = path.join(spicetifyExtDir, "add-new-by-artist.js");

// Ensure Extensions dir exists
if (!fs.existsSync(spicetifyExtDir)) {
  fs.mkdirSync(spicetifyExtDir, { recursive: true });
}

await esbuild.build({
  entryPoints: ["src/app.tsx"],
  bundle: true,
  outfile: outFile,
  format: "iife",
  globalName: "AddNewByArtist",
  // Spicetify exposes React, ReactDOM etc. as globals — don't bundle them
  external: [],
  banner: {
    js: `
// @name         Add New by Artist
// @version      1.0.0
// @description  Find missing songs from an artist and add them to your library
// @author       slawek-spotify
`,
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: false, // Keep readable for debugging
  sourcemap: "inline",
  target: "es2020",
  jsx: "transform",
  jsxFactory: "Spicetify.React.createElement",
  jsxFragment: "Spicetify.React.Fragment",
  logLevel: "info",
});

console.log(`\n✅ Built → ${outFile}`);

console.log("\n⚙️  Running spicetify apply…");
try {
  execSync("spicetify apply", { stdio: "inherit" });
  console.log("✅ spicetify apply done\n");
} catch {
  console.warn("⚠️  spicetify apply failed — reload Spotify manually.\n");
}
