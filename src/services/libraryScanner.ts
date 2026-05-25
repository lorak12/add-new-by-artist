/**
 * Library scanner — uses Spicetify internal Platform APIs (no Web API, no rate limits).
 *
 * Data sources:
 *   Liked songs   → Spicetify.Platform.LibraryAPI.getTracks()
 *   Owned playlists → Spicetify.Platform.RootlistAPI.getContents()  (filtered to owned)
 *   Playlist tracks → Spicetify.Platform.PlaylistAPI.getContents()
 *
 * Cache strategy (localStorage, 30-min TTL):
 *   1. Load index from localStorage immediately → instant first render
 *   2. If cache is fresh (< 30 min old), skip the refresh
 *   3. Otherwise do a full re-fetch — all three internal API sources
 *   4. Save updated index back to localStorage
 *
 * Since internal APIs have no rate limits, incremental snapshot comparison
 * is no longer needed. A simple TTL is sufficient.
 *
 * Storage format (compact strings, schema v3):
 *   "add-new:lib" = {
 *     v: 3,
 *     at: <unix ms>,
 *     likedIds: "id1,id2,...",
 *     likedCanonicals: "canon1\ncanon2\n...",
 *     playlists: [{ id, name, owner: { id }, tIds: "id1,…", tCan: "c1\n…" }],
 *   }
 */

import { canonicalName } from "../utils/trackNormalizer";
import { SpotifyPlaylist } from "./spotifyApi";
import { lsGet, lsSet, lsDel } from "./localStore";
import { withTimeout } from "../utils/withTimeout";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LibraryIndex {
  canonicals: Set<string>;
  ids: Set<string>;
  playlists: SpotifyPlaylist[];
  size: number;
  fromCache: boolean;
}

interface StoredPlaylist {
  id: string;
  name: string;
  owner: { id: string };
  tIds: string;   // comma-joined track IDs
  tCan: string;   // newline-joined canonical names
}

interface StoredLib {
  v: number;
  at: number;
  likedIds: string;          // comma-joined
  likedCanonicals: string;   // newline-joined
  playlists: StoredPlaylist[];
}

const STORE_KEY = "lib";
const SCHEMA_VERSION = 3;
const CACHE_TTL_MIN = 30;

// ─── Module state ─────────────────────────────────────────────────────────────

let _index: LibraryIndex | null = null;
let _scanPromise: Promise<LibraryIndex> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Kicks off a background library scan.
 * Call once on extension init — safe to call multiple times (no-op if running).
 */
export function startBackgroundScan(): void {
  if (_scanPromise) return;
  _scanPromise = runScan()
    .then((idx) => { _index = idx; return idx; })
    .catch((e) => {
      console.error("[AddNewByArtist] Background library scan failed:", e);
      _scanPromise = null; // allow retry on next button click
      throw e;
    });
}

/**
 * Returns the library index. If the background scan is still running,
 * waits for it. If no scan has started yet, starts one first.
 */
export async function waitForLibrary(): Promise<LibraryIndex> {
  if (_index) return _index;
  if (!_scanPromise) startBackgroundScan();
  return _scanPromise!;
}

/**
 * Invalidates the in-memory index.
 * Pass `force = true` after the user knowingly mutates their library (e.g. adds
 * tracks via the extension) — this also wipes the localStorage entry so the
 * 30-min TTL doesn't serve stale data on the very next scan.
 */
export function invalidateLibraryCache(force = false): void {
  _index = null;
  _scanPromise = null;
  if (force) lsDel(STORE_KEY); // wipe persistent cache so next scan fetches fresh
}

/** Is a library index already loaded (cache hit)? */
export function isLibraryReady(): boolean {
  return _index !== null;
}

export function isInLibrary(trackName: string, trackId: string, index: LibraryIndex): boolean {
  return index.ids.has(trackId) || index.canonicals.has(canonicalName(trackName));
}

// ─── Scan logic ───────────────────────────────────────────────────────────────

