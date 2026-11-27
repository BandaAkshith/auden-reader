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

The reader offers a bound single page, a facing-page spread, and a continuous view with up to 40 passages per section. Auden detects common chapter titles and uses heading structure from EPUB and DOCX where available. Display and narration preferences are remembered on the device. Word highlighting depends on the device voice reporting speech boundaries.

Reading insights measure time while the reader is visible, with a weekly summary and CSV export. A library backup ZIP includes extracted document text, original PDFs, saved positions, bookmarks, and notes. Restoring a browser backup adds missing document IDs and leaves existing documents in place. The desktop FastAPI account backup is a separate format.

## Audiobook player

The default **Automatic** playback starts with an on-device voice when Kokoro needs time, then uses Kokoro when an upcoming clip is ready. **Kokoro only** offers 11 American and British English voices. **Device speech** uses voices installed on the device. Voice previews play a short, bundled Kokoro sample immediately. The first Kokoro book playback downloads the approximately 92 MB quantized model from Hugging Face. Auden generates audio locally in a worker and keeps upcoming clips in memory while listening. Browser or device performance can affect the wait between clips. Kokoro highlights the active clip; device voices can also report exact word boundaries.

Tap a sentence or press **Listen** to begin. **Autoplay** is on by default and continues across paragraphs and pages. The player saves that position, can seek within the current Kokoro clip, and includes a sleep timer that can stop at the end of a chapter. PDF navigation uses the PDF's own bookmarks when available and recognizes printed contents pages even in older imports. Auden's light/dark switch applies across the library and reader.

## Device accounts and preferences

Auden offers a guest library plus optional browser-local accounts. Use **Log in** or **Create an account** to switch to a separate library and **Preferences** to configure reader and audiobook defaults. Existing browser libraries remain available as guest. To copy books from guest into an account, download a browser library ZIP as guest and restore it while signed in. Device accounts do not sync or encrypt the library. The website stores only a salted passphrase verifier for the account screen.

Kokoro-only playback starts with one short clip, then renders up to five sentences per group. It keeps up to three upcoming groups in memory and can render two groups at once on capable desktops. The audio clock joins prepared groups directly and trims excess silence from clip edges while keeping natural punctuation pauses. Choose **Prepare Kokoro** in Audio settings to load the model and chosen voice before listening. Synthesis can still fall behind on slower devices. **Automatic** uses device speech while the next Kokoro group is rendering. The reading highlight estimates the position from the clip time.

Narration adjusts delivery for explicit dialogue cues such as “she whispered” or “he shouted.” It also recognizes “chu chu” near train references and “tuk tuk” near door knocks. The original text stays visible in the reader.
