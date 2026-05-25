/**
 * Spotify API helpers — WRITE operations only.
 *
 * Read operations (library, artist discography) now use Spicetify's
 * internal Platform/CosmosAsync APIs in libraryScanner.ts and artistScanner.ts.
 * Those bypass the public Web API entirely → no rate limits.
 *
 * Token is still needed for playlist writes (POST /v1/playlists/…).
 */

const BASE = "https://api.spotify.com/v1";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotifyArtistRef { id: string; name: string; }
export interface SpotifyTrack {
  id: string; uri: string; name: string;
  artists: SpotifyArtistRef[]; duration_ms: number;
}
export interface SpotifyAlbum {
  id: string; name: string;
  album_type: "album" | "single" | "compilation";
  release_date: string;
}
/** Minimal playlist shape used by DestinationModal (id + name). */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: { id: string };
}

// ─── Token ────────────────────────────────────────────────────────────────────

let _token: { value: string; expires: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (_token && Date.now() < _token.expires) return _token.value;

  const s = Spicetify as any;
  let value = "";

  try {
    const r = await s.Platform?.AuthorizationAPI?.getToken();
    value = r?.accessToken ?? (typeof r === "string" ? r : "");
  } catch { /* fall through */ }

  if (!value) value = s.Platform?.Session?.accessToken ?? "";

  if (!value) {
    const session = s.Platform?.Session ?? {};
    for (const k of Object.keys(session)) {
      if (typeof session[k] === "string" && (session[k] as string).startsWith("BQ")) {
        value = session[k]; break;
      }
    }
  }

  if (!value) throw new Error("Could not obtain Spotify access token");

  console.log(`[AddNewByArtist] ✅ Token: ${value.slice(0, 14)}…`);
  _token = { value, expires: Date.now() + 50 * 60 * 1000 };
  return value;
}

// ─── /me cache ────────────────────────────────────────────────────────────────

let _me: { id: string } | null = null;

export async function getMe(): Promise<{ id: string }> {
  if (_me) return _me;
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify GET /me failed: ${res.status}`);
  _me = await res.json();
  return _me!;
}

// ─── POST helper (write-only, simple retry) ───────────────────────────────────

const MAX_WRITE_RETRIES = 4;

async function apiPost(url: string, body: object): Promise<any> {
  let retries = 0;
  while (true) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const ra = Number(res.headers.get("Retry-After") ?? 5);
      if (++retries >= MAX_WRITE_RETRIES) throw new Error("Spotify API: rate limited on write — try again in a moment");
      await sleep(ra * 1000);
      continue;
    }
    if (res.status === 401) {
      _token = null;
      if (++retries >= MAX_WRITE_RETRIES) throw new Error("Spotify POST 401: Unauthorized");
      continue;
    }
    throw new Error(`Spotify POST ${res.status}: ${res.statusText}`);
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createPlaylist(name: string): Promise<string> {
  const me = await getMe();
  const res = await apiPost(`${BASE}/users/${me.id}/playlists`, {
    name, public: false, description: "Created by Add New by Artist",
  });
  return res.id as string;
}

export async function addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    await apiPost(`${BASE}/playlists/${playlistId}/tracks`, { uris: uris.slice(i, i + 100) });
  }
}