async function runScan(): Promise<LibraryIndex> {
  // Step 1: load whatever we have cached — makes second-and-beyond clicks instant
  const stored = loadFromStorage();
  if (stored) {
    const ageMin = Math.round((Date.now() - stored._at) / 60000);
    console.log(`[AddNewByArtist] Cache loaded: ${stored.size} tracks, age ${ageMin} min`);
    _index = stored;

    // Cache is fresh — skip re-fetch entirely
    if (ageMin < CACHE_TTL_MIN) {
      console.log(`[AddNewByArtist] Cache is fresh (${ageMin} min < ${CACHE_TTL_MIN} min TTL), skipping refresh`);
      return stored;
    }
    console.log(`[AddNewByArtist] Cache stale (${ageMin} min), refreshing via internal APIs…`);
  }

  // Step 2: full refresh via Spicetify internal APIs
  try {
    const fresh = await fullRefresh();
    saveToStorage(fresh);
    console.log(`[AddNewByArtist] Library refreshed: ${fresh.size} tracks`);
    return fresh;
  } catch (e) {
    // If internal APIs fail for some reason, use stale cache rather than hard-failing
    if (stored) {
      console.warn("[AddNewByArtist] Internal API unavailable, using stale cache:", e);
      return stored;
    }
    throw e;
  }
}

// ─── Internal type augment ────────────────────────────────────────────────────

interface StoredExtra {
  _likedIds: string;
  _likedCanonicals: string;
  _storedPlaylists: StoredPlaylist[];
  _at: number;
}

// ─── Full refresh via Spicetify internal APIs ─────────────────────────────────

async function fullRefresh(): Promise<LibraryIndex & StoredExtra> {
  const s = Spicetify as any;

  // 1. Liked songs
  console.log("[AddNewByArtist] Fetching liked songs…");
  const likedTracks = await withTimeout(
    fetchLikedTracksInternal(s), 30_000, "LibraryAPI.getTracks"
  );
  console.log(`[AddNewByArtist] Got ${likedTracks.length} liked songs`);

  // 2. Owned playlists list
  console.log("[AddNewByArtist] Fetching owned playlists…");
  const ownedPlaylists = await withTimeout(
    fetchOwnedPlaylistsInternal(s), 30_000, "RootlistAPI.getContents"
  );
  console.log(`[AddNewByArtist] Got ${ownedPlaylists.length} owned playlists — scanning tracks…`);

  // 3. Build index
  const ids = new Set<string>();
  const canonicals = new Set<string>();

  likedTracks.forEach((t) => {
    ids.add(t.id);
    canonicals.add(canonicalName(t.name));
  });

  const likedIds = likedTracks.map((t) => t.id).join(",");
  const likedCanonicals = likedTracks.map((t) => canonicalName(t.name)).join("\n");

  const storedPlaylists: StoredPlaylist[] = [];
  let playlistTrackTotal = 0;

  for (const playlist of ownedPlaylists) {
    const tracks = await withTimeout(
      fetchPlaylistTracksInternal(s, `spotify:playlist:${playlist.id}`),
      20_000,
      `PlaylistAPI.getContents(${playlist.name})`
    );
    playlistTrackTotal += tracks.length;
    tracks.forEach((t) => {
      ids.add(t.id);
      canonicals.add(canonicalName(t.name));
    });
    storedPlaylists.push({
      id: playlist.id,
      name: playlist.name,
      owner: { id: playlist.ownerId },
      tIds: tracks.map((t) => t.id).join(","),
      tCan: tracks.map((t) => canonicalName(t.name)).join("\n"),
    });
  }
  console.log(`[AddNewByArtist] Playlist scan done: ${playlistTrackTotal} tracks across ${ownedPlaylists.length} playlists`);

  return {
    canonicals,
    ids,
    playlists: ownedPlaylists.map((p) => ({ id: p.id, name: p.name, owner: { id: p.ownerId } })),
    size: ids.size,
    fromCache: false,
    _likedIds: likedIds,
    _likedCanonicals: likedCanonicals,
    _storedPlaylists: storedPlaylists,
    _at: Date.now(),
  };
}

