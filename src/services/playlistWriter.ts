/**
 * Writes tracks to either an existing playlist or a newly created one.
 *
 * Uses Spicetify internal Platform APIs (no Web API, no rate limits).
 * Falls back to Web API only if both internal strategies fail.
 *
 * Add tracks:   Platform.PlaylistAPI.add()
 * Create:       Platform.RootlistAPI.createPlaylist()
 */

import { createPlaylist as createPlaylistWebApi, addTracksToPlaylist as addTracksWebApi } from "./spotifyApi";

export interface Destination {
  type: "existing" | "new";
  /** Used when type === "existing" */
  id?: string;
  /** Used when type === "new" */
  name?: string;
}

export async function writeTracks(
  trackUris: string[],
  destination: Destination
): Promise<void> {
  if (trackUris.length === 0) {
    Spicetify.showNotification("No tracks to add.");
    return;
  }

  let playlistId: string;

  if (destination.type === "new") {
    if (!destination.name?.trim()) throw new Error("Playlist name is required");
    playlistId = await createPlaylistInternal(destination.name.trim());
  } else {
    if (!destination.id) throw new Error("Playlist ID is required");
    playlistId = destination.id;
  }

  await addTracksInternal(playlistId, trackUris);

  Spicetify.showNotification(
    `✅ Added ${trackUris.length} track${trackUris.length !== 1 ? "s" : ""}!`
  );
}

// ─── Internal: add tracks ─────────────────────────────────────────────────────

async function addTracksInternal(playlistId: string, trackUris: string[]): Promise<void> {
  const s = Spicetify as any;
  const playlistUri = `spotify:playlist:${playlistId}`;
  const api = s.Platform?.PlaylistAPI;

  // Strategy 1: Platform.PlaylistAPI.add(uri, uris[], options)
  // This is the internal method Spotify's own client uses to append tracks.
  if (typeof api?.add === "function") {
    try {
      console.log(`[AddNewByArtist] Adding ${trackUris.length} tracks via PlaylistAPI.add…`);
      // Add in batches of 100 to match playlist size constraints
      for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        await api.add(playlistUri, batch, { after: { uid: "" } });
      }
      return;
    } catch (e) {
      console.warn("[AddNewByArtist] PlaylistAPI.add failed, trying fallback:", e);
    }
  }

  // Strategy 2: Web API (may 429, but included as last resort)
  console.warn("[AddNewByArtist] Falling back to Web API for track add");
  await addTracksWebApi(playlistId, trackUris);
}

// ─── Internal: create playlist ────────────────────────────────────────────────

async function createPlaylistInternal(name: string): Promise<string> {
  const s = Spicetify as any;

  // Strategy 1: Platform.RootlistAPI.createPlaylist(name, options)
  if (typeof s.Platform?.RootlistAPI?.createPlaylist === "function") {
    try {
      console.log(`[AddNewByArtist] Creating playlist "${name}" via RootlistAPI…`);
      const result = await s.Platform.RootlistAPI.createPlaylist(name, { after: "" });
      // Result can be a URI string or an object with a uri/id property
      const raw: string =
        typeof result === "string"
          ? result
          : result?.uri ?? result?.id ?? result?.playlist?.uri ?? "";
      const id = raw.startsWith("spotify:playlist:")
        ? raw.split(":")[2]
        : raw;
      if (id) {
        console.log(`[AddNewByArtist] Created playlist: ${id}`);
        return id;
      }
      console.warn("[AddNewByArtist] RootlistAPI.createPlaylist returned unexpected value:", result);
    } catch (e) {
      console.warn("[AddNewByArtist] RootlistAPI.createPlaylist failed, trying fallback:", e);
    }
  }

  // Strategy 2: Web API (requires getMe() which may 429)
  console.warn("[AddNewByArtist] Falling back to Web API for playlist creation");
  return createPlaylistWebApi(name);
}
