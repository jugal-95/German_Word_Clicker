// content.js — runs on YouTube and Netflix watch pages.
// Wraps subtitle words in clickable spans, handles word lookups via Gemini or Wiktionary,
// shows a popup with the definition, and manages the saved vocab list.

(function () {
  "use strict";

  // --- AI client (Gemini, free tier) ---
  const AiClient = (() => {
    const MODEL = "gemini-2.5-flash";
    const ENDPOINT =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL +
      ":generateContent";

    function hasKey() {
      return (
        typeof GWC_CONFIG !== "undefined" &&
        GWC_CONFIG.GEMINI_API_KEY &&
        GWC_CONFIG.GEMINI_API_KEY !== "PASTE_YOUR_KEY_HERE"
      );
    }

    function buildPrompt(word) {
      return (
        "You are a precise German-to-English dictionary. " +
        "The user is watching German video and hovered over this word or phrase: \"" +
        word +
        "\"\n\n" +
        "Rules:\n" +
        "1. Always return a result — even for advanced, rare, compound, or colloquial words.\n" +
        "2. If the word is a compound (e.g. Handschuh, Weltanschauung), break it down briefly in one definition.\n" +
        "3. If conjugated or declined, identify the base (dictionary) form.\n" +
        "4. Definitions must be in plain English. Do NOT include the German word in the definition.\n" +
        "5. Keep each definition under 15 words.\n" +
        "6. Provide up to 3 definitions if the word has genuinely distinct meanings.\n\n" +
        "Reply with ONLY valid JSON, no markdown fences, matching exactly:\n" +
        '{"word":"<the word as given>","baseForm":"<dictionary form, or same as word>",' +
        '"pos":"<Noun, Verb, Adjective, Adverb, Preposition, Pronoun, Conjunction, Particle, or Other>",' +
        '"gender":"<der, die, das, or empty string if not a noun>",' +
        '"definitions":["<meaning 1>","<meaning 2 if distinct>","<meaning 3 if distinct>"],' +
        '"example":"<one natural German sentence using the word>"}'
      );
    }

    async function lookup(word) {
      if (!hasKey()) return null;

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GWC_CONFIG.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(word) }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
          }),
        });

        if (!res.ok) throw new Error("gemini http " + res.status);
        const data = await res.json();
        const text =
          data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const cleaned = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed.definitions || parsed.definitions.length === 0) return null;

        return {
          word: word.toLowerCase(),
          baseForm: parsed.baseForm || word,
          pos: parsed.pos || "",
          gender: ["der", "die", "das"].includes(parsed.gender) ? parsed.gender : "",
          definitions: parsed.definitions.slice(0, 3),
          example: parsed.example || "",
          source: "ai",
        };
      } catch (_) {
        return null;
      }
    }

    return { lookup, hasKey };
  })();

  // ───────────────────────── Dictionary (AI-first, Wiktionary fallback) ─────
  const Dictionary = (() => {
    const memCache = new Map();

    function clean(word) {
      return word
        .toLowerCase()
        .replace(/[.,!?;:"'()\[\]„“”‚‘’«»]/g, "")
        .trim();
    }

    async function lookup(rawWord) {
      const word = clean(rawWord);
      if (!word || word.length < 2) return null;

      if (memCache.has(word)) return memCache.get(word);

      try {
        const stored = await StorageCache.get(word);
        if (stored) {
          memCache.set(word, stored);
          return stored;
        }
      } catch (_) {
        /* storage unavailable, continue to network */
      }

      // 1. Try AI first — handles inflected forms and gives clean English.
      const aiResult = await AiClient.lookup(word);
      if (aiResult) {
        memCache.set(word, aiResult);
        StorageCache.set(word, aiResult).catch(() => {});
        return aiResult;
      }

      // 2. Fall back to Wiktionary — no key required, always available.
      // Try lowercase first, then capitalized (German nouns live under capital form on Wiktionary).
      const wiktForms = [word, word.charAt(0).toUpperCase() + word.slice(1)];
      for (const form of wiktForms) {
        try {
          const res = await fetch(
            "https://en.wiktionary.org/api/rest_v1/page/definition/" +
              encodeURIComponent(form)
          );
          if (!res.ok) continue;
          const data = await res.json();
          const entries = data.de || data.en;
          if (!entries || entries.length === 0) continue;

          const result = parseEntry(word, entries);
          result.source = "wiktionary";
          memCache.set(word, result);
          StorageCache.set(word, result).catch(() => {});
          return result;
        } catch (_) {
          continue;
        }
      }
      memCache.set(word, null);
      return null;
    }

    function parseEntry(word, entries) {
      const entry = entries[0];
      const pos = entry.partOfSpeech || "";

      let gender = "";
      if (pos === "Noun" || pos === "Proper noun") {
        const txt = (entry.definitions || [])
          .map((d) => d.definition)
          .join(" ")
          .toLowerCase();
        if (txt.includes("masculine")) gender = "der";
        else if (txt.includes("feminine")) gender = "die";
        else if (txt.includes("neuter")) gender = "das";
      }

      const definitions = (entry.definitions || [])
        .slice(0, 3)
        .map((d) => d.definition.replace(/<[^>]+>/g, ""));

      const exampleRaw = (entry.definitions || [])
        .flatMap((d) => d.parsedExamples || d.examples || [])
        .find(Boolean);
      const example = exampleRaw
        ? (typeof exampleRaw === "string" ? exampleRaw : exampleRaw.example || "")
            .replace(/<[^>]+>/g, "")
        : "";

      return { word, baseForm: word, pos, gender, definitions, example };
    }

    return { lookup, clean };
  })();

  // ───────────────────────── chrome.storage cache (24h TTL) ─────────────────
  const StorageCache = (() => {
    const TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
    const PREFIX = "gwc_cache_";

    function get(word) {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve(null);
        chrome.storage.local.get(PREFIX + word, (res) => {
          const entry = res[PREFIX + word];
          if (entry && Date.now() - entry.ts < TTL_MS) {
            resolve(entry.data);
          } else {
            resolve(null);
          }
        });
      });
    }

    function set(word, data) {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve();
        chrome.storage.local.set(
          { [PREFIX + word]: { data, ts: Date.now() } },
          resolve
        );
      });
    }

    return { get, set };
  })();

  // --- Vocab list (user-saved words) ---
  const VocabStore = (() => {
    const KEY = "gwc_vocab_list";

    function getAll() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve([]);
        chrome.storage.local.get(KEY, (res) => resolve(res[KEY] || []));
      });
    }

    async function add(entry) {
      const list = await getAll();
      if (list.some((w) => w.word === entry.word)) return list;
      const updated = [...list, { ...entry, savedAt: Date.now() }];
      return new Promise((resolve) => {
        chrome.storage.local.set({ [KEY]: updated }, () => resolve(updated));
      });
    }

    async function isSaved(word) {
      const list = await getAll();
      return list.some((w) => w.word === word);
    }

    return { getAll, add, isSaved };
  })();

  // ───────────────────────── Video controller ────────────────────────────────
  const VideoController = (() => {
    let pausedByUs = false;

    function getVideo() {
      return document.querySelector("video");
    }

    function pause() {
      const v = getVideo();
      if (v && !v.paused) {
        pausedByUs = true;
        v.pause();
      }
    }

    function resume() {
      if (!pausedByUs) return;
      pausedByUs = false;
      const v = getVideo();
      if (v) v.play().catch(() => {});
    }

    return { pause, resume };
  })();

  // --- Popup UI ---
  const Popup = (() => {
    let el = null;
    let activeSpan = null;
    let hideTimer = null;
    let visible = false;

    function isVisible() {
      return visible;
    }

    function ensure() {
      if (el) return el;
      el = document.createElement("div");
      el.id = "gwc-popup";
      el.innerHTML =
        '<div id="gwc-header">' +
          '<span id="gwc-word"></span>' +
          '<div id="gwc-actions">' +
            '<button id="gwc-save" title="Save to vocab list">&#9734;</button>' +
            '<button id="gwc-close" title="Close">&#10005;</button>' +
          "</div>" +
        "</div>" +
        '<div id="gwc-body">' +
          '<div id="gwc-loading">' +
            '<span class="gwc-spinner"></span> Looking up…' +
          "</div>" +
          '<div id="gwc-result" style="display:none">' +
            '<div id="gwc-meta"></div>' +
            '<div id="gwc-definitions"></div>' +
            '<div id="gwc-examples"></div>' +
            '<a id="gwc-more" target="_blank" rel="noopener">Full entry on Wiktionary ↗</a>' +
          "</div>" +
          '<div id="gwc-error" style="display:none">' +
            "No entry found. Try the base form — e.g. <em>laufen</em> instead of <em>gelaufen</em>." +
          "</div>" +
        "</div>";

      document.body.appendChild(el);

      // Hovering into the popup cancels the scheduled hide
      el.addEventListener("mouseenter", cancelHide);
      // Leaving the popup triggers a hide + video resume
      el.addEventListener("mouseleave", () => scheduleHide(true));

      el.querySelector("#gwc-close").addEventListener("click", () => hide(true));
      el.querySelector("#gwc-save").addEventListener("click", onSaveClick);
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hide(true);
      });

      return el;
    }

    let currentResult = null;

    async function onSaveClick() {
      if (!currentResult) return;
      await VocabStore.add(currentResult);
      const btn = el.querySelector("#gwc-save");
      btn.classList.add("gwc-saved");
      btn.textContent = "★"; // filled star
      btn.title = "Saved";
    }

    // scheduleHide: wait 250ms so the mouse can travel from word → popup.
    function scheduleHide(resumeVideo) {
      cancelHide();
      hideTimer = setTimeout(() => hide(resumeVideo), 250);
    }

    function cancelHide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function hide(resumeVideo) {
      cancelHide();
      visible = false;
      if (el) el.style.display = "none";
      if (activeSpan) {
        activeSpan.classList.remove("gwc-active");
        activeSpan = null;
      }
      if (resumeVideo) VideoController.resume();
    }

    function position(rect) {
      const popup = ensure();
      const margin = 12;
      let left = rect.left;
      let top = rect.top - popup.offsetHeight - margin;

      const vpW = window.innerWidth;
      if (left + 320 > vpW) left = vpW - 330;
      if (left < margin) left = margin;
      if (top < margin) top = rect.bottom + margin;

      popup.style.left = left + "px";
      popup.style.top = top + "px";
    }

    async function show(word, span) {
      cancelHide();
      const popup = ensure();
      if (activeSpan) activeSpan.classList.remove("gwc-active");
      activeSpan = span;
      span.classList.add("gwc-active");

      popup.querySelector("#gwc-word").textContent = word;
      popup.querySelector("#gwc-loading").style.display = "flex";
      popup.querySelector("#gwc-result").style.display = "none";
      popup.querySelector("#gwc-error").style.display = "none";
      const saveBtn = popup.querySelector("#gwc-save");
      saveBtn.classList.remove("gwc-saved");
      saveBtn.textContent = "☆"; // hollow star
      saveBtn.title = "Save to vocab list";

      popup.style.display = "block";
      visible = true;
      position(span.getBoundingClientRect());

      const result = await Dictionary.lookup(word);
      currentResult = result;

      if (!result) {
        popup.querySelector("#gwc-loading").style.display = "none";
        popup.querySelector("#gwc-error").style.display = "block";
        return;
      }

      render(result);
      const alreadySaved = await VocabStore.isSaved(result.word);
      if (alreadySaved) {
        saveBtn.classList.add("gwc-saved");
        saveBtn.textContent = "★";
      }

      // Reposition now that content has real height
      if (activeSpan) position(activeSpan.getBoundingClientRect());
    }

    function render(result) {
      const popup = ensure();
      const posClass = "gwc-pos-" + (result.pos || "").toLowerCase().replace(/\s/g, "-");
      popup.querySelector("#gwc-meta").innerHTML =
        '<span class="gwc-pos ' + posClass + '">' + escapeHtml(result.pos || "?") + "</span>" +
        (result.gender
          ? '<span class="gwc-gender gwc-gender-' + result.gender + '">' + result.gender + "</span>"
          : "") +
        (result.source === "ai"
          ? '<span class="gwc-source gwc-source-ai">AI</span>'
          : '<span class="gwc-source gwc-source-wiki">Wiktionary</span>');

      const baseFormNote =
        result.baseForm && result.baseForm.toLowerCase() !== result.word.toLowerCase()
          ? '<div class="gwc-baseform">base form: <strong>' + escapeHtml(result.baseForm) + "</strong></div>"
          : "";

      popup.querySelector("#gwc-definitions").innerHTML =
        baseFormNote +
        result.definitions
          .map(
            (d, i) =>
              '<div class="gwc-def"><span class="gwc-num">' + (i + 1) + "</span>" + escapeHtml(d) + "</div>"
          )
          .join("");

      popup.querySelector("#gwc-examples").innerHTML = result.example
        ? '<div class="gwc-example">“' + escapeHtml(result.example) + "”</div>"
        : "";

      popup.querySelector("#gwc-more").href =
        "https://en.wiktionary.org/wiki/" +
        encodeURIComponent(result.baseForm || result.word);

      popup.querySelector("#gwc-loading").style.display = "none";
      popup.querySelector("#gwc-result").style.display = "block";
    }

    function escapeHtml(str) {
      const d = document.createElement("div");
      d.textContent = str;
      return d.innerHTML;
    }

    return { show, hide, ensure, isVisible, scheduleHide, cancelHide };
  })();

  // ───────────────────────── Word wrapping ───────────────────────────────────
  const WordWrapper = (() => {
    function wrap(node) {
      if (
        node._gwcDone ||
        (node.classList && node.classList.contains("gwc-word")) ||
        !node.textContent ||
        !node.textContent.trim()
      ) return;

      const parts = node.textContent.split(/(\s+)/);
      if (parts.length <= 1) {
        wrapSingle(node, node.textContent);
        return;
      }

      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else if (part.length > 0) {
          frag.appendChild(makeSpan(part));
        }
      });

      node.textContent = "";
      node.appendChild(frag);
      node._gwcDone = true;
    }

    function wrapSingle(node, text) {
      const span = makeSpan(text);
      node.textContent = "";
      node.appendChild(span);
      node._gwcDone = true;
    }

    function makeSpan(text) {
      const span = document.createElement("span");
      span.textContent = text;
      span.className = "gwc-word";

      span.addEventListener("mouseenter", (e) => {
        e.stopPropagation();
        Popup.cancelHide();
        VideoController.pause();
        Popup.show(text, span);
      });

      span.addEventListener("mouseleave", () => {
        // Short grace period so mouse can travel into the popup
        Popup.scheduleHide(true);
      });

      return span;
    }

    return { wrap };
  })();

  // ───────────────────────── Subtitle watcher (perf-safe) ────────────────────
  const SubtitleWatcher = (() => {
    const SELECTORS = [
      ".ytp-caption-segment",
      ".captions-text",
      ".ytp-subtitle-segment",
      ".player-timedtext-text-container span",
      "[data-uia='player-timedtext'] span",
    ].join(",");

    let observer = null;
    let scheduled = false;
    const THROTTLE_MS = 400;

    function scan() {
      scheduled = false;
      // Don't touch the subtitle DOM while the popup is open — prevents
      // any mutation that could cause YouTube to rescale the caption layer.
      if (Popup.isVisible()) return;

      let nodes;
      try {
        nodes = document.querySelectorAll(SELECTORS);
      } catch (_) {
        return;
      }
      nodes.forEach((node) => {
        // Never re-wrap our own gwc-word spans
        if (node.classList && node.classList.contains("gwc-word")) return;
        if (node.children.length === 0) {
          WordWrapper.wrap(node);
        } else {
          node.querySelectorAll("*").forEach((child) => {
            if (
              child.children.length === 0 &&
              !child.classList.contains("gwc-word")
            ) {
              WordWrapper.wrap(child);
            }
          });
        }
      });
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(scan, THROTTLE_MS);
    }

    function findPlayerRoot() {
      return (
        document.querySelector("#movie_player") ||
        document.querySelector(".html5-video-player") ||
        document.querySelector("[data-uia='player']") ||
        document.querySelector(".NFPlayer") ||
        document.body
      );
    }

    function start() {
      if (observer) observer.disconnect();
      const root = findPlayerRoot();
      observer = new MutationObserver(schedule);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false,
      });
      scan();
    }

    function stop() {
      if (observer) observer.disconnect();
      observer = null;
    }

    return { start, stop };
  })();

  // --- Init + SPA navigation ---
  function init() {
    Popup.ensure();
    SubtitleWatcher.start();
  }

  let lastHref = location.href;
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      SubtitleWatcher.stop();
      setTimeout(init, 2000); // wait for new player to mount
    }
  });
  navObserver.observe(document.querySelector("head") || document.documentElement, {
    childList: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