// ─── Spicetify internal API wrappers ─────────────────────────────────────────

/** Fetch all liked/saved tracks via Spicetify.Platform.LibraryAPI */
async function fetchLikedTracksInternal(s: any): Promise<Array<{ id: string; name: string }>> {
  const LibraryAPI = s.Platform?.LibraryAPI;
  if (!LibraryAPI) throw new Error("Spicetify.Platform.LibraryAPI not available");

  const results: Array<{ id: string; name: string }> = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const page = await LibraryAPI.getTracks({ limit, offset });
    const items: any[] = page?.items ?? [];

    for (const item of items) {
      const uri: string = item?.uri ?? "";
      if (!uri.startsWith("spotify:track:")) continue;
      const id = uri.split(":").pop() ?? "";
      const name: string = item?.name ?? "";
      if (id && name) results.push({ id, name });
    }

    if (!page?.hasNextPage || items.length === 0) break;
    offset += items.length;
  }

  return results;
}

/**
 * Resolves the current user's Spotify ID using only internal sources.
 * Tries four different Spicetify APIs in order; logs what it found.
 * Returns "" if nothing works (caller must handle gracefully).
 */
async function resolveCurrentUserId(s: any): Promise<string> {
  // 1. CosmosAsync internal identity endpoint — most reliable, no Web API
  try {
    const identity = await s.CosmosAsync?.get?.("sp://core-identity/v1/me");
    if (identity?.username) {
      console.log(`[AddNewByArtist] User ID from CosmosAsync identity: ${identity.username}`);
      return identity.username;
    }
  } catch { /* try next */ }

  // 2. Various Platform.Session property names (differs across Spicetify versions)
  const sessionCandidates = [
    s.Platform?.Session?.username,
    s.Platform?.Session?.userId,
    s.Platform?.Session?.user_id,
    s.Platform?.AccountInfo?.username,
    s.Platform?.User?.username,
    s.Platform?.User?.id,
  ];
  for (const c of sessionCandidates) {
    if (typeof c === "string" && c.length > 0) {
      console.log(`[AddNewByArtist] User ID from Platform session: ${c}`);
      return c;
    }
  }

  // 3. Scan Platform.Session for anything that looks like a user ID.
  //    Real Spotify user IDs are alphanumeric, 8–30 chars, no spaces/dots.
  //    Exclude known non-ID keys (tokenType, accessToken, etc.)
  const SKIP_KEYS = new Set(["tokentype", "token", "type", "accesstoken", "tokenexpiry", "scope"]);
  const session = s.Platform?.Session ?? {};
  for (const k of Object.keys(session)) {
    if (SKIP_KEYS.has(k.toLowerCase())) continue;
    const v = session[k];
    if (
      typeof v === "string" &&
      v.length >= 8 && v.length < 60 &&
      !v.startsWith("BQ") &&
      !v.includes(" ") &&
      !v.includes(".") &&
      /^[A-Za-z0-9_-]+$/.test(v)
    ) {
      console.log(`[AddNewByArtist] User ID from session key "${k}": ${v}`);
      return v;
    }
  }

  console.warn("[AddNewByArtist] Could not resolve user ID from any internal source — will include all playlists");
  return "";
}

