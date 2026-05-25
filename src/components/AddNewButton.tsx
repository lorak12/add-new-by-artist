/**
 * "Add New" button injected into the artist page action bar.
 *
 * Click flow:
 *  1. Check per-artist cache → instant result if library hasn't grown
 *  2. Otherwise wait for background library scan (usually already done)
 *  3. Scan artist discography via Spicetify internal APIs (no rate limits)
 *  4. Open destination modal
 *
 * After user adds tracks → force-wipe both the library localStorage cache
 * AND the per-artist cache so the next check always reflects reality.
 *
 * Refresh flow (via button in modal):
 *  Wipe both caches, re-run full scan, re-populate modal in place.
 */

import { waitForLibrary, isInLibrary, isLibraryReady, invalidateLibraryCache } from "../services/libraryScanner";
import { getArtistOriginalTracks } from "../services/artistScanner";
import { getArtistCache, setArtistCache, clearArtistCache } from "../services/artistCache";
import { SpotifyPlaylist } from "../services/spotifyApi";
import { DestinationModal } from "./DestinationModal";

const React: any = new Proxy({} as any, {
  get(_: any, prop: string | symbol) { return (Spicetify as any).React?.[prop as string]; },
});

interface Props { artistId: string; artistName: string; }
type State = "idle" | "scanning" | "error";

export function AddNewButton({ artistId, artistName }: Props) {
  const [state, setState] = React.useState<State>("idle");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalData, setModalData] = React.useState<{
    missingTracks: Awaited<ReturnType<typeof getArtistOriginalTracks>>;
    playlists: SpotifyPlaylist[];
  } | null>(null);

  // Show a subtle indicator if library scan is still in progress
  const [libReady, setLibReady] = React.useState(isLibraryReady());
  React.useEffect(() => {
    if (!libReady) {
      const timer = setInterval(() => {
        if (isLibraryReady()) { setLibReady(true); clearInterval(timer); }
      }, 500);
      return () => clearInterval(timer);
    }
  }, [libReady]);

  // ─── Shared scan logic ────────────────────────────────────────────────────
  // Used by both the initial click and the refresh button in the modal.
  const runScan = async (skipCache = false): Promise<void> => {
    setState("scanning");
    setModalOpen(false);
    try {
      const library = await waitForLibrary();

      if (!skipCache) {
        const cached = getArtistCache(artistId, library.size);
        if (cached) {
          console.log(`[AddNewByArtist] Artist cache hit: ${cached.length} missing tracks`);
          setModalData({ missingTracks: cached as any, playlists: library.playlists });
          setState("idle");
          setModalOpen(true);
          return;
        }
      }

      console.log(`[AddNewByArtist] Scanning discography (skipCache=${skipCache})…`);
      const artistTracks = await getArtistOriginalTracks(artistId);
      const missing = artistTracks.filter((t) => !isInLibrary(t.name, t.id, library));

      setArtistCache(artistId, artistName, missing, library.size);
      console.log(`[AddNewByArtist] Found ${missing.length} missing tracks, cached.`);

      setModalData({ missingTracks: missing, playlists: library.playlists });
      setState("idle");
      setModalOpen(true);
    } catch (e: unknown) {
      console.error("[AddNewByArtist]", e);
      Spicetify.showNotification(`❌ ${(e as Error).message}`);
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  // ─── Click handler ────────────────────────────────────────────────────────
  const handleClick = () => {
    if (state === "scanning") return;
    runScan(false);
  };

  // ─── Called by modal after user successfully adds tracks ──────────────────
  // Force-wipes localStorage cache so the next scan (whenever it happens)
  // fetches fresh data instead of serving the pre-add count.
  const handleTracksAdded = () => {
    clearArtistCache(artistId);
    invalidateLibraryCache(true); // true = also wipe localStorage
  };

  // ─── Refresh button in modal ──────────────────────────────────────────────
  const handleRefresh = () => {
    clearArtistCache(artistId);
    invalidateLibraryCache(true);
    runScan(true); // skipCache = true, will re-open modal when done
  };

  // ─── Modal close ──────────────────────────────────────────────────────────
  const handleClose = () => {
    setModalOpen(false);
  };

  // ─── Icons ────────────────────────────────────────────────────────────────
  const addIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
    </svg>
  );
  const spinner = (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid currentColor", borderTopColor: "transparent",
      borderRadius: "50%", animation: "add-new-spin 0.7s linear infinite", flexShrink: 0,
    }}/>
  );

  let buttonIcon: React.ReactNode;
  let label: string;

  if (state === "scanning") {
    buttonIcon = spinner;
    label = !libReady ? "Loading…" : "Scanning…";
  } else if (state === "error") {
    buttonIcon = addIcon;
    label = "Error";
  } else {
    buttonIcon = addIcon;
    label = "Add New";
  }

  return (
    <>
      <SpotifyButton state={state} onClick={handleClick}>
        {buttonIcon}
        {label}
      </SpotifyButton>

      {modalOpen && modalData && (
        <ModalPortal>
          <DestinationModal
            artistName={artistName}
            missingTracks={modalData.missingTracks}
            playlists={modalData.playlists}
            onTracksAdded={handleTracksAdded}
            onRefresh={handleRefresh}
            onClose={handleClose}
          />
        </ModalPortal>
      )}
    </>
  );
}

// ─── SpotifyButton ────────────────────────────────────────────────────────────

function SpotifyButton({ state, onClick, children }: {
  state: State; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      className={[
        "encore-text-body-small-bold",
        "e-10451-legacy-button--small",
        "e-10451-legacy-button-secondary--text-base",
        "encore-internal-color-text-base",
        "e-10451-legacy-button",
        "e-10451-legacy-button-secondary",
        "e-10451-overflow-wrap-anywhere",
      ].join(" ")}
      data-encore-id="buttonSecondary"
      aria-label="Add new tracks by this artist"
      disabled={state === "scanning"}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        whiteSpace: "nowrap",
        opacity: state === "scanning" ? 0.65 : 1,
        cursor: state === "scanning" ? "wait" : "pointer",
        transition: "opacity 0.2s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Portal ───────────────────────────────────────────────────────────────────

function ModalPortal({ children }: { children: React.ReactNode }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  if (!containerRef.current) {
    containerRef.current = document.createElement("div");
    containerRef.current.id = "add-new-modal-portal";
  }
  React.useEffect(() => {
    const el = containerRef.current!;
    document.body.appendChild(el);
    return () => { document.body.removeChild(el); };
  }, []);
  const RD = (Spicetify as any).ReactDOM;
  if (RD?.createPortal) return RD.createPortal(children, containerRef.current);
  return children as React.ReactElement;
}
