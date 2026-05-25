/**
 * Modal that shows missing tracks + destination picker.
 * Uses Spotify/Spicetify CSS variables so it works with all themes.
 */

import { ArtistTrack } from "../services/artistScanner";
import { SpotifyPlaylist } from "../services/spotifyApi";
import { writeTracks, Destination } from "../services/playlistWriter";

// Proxy so React.useState/useEffect etc. read Spicetify.React lazily at call time.
const React: any = new Proxy({} as any, {
  get(_: any, prop: string | symbol) {
    return (Spicetify as any).React?.[prop as string];
  },
});

interface Props {
  artistName: string;
  missingTracks: ArtistTrack[];
  playlists: SpotifyPlaylist[];
  /** Called immediately after tracks are successfully written. */
  onTracksAdded: () => void;
  /** Re-scans library + discography and re-populates the modal. */
  onRefresh: () => void;
  onClose: () => void;
}

export function DestinationModal({
  artistName,
  missingTracks,
  playlists,
  onTracksAdded,
  onRefresh,
  onClose,
}: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(missingTracks.map((t) => t.uri))
  );
  const [destType, setDestType] = React.useState<"existing" | "new">(
    playlists.length > 0 ? "existing" : "new"
  );
  const [existingId, setExistingId] = React.useState(playlists[0]?.id ?? "");
  const [newName, setNewName] = React.useState(`${artistName} — New Tracks`);
  const [adding, setAdding] = React.useState(false);

  const toggle = (uri: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uri) ? next.delete(uri) : next.add(uri);
      return next;
    });

  const handleAdd = async () => {
    setAdding(true);
    try {
      const uris = missingTracks.filter((t) => selected.has(t.uri)).map((t) => t.uri);
      const dest: Destination =
        destType === "new"
          ? { type: "new", name: newName }
          : { type: "existing", id: existingId };
      await writeTracks(uris, dest);
      onTracksAdded(); // wipe caches before closing
      onClose();
    } catch (e: unknown) {
      Spicetify.showNotification(`❌ ${(e as Error).message}`);
      setAdding(false);
    }
  };

  // Stop clicks inside the modal from closing it via overlay click
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={stopProp} role="dialog" aria-modal="true">

        {/* ── Header ── */}
        <div style={S.header}>
          <h2 style={S.title}>
            {missingTracks.length === 0
              ? `${artistName} — all tracks already in library`
              : `${missingTracks.length} missing track${missingTracks.length !== 1 ? "s" : ""} by ${artistName}`}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <button
              style={{ ...S.closeBtn, fontSize: 16 }}
              onClick={onRefresh}
              aria-label="Refresh — re-scan library and discography"
              title="Refresh"
            >↺</button>
            <button style={S.closeBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {missingTracks.length > 0 ? (
          <>
            {/* ── Bulk select ── */}
            <div style={S.bulkRow}>
              <button style={S.linkBtn} onClick={() => setSelected(new Set(missingTracks.map(t => t.uri)))}>
                Select all
              </button>
              <span style={{ color: "var(--text-subdued, #a7a7a7)", margin: "0 4px" }}>·</span>
              <button style={S.linkBtn} onClick={() => setSelected(new Set())}>
                Deselect all
              </button>
              <span style={{ marginLeft: "auto", color: "var(--text-subdued, #a7a7a7)", fontSize: 12 }}>
                {selected.size} / {missingTracks.length} selected
              </span>
            </div>

            {/* ── Track list ── */}
            <div style={S.trackList}>
              {missingTracks.map((track) => (
                <label key={track.uri} style={S.trackRow}>
                  <input
                    type="checkbox"
                    checked={selected.has(track.uri)}
                    onChange={() => toggle(track.uri)}
                    style={{ marginRight: 10, accentColor: "var(--essential-bright-accent, #1db954)", flexShrink: 0 }}
                  />
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {track.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-subdued, #a7a7a7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {track.albumName}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* ── Destination ── */}
            <div style={S.destSection}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Add to:</div>
              <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
                {playlists.length > 0 && (
                  <label style={S.radioLabel}>
                    <input
                      type="radio" name="dest" value="existing"
                      checked={destType === "existing"}
                      onChange={() => setDestType("existing")}
                      style={{ accentColor: "var(--essential-bright-accent, #1db954)" }}
                    />
                    Existing playlist
                  </label>
                )}
                <label style={S.radioLabel}>
                  <input
                    type="radio" name="dest" value="new"
                    checked={destType === "new"}
                    onChange={() => setDestType("new")}
                    style={{ accentColor: "var(--essential-bright-accent, #1db954)" }}
                  />
                  Create new playlist
                </label>
              </div>

              {destType === "existing" ? (
                <select
                  style={S.input}
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                >
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  style={S.input}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New playlist name"
                />
              )}
            </div>

            {/* ── Add button ── */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                style={{
                  ...S.addBtn,
                  opacity: adding || selected.size === 0 ? 0.5 : 1,
                  cursor: adding || selected.size === 0 ? "not-allowed" : "pointer",
                }}
                onClick={handleAdd}
                disabled={adding || selected.size === 0}
              >
                {adding ? "Adding…" : `Add ${selected.size} track${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: "var(--text-subdued, #a7a7a7)", padding: "8px 0 0" }}>
            🎉 Your library is already up to date for this artist.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Styles — use Spotify's own CSS vars so every theme works ─────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    // Ensure it sits above Spotify UI layers
    isolation: "isolate",
  },
  modal: {
    background: "var(--background-elevated-base, #282828)",
    color: "var(--text-base, #fff)",
    borderRadius: 12,
    padding: "28px 32px",
    width: 480,
    maxWidth: "92vw",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    gap: 0,
    boxShadow: "0 16px 64px rgba(0,0,0,0.7)",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontWeight: 700,
    fontSize: 20,
    margin: 0,
    lineHeight: 1.3,
    flex: 1,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-subdued, #a7a7a7)",
    cursor: "pointer",
    fontSize: 20,
    padding: 4,
    lineHeight: 1,
    flexShrink: 0,
    borderRadius: 4,
  },
  bulkRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: 8,
    fontSize: 13,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "var(--essential-bright-accent, #1db954)",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
    textDecoration: "underline",
  },
  trackList: {
    overflowY: "auto",
    maxHeight: 260,
    marginBottom: 16,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  trackRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
    // theme-safe hover handled via :hover in global CSS
  },
  destSection: {
    borderTop: "1px solid var(--essential-subdued, rgba(255,255,255,0.15))",
    paddingTop: 16,
    marginBottom: 20,
  },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    fontSize: 14,
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    background: "var(--background-tinted-base, #3e3e3e)",
    color: "var(--text-base, #fff)",
    border: "1px solid var(--essential-subdued, rgba(255,255,255,0.2))",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
  },
  addBtn: {
    background: "var(--essential-bright-accent, #1db954)",
    color: "#000",
    border: "none",
    borderRadius: 500,
    padding: "10px 28px",
    fontWeight: 700,
    fontSize: 14,
    transition: "transform 0.1s, opacity 0.1s",
  },
};