/** Fetch all owned playlists via Spicetify.Platform.RootlistAPI */
async function fetchOwnedPlaylistsInternal(
  s: any
): Promise<Array<{ id: string; name: string; ownerId: string }>> {
  const RootlistAPI = s.Platform?.RootlistAPI;
  if (!RootlistAPI) throw new Error("Spicetify.Platform.RootlistAPI not available");

  const myId = await resolveCurrentUserId(s);

  const result = await RootlistAPI.getContents();
  const items: any[] = result?.items ?? [];

  const playlists: Array<{ id: string; name: string; ownerId: string }> = [];

  for (const item of items) {
    const uri: string = item?.uri ?? "";
    if (!uri.startsWith("spotify:playlist:")) continue;

    const id = uri.split(":").pop() ?? "";
    const name: string = item?.name ?? "";
    if (!id || !name) continue;

    // Prefer direct isOwnedBySelf flag if the API exposes it
    if (typeof item.isOwnedBySelf === "boolean") {
      if (item.isOwnedBySelf) playlists.push({ id, name, ownerId: myId });
      continue;
    }

    // Fall back to owner URI comparison when we have a user ID
    if (myId) {
      const ownerUri: string =
        (typeof item.owner === "object" ? item.owner?.uri : item.owner) ?? "";
      const ownerId = ownerUri.split(":").pop() ?? "";
      if (ownerId === myId) playlists.push({ id, name, ownerId });
      continue;
    }

    // Last resort: no user ID available — include all playlists rather than
    // returning nothing. Followed playlists in the index doesn't hurt correctness.
    playlists.push({ id, name, ownerId: "" });
  }

  console.log(`[AddNewByArtist] Owned playlists found: ${playlists.length} of ${items.filter((i: any) => i?.uri?.startsWith("spotify:playlist:")).length} total`);
  return playlists;
}

/** Fetch all tracks for a playlist via Spicetify.Platform.PlaylistAPI */
async function fetchPlaylistTracksInternal(
  s: any,
  playlistUri: string
): Promise<Array<{ id: string; name: string }>> {
  const PlaylistAPI = s.Platform?.PlaylistAPI;
  if (!PlaylistAPI) throw new Error("Spicetify.Platform.PlaylistAPI not available");

  const results: Array<{ id: string; name: string }> = [];

  // getContents may accept either (uri) or ({ uri }) depending on Spicetify version
  let data: any;
  try {
    data = await PlaylistAPI.getContents({ uri: playlistUri });
  } catch {
    data = await PlaylistAPI.getContents(playlistUri);
  }

  const items: any[] = data?.items ?? [];

  for (const item of items) {
    // Item shape varies: may have .uri directly or wrapped in .track
    const uri: string = item?.uri ?? item?.track?.uri ?? "";
    if (!uri.startsWith("spotify:track:")) continue;
    const id = uri.split(":").pop() ?? "";
    const name: string = item?.name ?? item?.track?.name ?? "";
    if (id && name) results.push({ id, name });
  }

  return results;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadFromStorage(): (LibraryIndex & StoredExtra) | null {
  const raw = lsGet<StoredLib>(STORE_KEY);
  if (!raw || raw.v !== SCHEMA_VERSION) return null;

  const ids = new Set(raw.likedIds ? raw.likedIds.split(",").filter(Boolean) : []);
  const canonicals = new Set(raw.likedCanonicals ? raw.likedCanonicals.split("\n").filter(Boolean) : []);

  for (const p of raw.playlists ?? []) {
    p.tIds?.split(",").filter(Boolean).forEach((id) => ids.add(id));
    p.tCan?.split("\n").filter(Boolean).forEach((c) => canonicals.add(c));
  }

  return {
    canonicals,
    ids,
    playlists: raw.playlists.map((p) => ({ id: p.id, name: p.name, owner: p.owner })),
    size: ids.size,
    fromCache: true,
    _likedIds: raw.likedIds,
    _likedCanonicals: raw.likedCanonicals,
    _storedPlaylists: raw.playlists,
    _at: raw.at,
  };
}

function saveToStorage(index: LibraryIndex & StoredExtra): void {
  const raw: StoredLib = {
    v: SCHEMA_VERSION,
    at: index._at,
    likedIds: index._likedIds,
    likedCanonicals: index._likedCanonicals,
    playlists: index._storedPlaylists,
  };
  lsSet(STORE_KEY, raw);
}
