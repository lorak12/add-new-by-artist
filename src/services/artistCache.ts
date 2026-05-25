/**
 * Per-artist scan result cache.
 *
 * Each entry stores the list of missing tracks found for a specific artist,
 * tagged with the library size at the time of the scan.
 *
 * Invalidation rule: if the library size changed (tracks added OR removed)
 * since the last scan, or the entry is older than 24 hours, it is discarded.
 *
 * Storage key: "add-new:a:{artistId}"
 * Storage format (compact):
 *   at  = timestamp
 *   s   = library size when scanned
 *   u   = comma-separated track URIs
 *   t   = ||-separated track names
 *   al  = ||-separated album names
 *   rd  = ||-separated release dates
 *   ids = comma-separated track IDs
 *   aid = artist ID
 *   an  = artist display name  (added in v3)
 */

import { lsGet, lsSet, lsDel } from "./localStore";

/** Artist cache entries older than this are always discarded. */
const ARTIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Bump this when the stored format changes or when we need to bust stale entries
 * that were written by a broken version of the scanner.
 */
const ARTIST_CACHE_VERSION = 3;

export interface CachedArtistTracks {
  uri: string;
  name: string;
  albumName: string;
  releaseDate: string;
  id: string;
  artists: { id: string; name: string }[];
  duration_ms: number;
}

interface StoredArtist {
  v: number;     // schema version — entries without this or with lower version are discarded
  at: number;    // timestamp
  s: number;     // library size at scan time
  u: string;     // comma-separated URIs
  t: string;     // ||-separated names
  al: string;    // ||-separated album names
  rd: string;    // ||-separated release dates
  ids: string;   // comma-separated track IDs
  aid: string;   // artist ID
  an: string;    // artist display name (v3+)
}

function key(artistId: string): string {
  return `a:${artistId}`;
}

/** Returns cached missing tracks for an artist, or null if cache is stale/missing. */
export function getArtistCache(
  artistId: string,
  currentLibrarySize: number
): CachedArtistTracks[] | null {
  const raw = lsGet<StoredArtist>(key(artistId));
  if (!raw) return null;

  // Discard entries written by an older/broken version of the scanner.
  if (!raw.v || raw.v < ARTIST_CACHE_VERSION) {
    console.log(`[AddNewByArtist] Artist cache version mismatch for ${artistId} — discarding`);
    lsDel(key(artistId));
    return null;
  }

  // Discard entries that are too old regardless of library size.
  if (Date.now() - raw.at > ARTIST_CACHE_TTL_MS) {
    console.log(`[AddNewByArtist] Artist cache expired for ${artistId}`);
    lsDel(key(artistId));
    return null;
  }

  // Invalidate if library size changed in either direction.
  // Growing means new songs may cover previously-missing tracks.
  // Shrinking means removed songs may now be missing again.
  if (currentLibrarySize !== raw.s) {
    console.log(
      `[AddNewByArtist] Artist cache invalid for ${artistId}: library size changed ${raw.s} → ${currentLibrarySize}`
    );
    return null;
  }

  const uris = raw.u ? raw.u.split(",") : [];
  const names = raw.t ? raw.t.split("||") : [];
  const albums = raw.al ? raw.al.split("||") : [];
  const dates = raw.rd ? raw.rd.split("||") : [];
  const ids = raw.ids ? raw.ids.split(",") : [];

  return uris.map((uri, i) => ({
    uri,
    id: ids[i] ?? uri.split(":")[2] ?? "",
    name: names[i] ?? "",
    albumName: albums[i] ?? "",
    releaseDate: dates[i] ?? "",
    artists: [{ id: raw.aid, name: raw.an ?? "" }],
    duration_ms: 0,
  }));
}

/** Saves missing tracks for an artist to the cache. */
export function setArtistCache(
  artistId: string,
  artistName: string,
  missingTracks: CachedArtistTracks[],
  librarySize: number
): void {
  const stored: StoredArtist = {
    v: ARTIST_CACHE_VERSION,
    at: Date.now(),
    s: librarySize,
    u: missingTracks.map((t) => t.uri).join(","),
    t: missingTracks.map((t) => t.name).join("||"),
    al: missingTracks.map((t) => t.albumName).join("||"),
    rd: missingTracks.map((t) => t.releaseDate).join("||"),
    ids: missingTracks.map((t) => t.id).join(","),
    aid: artistId,
    an: artistName,
  };
  lsSet(key(artistId), stored);
}

/** Removes the cached result for a specific artist. */
export function clearArtistCache(artistId: string): void {
  lsDel(key(artistId));
}
