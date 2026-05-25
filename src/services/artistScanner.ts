/**
 * Fetches all "original" tracks for an artist using Spicetify.GraphQL.
 *
 * Uses the same GraphQL endpoint Spotify's own artist page uses — no Web API,
 * no rate limits.
 *
 * Flow:
 *   1. queryArtistDiscographyAll  → paginated list of album + single releases
 *      (each release may include tracks inline; if not, fetch with getAlbum)
 *   2. Dedup albums by canonical name (Clean/Explicit/Deluxe variants)
 *   3. Keep only tracks where this artist is PRIMARY
 *   4. Remove remix/live/extended variants
 *   5. Deduplicate tracks by canonical name — keep earliest release
 */

import { canonicalName, isVariant } from "../utils/trackNormalizer";
import { SpotifyArtistRef, SpotifyTrack } from "./spotifyApi";
import { withTimeout } from "../utils/withTimeout";

export interface ArtistTrack extends SpotifyTrack {
  albumName: string;
  releaseDate: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function getArtistOriginalTracks(artistId: string): Promise<ArtistTrack[]> {
  const s = Spicetify as any;
  const defs = s.GraphQL?.Definitions;
  if (!defs) throw new Error("Spicetify.GraphQL not available");

  const discoDef = defs["queryArtistDiscographyAll"];
  if (!discoDef) throw new Error("GraphQL definition 'queryArtistDiscographyAll' not found");

  const albumDef  = defs["getAlbum"];          // fallback per-album fetch
  const artistUri = `spotify:artist:${artistId}`;
  const LIMIT     = 100;

  // ── Step 1: Fetch all releases (paginated) ────────────────────────────────
  const allGroupItems: any[] = [];
  let offset = 0;

  while (true) {
    const result = await withTimeout(
      s.GraphQL.Request(discoDef, { uri: artistUri, offset, limit: LIMIT }),
      20_000, "queryArtistDiscographyAll"
    );

    const section = result?.data?.artistUnion?.discography?.all;
    const items: any[] = section?.items ?? [];
    allGroupItems.push(...items);

    const total: number = section?.totalCount ?? 0;
    if (allGroupItems.length >= total || items.length < LIMIT) break;
    offset += items.length;
  }

  console.log(`[AddNewByArtist] queryArtistDiscographyAll: ${allGroupItems.length} release groups`);

  // Flatten groups → individual releases
  // Each group item has a `releases.items` array (handles Clean+Explicit twins etc.)
  const releases: Array<{
    uri: string;
    name: string;
    date: string;
    tracks: any[];
  }> = [];

  for (const group of allGroupItems) {
    for (const rel of group?.releases?.items ?? []) {
      const uri: string      = rel?.uri ?? "";
      const name: string     = rel?.name ?? "";
      const dateIso: string  =
        rel?.date?.isoString ??
        `${rel?.date?.year ?? "0000"}-${String(rel?.date?.month ?? 1).padStart(2, "0")}-${String(rel?.date?.day ?? 1).padStart(2, "0")}`;
      const trackItems: any[] = rel?.tracks?.items ?? [];

      releases.push({ uri, name, date: dateIso, tracks: trackItems });
    }
  }

  console.log(`[AddNewByArtist] Total releases (before dedup): ${releases.length}`);

  // ── Step 2: Sort + deduplicate album names ────────────────────────────────
  releases.sort((a, b) => a.date.localeCompare(b.date));

  const seenAlbum = new Set<string>();
  const dedupedReleases = releases.filter((r) => {
    const cn = canonicalName(r.name);
    if (seenAlbum.has(cn)) return false;
    seenAlbum.add(cn);
    return true;
  });
  console.log(`[AddNewByArtist] After album dedup: ${dedupedReleases.length} releases`);

  // ── Step 3: Fill in tracks that weren't included inline ───────────────────
  // The discography query sometimes omits track data to save bandwidth.
  // When tracks array is empty, fall back to getAlbum for that release.
  for (const rel of dedupedReleases) {
    if (rel.tracks.length > 0) continue; // already have tracks
    if (!albumDef || !rel.uri.startsWith("spotify:album:")) continue;

    try {
      const albumResult = await withTimeout(
        s.GraphQL.Request(albumDef, { uri: rel.uri, locale: "", offset: 0, limit: 300 }),
        20_000, `getAlbum(${rel.name})`
      );

      // tracksV2 is the current field name in Spotify's GraphQL schema;
      // tracks is kept as a fallback for older schema versions.
      rel.tracks =
        albumResult?.data?.albumUnion?.tracksV2?.items ??
        albumResult?.data?.albumUnion?.tracks?.items ??
        [];
    } catch (e) {
      console.warn(`[AddNewByArtist] getAlbum failed for ${rel.uri}:`, e);
    }
  }

  // ── Step 4: Extract ArtistTrack objects ───────────────────────────────────
  const allTracks: ArtistTrack[] = [];

  for (const rel of dedupedReleases) {
    for (const trackItem of rel.tracks) {
      // GraphQL wraps tracks in { uid, track: { ... } }
      const t = trackItem?.track ?? trackItem;
      const uri: string = t?.uri ?? "";
      if (!uri.startsWith("spotify:track:")) continue;

      const id = uri.split(":").pop() ?? "";
      if (!id) continue;

      // Artists shape: { items: [{ uri, profile: { name } }] }
      const rawArtists: any[] = t?.artists?.items ?? t?.artists ?? [];
      const artists: SpotifyArtistRef[] = rawArtists.map((a: any) => ({
        id: a?.id ?? (a?.uri ?? "").split(":").pop() ?? "",
        name: a?.profile?.name ?? a?.name ?? "",
      }));

      allTracks.push({
        id,
        uri,
        name: t?.name ?? "",
        artists,
        duration_ms: t?.duration?.totalMilliseconds ?? t?.duration_ms ?? 0,
        albumName: rel.name,
        releaseDate: rel.date,
      });
    }
  }

  console.log(`[AddNewByArtist] Total raw tracks: ${allTracks.length}`);

  // ── Step 5: Keep only tracks where this artist is PRIMARY ─────────────────
  const byArtist = allTracks.filter((t) => t.artists[0]?.id === artistId);
  console.log(`[AddNewByArtist] Tracks where artist is primary: ${byArtist.length}`);

  // ── Step 6: Remove remix/live/extended variants ───────────────────────────
  const noVariants = byArtist.filter((t) => !isVariant(t.name));
  console.log(`[AddNewByArtist] After removing variants: ${noVariants.length} (removed ${byArtist.length - noVariants.length})`);

  // ── Step 7: Deduplicate by canonical name — keep earliest release ─────────
  const seen = new Set<string>();
  const originals: ArtistTrack[] = [];
  for (const track of noVariants) {
    const key = canonicalName(track.name);
    if (!seen.has(key)) {
      seen.add(key);
      originals.push(track);
    }
  }
  console.log(`[AddNewByArtist] Final: ${originals.length} unique original tracks`);

  return originals;
}
