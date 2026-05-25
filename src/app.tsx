/**
 * Add New by Artist — Spicetify Extension
 *
 * Injection strategy: when an artist page is detected, attempt to inject
 * the button at 0 / 300 / 800 / 1500 / 3000 ms. Each attempt checks
 * whether the button is already present before doing anything.
 * A 1-second poll keeps it alive across Spotify re-renders.
 */

import { AddNewButton } from "./components/AddNewButton";
import { startBackgroundScan } from "./services/libraryScanner";

const STYLES = `
  @keyframes add-new-spin {
    to { transform: rotate(360deg); }
  }
  #add-new-by-artist-mount { display: contents; }
  #add-new-modal-portal label:hover {
    background: var(--background-tinted-highlight, rgba(255,255,255,0.07));
  }
  #add-new-modal-portal { position: relative; z-index: 9999; }
`;

// From the actual Spotify DOM:
//   <div class="main-actionBar-ActionBar contentSpacing">
//     <div class="main-actionBar-ActionBarRow"> ← inject here
const ACTION_BAR_SELECTORS = [
  ".main-actionBar-ActionBarRow",
  ".main-actionBar-ActionBar .main-actionBar-ActionBarRow",
  "[data-testid='action-bar-row']",
];

// ─── Mount tracking ───────────────────────────────────────────────────────────

let mountedArtistId: string | null = null;
let mountedRoot: { unmount(): void } | null = null;
let mountedContainer: HTMLElement | null = null;

function cleanup() {
  try { mountedRoot?.unmount(); } catch { /* ignore */ }
  mountedContainer?.remove();
  mountedRoot = null;
  mountedContainer = null;
  mountedArtistId = null;
}

// ─── Single inject attempt ────────────────────────────────────────────────────

function tryInject(artistId: string): boolean {
  if (document.getElementById("add-new-by-artist-mount")) return true; // already there

  // Find the action bar row
  let actionBarRow: Element | null = null;
  for (const sel of ACTION_BAR_SELECTORS) {
    actionBarRow = document.querySelector(sel);
    if (actionBarRow) break;
  }

  if (!actionBarRow) return false;

  // ── Artist name ────────────────────────────────────────────────────────────
  // The page wraps in <section data-test-uri="spotify:artist:ID">.
  // The h1 is in <span class="main-entityHeader-title"><h1>Name</h1></span>
  // which is a sibling of the action bar, not a parent — so we search broadly.
  //
  // Fallback: shuffle button aria-label is always "ArtistName: <localised action>"
  const shuffleLabel =
    actionBarRow.querySelector("button[aria-label*=':']:not([aria-haspopup])")
      ?.getAttribute("aria-label") ?? "";
  const nameFromShuffle = shuffleLabel.split(":")[0].trim();

  const artistName =
    document.querySelector(".main-entityHeader-title h1")?.textContent?.trim() ||
    document.querySelector(".main-entityHeader-title")?.textContent?.trim() ||
    document.querySelector("[data-testid='entityTitle']")?.textContent?.trim() ||
    nameFromShuffle ||
    artistId;

  console.log(`[AddNewByArtist] Injecting for: ${artistName} (${artistId})`);

  // ── Insert container just before the "…" more-options button ──────────────
  const moreOptionsBtn = actionBarRow.querySelector("button[aria-haspopup='menu']");

  const container = document.createElement("div");
  container.id = "add-new-by-artist-mount";
  container.style.display = "contents";
  moreOptionsBtn
    ? actionBarRow.insertBefore(container, moreOptionsBtn)
    : actionBarRow.appendChild(container);

  // ── Render ─────────────────────────────────────────────────────────────────
  const RD = (Spicetify as any).ReactDOM;
  if (!RD) {
    console.warn("[AddNewByArtist] Spicetify.ReactDOM not available");
    container.remove();
    return false;
  }

  const element = <AddNewButton artistId={artistId} artistName={artistName} />;

  if (typeof RD.createRoot === "function") {
    const root = RD.createRoot(container);
    root.render(element);
    mountedRoot = root;
  } else if (typeof RD.render === "function") {
    RD.render(element, container);
    mountedRoot = { unmount: () => RD.unmountComponentAtNode?.(container) };
  } else {
    console.warn("[AddNewByArtist] No ReactDOM render method found");
    container.remove();
    return false;
  }

  mountedContainer = container;
  mountedArtistId = artistId;
  return true;
}

// ─── Burst inject on navigation ───────────────────────────────────────────────

const RETRY_DELAYS = [0, 300, 800, 1500, 3000];

function burstInject(artistId: string) {
  console.log(`[AddNewByArtist] burstInject triggered for ${artistId}`);
  RETRY_DELAYS.forEach((delay) => {
    setTimeout(() => {
      const m = getPathname().match(/^\/artist\/([A-Za-z0-9]+)/);
      if (!m || m[1] !== artistId) return;
      tryInject(artistId);
    }, delay);
  });
}

// ─── 1-second safety-net poll ─────────────────────────────────────────────────

let lastArtistId: string | null = null;

function getPathname(): string {
  // Spotify desktop is an Electron app — window.location.pathname is always
  // a static app path. The actual in-app navigation lives in Spicetify's History.
  const history = (Spicetify as any).Platform?.History ?? (Spicetify as any).Platform?.history;
  return history?.location?.pathname ?? window.location.pathname;
}

function tick() {
  const m = getPathname().match(/^\/artist\/([A-Za-z0-9]+)/);

  if (!m) {
    if (mountedContainer) cleanup();
    lastArtistId = null;
    return;
  }

  const artistId = m[1];

  if (artistId !== lastArtistId) {
    if (mountedContainer) cleanup();
    lastArtistId = artistId;
    burstInject(artistId);
    return;
  }

  if (!document.getElementById("add-new-by-artist-mount")) {
    tryInject(artistId);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  while (!(Spicetify as any)?.Platform?.history && !(Spicetify as any)?.Platform?.History) {
    await new Promise((r) => setTimeout(r, 100));
  }
  while (!Spicetify?.React || !Spicetify?.ReactDOM) {
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("[AddNewByArtist] Extension ready");

  if (!document.getElementById("add-new-by-artist-styles")) {
    const style = document.createElement("style");
    style.id = "add-new-by-artist-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    console.log("[AddNewByArtist] Starting background library scan…");
    startBackgroundScan();
  }, 15_000);

  setInterval(tick, 1000);
  tick();
}

main();
