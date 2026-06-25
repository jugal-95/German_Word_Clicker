# German Word Clicker

A Chrome extension that turns subtitle words into instant dictionary lookups. Built while preparing my own German learning routine — watching native German content (YouTube, Netflix) is one of the best ways to learn a language, but constantly pausing to manually look up unfamiliar words in a separate dictionary tab breaks immersion completely. This extension removes that friction: click any word in the subtitles, get its meaning, gender, and an example sentence in under a second, without leaving the video.

**Try it instantly**: open [`demo/index.html`](demo/index.html) in any browser (download the repo and double-click the file, or use VS Code's "Open with Live Server") — a self-contained page that simulates the experience with sample subtitles, no install needed. Optionally, host it for free with GitHub Pages (Settings → Pages → deploy from `main` branch, `/demo` folder) to get a shareable link.

## The problem

When watching German media as a learner, the loop looks like this:

1. A subtitle line appears with an unfamiliar word
2. Pause the video
3. Type the word into a separate dictionary site
4. Read the result, often have to guess the correct base form first
5. Un-pause, try to remember the word, repeat a minute later

This extension collapses that to one click.

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
        │                                                     ▼
        │                                  Falls back to the free Wiktionary
        │                                  REST API automatically
        ▼
Popup renders: part of speech, gender (der/die/das), base form (if the
clicked word was inflected), up to 2-3 definitions, an example sentence,
and a link to the full Wiktionary entry
        │
        ▼
User can optionally star the word to save it to a personal vocab list
(persisted locally via chrome.storage, exportable as CSV)
```

## Features

- **AI-powered definitions** via Google's free Gemini API — resolves inflected/conjugated forms (e.g. clicking *kannt* correctly explains it as a form of *können*) and always returns clean English, even for words where Wiktionary's German section is German-only or missing
- **Automatic fallback to Wiktionary** if no API key is configured, or if the AI call fails for any reason — the extension always returns *something* useful
- **One-click lookup** on YouTube and Netflix subtitles
- **Gender detection** for German nouns (der/die/das), shown as a colored badge
- **Personal vocab list** — save words you look up, review them later, export to CSV for flashcard apps like Anki
- **Local caching** (24h TTL via `chrome.storage.local`) so repeated lookups don't hit the network
- **Performance-safe by design** — the DOM observer is scoped to the video player only (not the whole page) and throttled to run at most once every 400ms, so it doesn't interfere with video playback

## Tech stack

This project intentionally uses only the three core web languages:

| Layer | Technology |
|---|---|
| Structure | HTML5 |
| Styling | CSS3 (custom properties, no frameworks) |
| Logic | Vanilla JavaScript (ES6+, no build step, no dependencies) |
| Primary definitions | [Gemini API](https://ai.google.dev/) free tier — a `fetch()` call, not a separate language |
| Fallback definitions | [Wiktionary REST API](https://en.wiktionary.org/api/rest_v1/) — free, no key required |
| Storage | `chrome.storage.local` (Chrome Extension API) |

No backend server, no build tooling, no npm dependencies. Everything runs client-side in the browser. The AI integration is a plain `fetch()` request to Google's REST endpoint — it does not require Python, Node, or any server-side code.

## Project structure

```
german-word-clicker/
├── extension/              Chrome extension (Manifest V3)
│   ├── manifest.json        Extension configuration
│   ├── content.js           Injected into YouTube/Netflix — finds subtitles,
│   │                        makes words clickable, queries the AI/dictionary,
│   │                        renders the lookup popup
│   ├── config.example.js    Template for your Gemini API key (copy → config.js)
│   ├── config.js            Your actual key — gitignored, never committed
│   ├── popup.html / .js     Toolbar popup — shows the saved vocab list
│   ├── styles.css           Popup and clickable-word styling
│   └── icons/                Extension icons (16/48/128px)
├── demo/
│   └── index.html            Standalone demo page — no install or API key
│                              required, uses Wiktionary only, simulates a
│                              video player with real subtitles
└── README.md
```

## Installing the extension locally

1. Clone or download this repository
2. **(Optional but recommended)** Set up the free AI layer:
   - Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with any Google account (no credit card)
   - Click **Create API key** and copy it
   - In `extension/`, copy `config.example.js` to a new file named `config.js`
   - Paste your key into `config.js`
   - Skipping this step is fine — the extension automatically falls back to Wiktionary, which needs no key at all
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the `extension/` folder
6. Open any YouTube video, turn on German subtitles, and click a word

### About the free tier

Gemini's free tier (as of writing) covers far more daily lookups than a normal study session needs — each word lookup is a tiny request, and results are cached locally for 24 hours so re-clicking the same word never re-queries the API. If the free quota is ever exceeded, or no key is configured at all, the extension transparently falls back to the Wiktionary API with no error shown to the user.

## Design decisions worth noting

- **Scoped MutationObserver**: an early version watched `document.body` for changes, which fired on every UI update YouTube makes (timestamps, recommendations, etc.) and caused noticeable lag. The fixed version observes only the video player container and throttles execution, which keeps playback smooth.
- **AI-first with automatic fallback, not AI-only**: relying solely on an external AI API would mean the extension breaks entirely if the API key is missing, rate-limited, or the service has an outage. Wiktionary as a fallback means the core feature always works, even with zero configuration.
- **API key kept out of version control**: the key lives in a gitignored `config.js`, loaded as a separate content script before `content.js`. This is the standard pattern for client-side projects that need a personal key without leaking it in a public repo.
- **Caching layer**: lookups are cached both in memory and in `chrome.storage.local` with a 24-hour expiry, so re-watching a video or re-clicking a word doesn't trigger redundant network calls — this also reduces how often the (rate-limited) free AI tier gets hit.
- **Graceful degradation**: if a word isn't found by either source, the popup shows a clear message instead of failing silently or breaking the page.

## Roadmap / possible extensions

- Support for more streaming platforms
- Inflected-form lookup (so clicking *gelaufen* resolves to *laufen* automatically)
- Spaced-repetition export format (Anki `.apkg`)
- Firefox port (the codebase is already close to Manifest V2/V3 cross-compatible)

## License

MIT — see [LICENSE](LICENSE)
