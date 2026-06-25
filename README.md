# German Word Clicker

A Chrome extension that turns subtitle words into instant dictionary lookups — click any word while watching German content on YouTube or Netflix, and get its meaning, gender, and an example sentence in under a second, without ever leaving the video.

**Try it instantly**: open [`demo/index.html`](demo/index.html) in any browser — a self-contained page that simulates the experience with sample subtitles, no install needed.

---

## Screenshots

| Verb lookup | Noun lookup |
|:-----------:|:-----------:|
| ![Verb lookup – bekommen](Verb.png) | ![Noun lookup – Geschichte](Noun.png) |
| *Clicking a verb: **bekommen** with Wiktionary fallback* | *Clicking a noun: **Geschichte** with gender badge* |

| Full example in context | AI-powered lookup |
|:-----------------------:|:----------------:|
| ![Example – Wohnung](Example.png) | ![Vocab – klicken](Vocab.png) |
| *Word **Wohnung** highlighted in subtitle, popup inline* | *AI mode: **klicken!** with clean English definitions* |

---

## The problem

When watching German media as a learner, the loop looks like this:

1. A subtitle line appears with an unfamiliar word
2. Pause the video
3. Type the word into a separate dictionary site
4. Read the result, often have to guess the correct base form first
5. Un-pause, try to remember the word, repeat a minute later

This extension collapses that to one click.

---

## How it works

```
Subtitle appears on screen
│
▼
Content script splits the subtitle text into clickable <span> elements
│
▼
User clicks a word
│
▼
Extension queries Gemini (free tier) for a clean English explanation,
including resolving inflected forms to their dictionary base form
│
├── if no API key configured, or the AI call fails ──┐
│                                                    ▼
│                                       Falls back to the free Wiktionary
│                                       REST API automatically
▼
Popup renders: part of speech, gender (der/die/das), base form (if the
clicked word was inflected), up to 2-3 definitions, an example sentence,
and a link to the full Wiktionary entry
│
▼
User can optionally star the word to save it to a personal vocab list
(persisted locally via chrome.storage, exportable as CSV)
```

---

## Features

- **AI-powered definitions** via Google's free Gemini API — resolves inflected/conjugated forms (e.g. clicking *kannt* correctly explains it as a form of *können*) and always returns clean English, even for words where Wiktionary's German section is German-only or missing
- **Automatic fallback to Wiktionary** if no API key is configured, or if the AI call fails for any reason — the extension always returns *something* useful
- **One-click lookup** on YouTube and Netflix subtitles
- **Gender detection** for German nouns (der/die/das), shown as a colored badge
- **Personal vocab list** — save words you look up, review them later, export to CSV for flashcard apps like Anki
- **Local caching** (24h TTL via chrome.storage.local) so repeated lookups don't hit the network
- **Performance-safe by design** — the DOM observer is scoped to the video player only and throttled to run at most once every 400ms

---

## Tech stack

This project intentionally uses only the three core web languages:

| Layer | Technology |
|-------|------------|
| Structure | HTML5 |
| Styling | CSS3 (custom properties, no frameworks) |
| Logic | Vanilla JavaScript (ES6+, no build step, no dependencies) |
| Primary definitions | Gemini API free tier — a `fetch()` call |
| Fallback definitions | Wiktionary REST API — free, no key required |
| Storage | `chrome.storage.local` (Chrome Extension API) |

No backend server, no build tooling, no npm dependencies. Everything runs client-side in the browser.

---

## Project structure

```
german-word-clicker/
├── extension/                   Chrome extension (Manifest V3)
│   ├── manifest.json            Extension configuration
│   ├── content.js               Injected into YouTube/Netflix
│   ├── config.example.js        Template for your Gemini API key
│   ├── config.js                Your actual key — gitignored, never committed
│   ├── popup.html / .js         Toolbar popup — shows the saved vocab list
│   ├── styles.css               Popup and clickable-word styling
│   └── icons/                   Extension icons (16/48/128px)
├── demo/
│   └── index.html               Standalone demo page — no install or API key required
└── README.md
```

---

## Installing the extension locally

1. Clone or download this repository
2. **(Optional but recommended)** Set up the free AI layer:
   - Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with any Google account
   - Click **Create API key** and copy it
   - In `extension/`, copy `config.example.js` → `config.js` and paste your key
   - *Skipping this is fine — the extension falls back to Wiktionary automatically*
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the `extension/` folder
6. Open any YouTube video, turn on German subtitles, and click a word

---

## About the free tier

Gemini's free tier covers far more daily lookups than a normal study session needs — each word lookup is a tiny request, and results are cached locally for 24 hours. If the free quota is ever exceeded, or no key is configured, the extension transparently falls back to the Wiktionary API with no error shown.

---

## Design decisions worth noting

**Scoped MutationObserver:** an early version watched `document.body` for changes, which fired on every UI update YouTube makes and caused noticeable lag. The fixed version observes only the video player container and throttles execution, keeping playback smooth.

**AI-first with automatic fallback, not AI-only:** relying solely on an external AI API would mean the extension breaks if the key is missing or rate-limited. Wiktionary as a fallback means the core feature always works, even with zero configuration.

**API key kept out of version control:** the key lives in a gitignored `config.js`, loaded as a separate content script before `content.js`. This is the standard pattern for client-side projects that need a personal key without leaking it in a public repo.

**Caching layer:** lookups are cached both in memory and in `chrome.storage.local` with a 24-hour expiry, so re-watching a video or re-clicking a word doesn't trigger redundant network calls.

**Graceful degradation:** if a word isn't found by either source, the popup shows a clear message instead of failing silently.

---

## Roadmap / possible extensions

- Support for more streaming platforms
- Inflected-form lookup (so clicking *gelaufen* resolves to *laufen* automatically)
- Spaced-repetition export format (Anki `.apkg`)
- Firefox port (the codebase is already close to Manifest V2/V3 cross-compatible)

---

## License

MIT — see [LICENSE](LICENSE)
