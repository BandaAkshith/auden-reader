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

Imported text, PDF originals, notes, bookmarks, and progress live in this browser's IndexedDB storage for the site. Use the reading-history and annotation exports to keep copies of that information. Clearing site data removes the browser library.

PDF imports require an extractable text layer. EPUB imports support text in standard EPUB XHTML chapters. Narration uses voices the browser identifies as on-device, so voice availability varies by platform. The existing FastAPI and Kokoro edition runs separately.

## Reading tools and backups

The reader offers a bound single page, a facing-page spread, and a continuous view with up to 40 passages per section. Auden detects common chapter titles and uses heading structure from EPUB and DOCX where available. Display and narration preferences are remembered on the device. Word highlighting depends on the device voice reporting speech boundaries.

Reading insights measure time while the reader is visible, with a weekly summary and CSV export. A library backup ZIP includes extracted document text, original PDFs, saved positions, bookmarks, and notes. Restoring a browser backup adds missing document IDs and leaves existing documents in place. The desktop FastAPI account backup is a separate format.

## Audiobook player

**Automatic** starts by preparing Kokoro narration and can use device speech when Kokoro falls behind. **Kokoro only** uses its own local voice library. **Device speech** uses voices installed on the device. Kokoro voice previews play a short, bundled sample immediately. The first Kokoro book playback downloads the approximately 92 MB quantized model from Hugging Face.

Tap a sentence or press **Listen** to begin. **Autoplay** is on by default and continues across paragraphs and pages. The player saves that position, can seek within the current Kokoro clip, and includes a sleep timer that can stop at the end of a chapter. PDF navigation uses the PDF's own bookmarks when available and recognizes printed contents pages even in older imports. Auden's light/dark switch applies across the library and reader.

## Device accounts and preferences

Auden offers a guest library plus optional browser-local accounts. Use **Log in** or **Create an account** to switch to a separate library and **Preferences** to configure reader and audiobook defaults. Existing browser libraries remain available as guest. To copy books from guest into an account, download a browser library ZIP as guest and restore it while signed in. Device accounts do not sync or encrypt the library. The website stores only a salted passphrase verifier for the account screen.

Open **Preferences → Profile** to choose one of the twelve zodiac signs or Ophiuchus. One selection sets the built-in avatar and matching constellation banner for the browser profile.

Kokoro and Qwen prepare the first six sentences before starting playback. They build eight-sentence batches after that and keep a rolling target of three fully generated, decoded batches. A book or chapter stop can shorten the final batch. Auden can render smaller pieces within a batch for long sentences and dialogue cues, and joins prepared batches on the audio clock. The reading highlight estimates the active sentence from the batch time. Synthesis can still fall behind if a device renders more slowly than playback.

Choose **Deep Voice**, **Bass Voice**, or **Manly Voice** in Audio settings. A voice change leaves the currently playing and buffered audio intact and applies to newly generated batches. **Prepare Kokoro** loads its model before playback.

Changing the playback speed adjusts the audio already playing and the decoded batches, so the player keeps its buffer. Kokoro and Qwen use pitch-preserving time stretching. Qwen also keeps its narrator instructions consistent across batches and gently balances levels between rendered pieces.

Narration adjusts delivery for explicit dialogue cues such as “she whispered” or “he shouted.” It also recognizes “chu chu” near train references and “tuk tuk” near door knocks. The original text stays visible in the reader.

## Qwen3-TTS on Apple Silicon

Qwen3-TTS is an optional local narrator with the three male profiles, Ryan and Aiden presets, and support for delivery instructions. Auden uses the 1.7B CustomVoice model through MLX-Audio. It runs without a paid API and book passages stay on your Mac. The model download is about 2.3 GB.

From the repository root on an Apple Silicon Mac with Python 3.12:

```sh
python3.12 -m venv .qwen-venv
.qwen-venv/bin/python -m pip install -r qwen/requirements.txt
npm ci --prefix pages
npm run build --prefix pages
.qwen-venv/bin/python qwen/serve.py
```

Keep the companion running while listening. The first start downloads the model and prints **Qwen3-TTS ready** when it can generate audio. In Auden, select **Qwen3-TTS (local)** in **Audio settings**, then use **Check Qwen connection** or **Listen**. Allow local network access if your browser asks. If the browser blocks the connection from GitHub Pages, use **Open local Auden** to open the same reader directly from the companion at `http://127.0.0.1:8776/`. The local reader has its own browser library. To bring over your books, export a library ZIP from the hosted reader, then restore it in the local reader.

Qwen joins ready clips using the same look-ahead player as Kokoro. Total generation time and any buffering depend on the Mac and the selected passage.
