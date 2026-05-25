# Add New by Artist — Spicetify Extension

A Spicetify extension that injects an **"Add New"** button on every Spotify artist page. Click it to discover which songs by that artist are missing from your library and add them to a playlist in one step.

## Features

- 🔍 **Scans your full library** — liked songs + all playlists you own
- 🎵 **Finds missing originals** — fetches the artist's complete discography
- 🧹 **Smart deduplication** — if you have any version of a song (remix, live, extended), the original is considered covered
- ✅ **Checkbox picker** — deselect any tracks you don't want before adding
- 📂 **Flexible destination** — add to an existing playlist or create a new one instantly

## Installation

### Prerequisites

1. **Spicetify** installed:
   ```powershell
   winget install Spicetify.Spicetify
   ```
   Then run `spicetify backup apply` once to patch Spotify.

2. **Node.js 18+** for building from source.

### Quick install (pre-built)

The extension is built automatically on `npm run build`. After building:

```powershell
spicetify config extensions add-new-by-artist.js
spicetify apply
```

That's it — restart Spotify and navigate to any artist page.

### Build from source

```powershell
git clone https://github.com/lorak12/add-new-by-artist
cd add-new-by-artist
npm install
npm run build
spicetify config extensions add-new-by-artist.js
spicetify apply
```

### Development (live reload)

```powershell
npm run watch   # rebuilds + spicetify apply on every file change
```

## Usage

1. Open Spotify and go to any **Artist page**
2. Click the **"Add New"** button next to the Follow button
3. Wait for the scan (a few seconds for large libraries)
4. **Review** the list of missing tracks — uncheck any you don't want
5. Choose **destination**: an existing playlist or a new one
6. Click **Add** — done!

## How deduplication works

| Case | Result |
|---|---|
| Track is in liked songs | Skipped |
| Track is in any owned playlist | Skipped |
| You have a remix/live/extended of the track | Original also skipped |
| Track appears on multiple albums | Earliest album version kept, rest skipped |
| Track is featured (artist not primary) | Skipped |

## Project structure

```
src/
  app.tsx                   Entry point — route listener + button injector
  components/
    AddNewButton.tsx         The "Add New" button component
    DestinationModal.tsx     Track picker + playlist destination modal
  services/
    spotifyApi.ts            Spotify Web API wrappers
    libraryScanner.ts        Builds library index (liked + owned playlists)
    artistScanner.ts         Fetches + deduplicates artist discography
    playlistWriter.ts        Adds tracks to playlist
  utils/
    trackNormalizer.ts       Strips remix/live/extended suffixes
```

## Troubleshooting

**Button doesn't appear on artist page**
- Make sure the extension is registered: `spicetify config extensions add-new-by-artist.js`
- Run `spicetify apply` and restart Spotify
- Open DevTools (Ctrl+Shift+I in Spotify) and check the Console for errors

**Scan is slow**
- Large libraries (thousands of tracks + many playlists) can take 10–30 seconds
- The library index is cached for 30 minutes, so repeat scans within the same session are instant

**"Error: ..." notification**
- Check the DevTools console for the full error message
- If the error mentions "timed out", Spotify's internal APIs were slow — try again in a moment
