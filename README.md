<div align="center">

<img src="frontend/public/logo.svg" width="120" height="120" alt="Bindarr" />

# Bindarr

**Self-hosted collection, storage, and deck manager for Magic: The Gathering.**

[![CI](https://img.shields.io/github/actions/workflow/status/thenotoriousJeremy/bindarr/docker-build.yml?branch=main&label=CI&logo=github)](https://github.com/thenotoriousJeremy/bindarr/actions/workflows/docker-build.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-bindarr-2496ED?logo=docker&logoColor=white)](https://github.com/thenotoriousJeremy/bindarr/pkgs/container/bindarr)
[![License: MIT](https://img.shields.io/github/license/thenotoriousJeremy/bindarr?color=blue)](LICENSE)

[Live demo](https://thenotoriousjeremy.github.io/bindarr/) · [Install](#install) · [Workflows](#workflows) · [Architecture](PROJECT.md) · [Report a bug](https://github.com/thenotoriousJeremy/bindarr/issues/new)

</div>

Bindarr keeps the card, its printing, its condition, its value, and—when it is physical—its exact storage position together. It is a React SPA backed by Express and one SQLite database; Docker persists the database, backups, scan models, and scan catalogs in one volume.

The [live demo](https://thenotoriousjeremy.github.io/bindarr/) uses sample data. Changes are not saved there, and camera scanning requires a server installation.

## Highlights

- Search, browse, scan, and catalog Magic: The Gathering cards through Scryfall.
- Track physical copies, digital **Arena** copies, and wishlist entries separately.
- Store physical cards in binders, boxes, rows, pages, slots, and an Unassigned Pile.
- Build decks from the correct inventory, import decklists, find cards by storage position, and check physical decks out for play.
- Track values, price history, graded slabs, missing copies, and checked-out copies.
- Import ManaBox exports and MTGJSON preconstructed decks; export CSV, JSON, decklists, and complete backups.
- Run a private multi-user installation with roles, invite-only registration by default, API keys, and optional public shares.

## Recent changes

### Local-first Magic imports

- CSV, ManaBox TXT, precon deck, and container imports consult a persistent Scryfall bulk catalog before requesting missing printings from the API.
- Administrators choose a daily UTC refresh time in **Settings → Scryfall bulk data** (10:00 UTC by default), or force a fresh download immediately. Live import logs distinguish local matches from API fallback.

### Arena inventory and decks

- **Arena** is a first-class digital inventory beside Physical Collection and Wishlist.
- Add cards directly to Arena, import ManaBox collection entries into Arena, and filter Dashboard statistics by All Cards, Physical, or Arena.
- Create a **Physical** or **Arena** deck. Arena decks only accept cards owned in Arena; physical decks use physical collection cards.
- **Edit Properties** can switch a deck between Physical and Arena when every card exists in the destination inventory and the deck is not checked out.
- Arena decklist imports search Arena inventory instead of physical cards.
- Arena decks cannot be checked out because they have no physical pull list.

### Deck Builder improvements

- Deck lists identify the deck type in a dedicated **Deck Type** column.
- **Duplicate deck** copies the deck metadata and card quantities into a new `<name> (Copy)` deck without copying checkout state.
- Physical deck cards can sort by container, page or row, and slot. Checkout creates a pull checklist and preserves the card's stored position.
- Cards already allocated to another checked-out deck show their unavailable quantity and deck name.

### Collection and storage improvements

- Collection has Collection, Unassigned Pile, Wishlist, and Arena views.
- Mark a card or multi-selection Missing/Found without losing its last known location.
- Move selected cards between containers, return them to Unsorted, or auto-file them. When a container is full, Bindarr can add matching pages or rows after confirmation.
- Storage supports physical layout and image-list views, with search, filters, sorting, duplicate stacking, and 60%–250% image scaling.

## Workflows

### Add physical, Arena, or wishlist cards

Open **Add Cards**, search by name, set, or collector number, then add the selected printing to Collection, Wishlist, or Arena. Rapid Add supports one-keystroke collector-number entry when a set is pinned. The card inspector can change condition, language, value, graded-slab details, storage placement, and duplicate an eligible raw physical copy.

### Import ManaBox collection exports

In **Add Cards**, select **Choose .txt file** and choose a ManaBox export. Bindarr previews normal, foil, and distinct-printing counts, then resolves each printing by set and collector number. Choose Arena before importing when the export represents your digital inventory.

CSV and ManaBox TXT imports show a live **Import activity** log with local-catalog hits and misses, API fallback counts, set codes, Scryfall rate-limit waits, caching, and save progress. The latest 200 timestamped events remain in the completion summary or failed import dialog. Save preparation is not committed until the log confirms it. Leaving the page disconnects the log but does not roll back the import; check the destination before retrying after a lost connection.

### Export the current collection view

In **Collection**, choose **Export view CSV** or **Export view TXT**. Only the displayed results are exported, in their current order, respecting the active tab, search, filters, and duplicate stacking. CSV includes printing, condition, language, and purchase price; TXT uses decklist lines with quantity, name, set, and collector number. These controls do not export hidden cards or other inventory tabs.

### Create and import decks

1. Open **Deck Builder → Create Deck**.
2. Choose the game and **Physical** or **Arena** inventory.
3. Build from owned cards, import a text decklist, or—for Magic—select a preconstructed deck from MTGJSON.

Decklist import accepts plain lines and MTG Arena-style lines such as `4 Llanowar Elves (FDN) 227`. Arena imports resolve only against Arena cards. Imports add only cards you own in the deck's inventory.

Use **Duplicate deck** for a new deck with the same card list. Use **Edit Properties** to adjust metadata or change its deck type after inventory validation.

For **Commander / EDH** decks, check **Commander** beside **Pulled** on a deck card in list or grid view. Only one card can be selected; checking another replaces the previous commander, and unchecking clears it. The selected card displays a **Commander** banner. The choice persists in duplicates and complete backups, and is cleared if that card is removed or the format changes away from Commander.

### Check out a physical deck

Open a Physical deck and choose **Check Out for Play**. Bindarr creates a pull list grouped by container and compartment, reserves the copies used by that deck, and keeps their stored locations intact. Mark each card pulled while gathering it, then return the deck to release the reservation. Arena decks are digital and therefore have no checkout flow.

### Import a Magic preconstructed deck

Open **Add Cards → Precon Deck**, search MTGJSON by name, set code, or type, inspect the details, and choose **Add Full Deck**. Bindarr resolves exact Scryfall printings and can create a correctly sized Deck Box for the imported physical cards.

### Import a ManaBox storage container

**Storage** opens a searchable container gallery with card-art covers, names, types, and card counts. Sort by name or quantity, use the **Create Container** tile or **Import ManaBox container** action, and click a container to open it. The **Storage** grid button returns to the gallery; **Unassigned Pile** opens unfiled cards.

In **Container Settings**, choose **Choose container image** to pick artwork from cards currently stored in that container. The selection is saved with the container and included in complete backups. **Automatic image** restores the default cover; if the chosen card leaves the container, the gallery falls back to another available card image.

In **Storage**, choose the upload action beside **Create Container** and select a ManaBox `.txt` export. Bindarr creates a Box named after the file and files matching cards already in Unsorted into its first row. It never creates missing collection cards during this workflow.

To add stored cards to an existing deck, open an unlocked container, choose **Select**, select the cards, and choose a deck from **Add to Deck…** in the selection toolbar. Selected quantities are added subject to the existing deck rules; cards stay in their storage locations.

### Back up or move an account

In **Settings → Collection Backup & Data Options**, select **Export Complete Backup**. The JSON archive contains collection entries, cached card metadata, containers and layouts, and decks. Restoring a complete backup replaces the current account's collection, storage, and decks after confirmation.

## Card scanning

Scanning matches card artwork from the camera image; it does not use OCR. It needs both models and a catalog.

1. Fetch models after deployment:

   ```bash
   docker exec bindarr node scripts/fetch-models.mjs
   ```

   From source, run the same command in `backend/`.

2. Build a game/language catalog under **Admin → Catalogs**. A catalog downloads card data and fingerprints card artwork. It can take hours for a large catalog; stopping and resuming retains completed work.

Scanning from a phone requires HTTPS. Use the built-in HTTPS port or terminate TLS with a reverse proxy. The detailed pipeline and its limitations are in [PROJECT.md](PROJECT.md#image-identification-pipeline).

## Install

### Docker

Create `docker-compose.yml`:

```yaml
services:
  bindarr:
    image: ghcr.io/thenotoriousjeremy/bindarr:latest
    container_name: bindarr
    restart: unless-stopped
    ports:
      - "3001:3001" # HTTP: localhost or behind a TLS proxy
      - "3443:3443" # HTTPS: direct phone/camera access
    environment:
      # DEFAULT_ADMIN_PASSWORD: change-me
      # PUBLIC_BASE_URL: https://cards.example.com
      # TRUST_PROXY: "1"
    volumes:
      - bindarr-data:/app/database

volumes:
  bindarr-data:
```

Start it:

```bash
docker compose up -d
```

Open `http://localhost:3001`. Without `DEFAULT_ADMIN_PASSWORD`, the first browser visit creates the owner account. With it set, startup creates the `admin` account and the first visit is a regular login.

The persistent volume contains the SQLite database, automatic backups, TLS certificate, scan models, and catalogs. Upgrade safely with:

```bash
docker compose pull && docker compose up -d
```

The repository's [`docker-compose.yml`](docker-compose.yml) builds from local source instead of pulling the image.

### HTTP, HTTPS, and reverse proxies

| Port | Use |
| --- | --- |
| `3001` | Localhost or a reverse proxy that terminates TLS. |
| `3443` | Direct HTTPS access, including camera use from a phone. |

The built-in HTTPS certificate is self-signed and generated inside the persistent volume. Browsers require one explicit acceptance per device. Mount a trusted certificate and set `SSL_CERT_PATH` and `SSL_KEY_PATH` to replace it. When a reverse proxy terminates TLS, set `TRUST_PROXY=1` and usually publish only port `3001`.

### Configuration

All settings are optional. The canonical, current list is [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `DB_PATH` | SQLite database path. Docker defaults to `/app/database/bindarr.db`. |
| `DEFAULT_ADMIN_PASSWORD` | Bootstrap `admin` password when no users exist. It never changes an existing account. |
| `PUBLIC_BASE_URL` | External URL used for share links and allowed as a CORS origin. |
| `TRUST_PROXY` | Reverse-proxy hop count, commonly `1`. |
| `HTTPS_PORT` | Built-in HTTPS port; set empty for HTTP-only operation. |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | Trusted TLS certificate and key. |
| `ALLOW_REGISTRATION` | Set `true` to allow public self-registration. |
| `CV_MODEL_DIR` | Persistent location for scan models and catalogs. |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP_LAST` | Automatic SQLite snapshot schedule and retention. |

`GET /api/health` is unauthenticated and returns `{"status":"ok"}`.

### Prebuilt server and mobile apps

Releases include self-contained server binaries for Windows, Linux, and Apple Silicon macOS. Download them from the [latest release](https://github.com/thenotoriousJeremy/bindarr/releases/latest), unpack, run, and open `http://localhost:3001`.

Release artifacts also include an Android APK; iOS is distributed through TestFlight. Mobile clients connect to your Bindarr server rather than storing a separate collection.

## Magic data, pricing, and languages

Bindarr uses Scryfall for Magic cards, sets, artwork, printings, and prices. It stores the exact printing and language, not merely a translated card name. The interface supports English, Brazilian Portuguese, French, German, Italian, Japanese, Korean, Russian, Simplified Chinese, Traditional Chinese, and Spanish.

The server checks Scryfall's `default_cards` bulk metadata daily at the UTC time configured by an administrator in **Settings → Scryfall bulk data** (10:00 UTC by default), downloading only when `updated_at` changes. The setting is saved in the application database and takes effect without a restart; the next check runs at the next occurrence of that UTC time, independent of browser or server timezone and daylight saving time. Startup warms a missing catalog in the background, but an existing catalog waits for the chosen daily time. **Download now** forces an actual download even when the snapshot is unchanged, waits for completion, and reports the catalog entry count and snapshot date. These controls affect the shared catalog for all users and are available only to administrators.

The gzip JSONL download is streamed into a separate SQLite catalog at `<DB_PATH>.scryfall-bulk.sqlite` (by default `backend/database/bindarr.db.scryfall-bulk.sqlite`). Allow disk space for the catalog and a temporary replacement during updates. It is rebuildable card data, not your collection database; do not treat it as a collection backup. Successful updates replace it atomically; failed updates keep the previous catalog.

Collection and Arena CSV/TXT imports, precon imports, ManaBox deck creation, and container imports look there first and send only unresolved rows to the existing Scryfall API. Importing never waits for a bulk download. A missing or unusable catalog falls back to the API, as do printings absent from the snapshot, including foreign-language UUIDs. Exact UUIDs are never replaced with another printing; ambiguous name-only matches fall back to the API.

Imported prices initially reflect the catalog snapshot. Scheduled price sweeps (daily by default, respecting the configured refresh interval) and stale-cache refreshes still query the live API, never the bulk catalog.

Prices come from the provider associated with the printing, primarily Scryfall, TCGplayer, and Cardmarket. Bindarr does not convert currencies: mixed-currency totals are explicitly reported as mixed. A graded copy can use its own per-copy value, which replaces the raw card market price in totals and exports.

## API access

Create a read-only API key in **Settings → API Keys**, then pass it as a Bearer token:

```bash
curl -H "Authorization: Bearer <key>" http://localhost:3001/api/stats/networth
```

API keys only authorize `GET` requests and cannot access admin endpoints. Useful endpoints include:

- `GET /api/stats/networth` — collection value and per-game totals.
- `GET /api/stats` — dashboard breakdowns and trends.
- `GET /api/collection` — owned collection entries.
- `GET /api/health` — unauthenticated service health.

## Development

Node 18+ and npm 9+ are required; Node 20 matches the server/container environment.

```bash
npm run install:all
npm run dev
```

Development frontend: `https://localhost:5173`.

Development backend: `http://localhost:3001`.

Run the full test set:

```bash
npm test
```

Frontend quality gates:

```bash
cd frontend
npm run lint
npm run check:locales
npm run build
```

Repository architecture, route ordering, database conventions, and contributor guidance are in [PROJECT.md](PROJECT.md) and [AGENTS.md](AGENTS.md).

## Translating

Copy [`frontend/src/locales/en.json`](frontend/src/locales/en.json), translate the values, and open a pull request. Partial locales are valid because missing keys fall back to English. Preserve placeholders and plural forms. See [docs/TRANSLATING.md](docs/TRANSLATING.md) for details.

## License

[MIT](LICENSE)
