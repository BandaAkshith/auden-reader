# Auden

Auden is a browser-based reading room. Import PDF, EPUB, DOCX, or TXT files, find passages, save bookmarks and notes, and listen with on-device speech voices. A short built-in story lets you explore the reader before importing a file.

## Run locally

Use Node.js 24, then run:

```sh
npm ci --prefix pages
npm run dev --prefix pages
```

Run `npm run build --prefix pages` to type-check and build the production site. The GitHub Actions workflow publishes `pages/dist` to GitHub Pages when changes land on `main`.

## Where the library lives

Imported text, PDF originals, notes, bookmarks, and progress live in this browser's IndexedDB storage for the site. Use the reading-history and annotation exports to keep copies of that information. The Pages edition has no accounts or cross-device sync. Clearing site data removes the browser library.

PDF imports require an extractable text layer. EPUB imports support text in standard EPUB XHTML chapters. Narration uses voices the browser identifies as on-device, so voice availability varies by platform. The existing FastAPI and Kokoro edition runs separately.

## Reading tools and backups

The reader offers a single page, a two-page spread, and a continuous view with up to 40 passages per section. Auden detects common chapter titles and uses heading structure from EPUB and DOCX where available. Display and narration preferences are remembered on the device. Word highlighting depends on the device voice reporting speech boundaries.

Reading insights measure time while the reader is visible, with a weekly summary and CSV export. A library backup ZIP includes extracted document text, original PDFs, saved positions, bookmarks, and notes. Restoring a browser backup adds missing document IDs and leaves existing documents in place. The desktop FastAPI account backup is a separate format.
