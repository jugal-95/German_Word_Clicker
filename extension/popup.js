/**
 * popup.js — toolbar popup logic.
 * Shows two tabs: "How it works" and "Saved words" (the user's vocab list,
 * persisted in chrome.storage.local by content.js's VocabStore).
 */

const VOCAB_KEY = "gwc_vocab_list";

function updateAiStatusBadge() {
  const badge = document.getElementById("ai-status-badge");
  const configured =
    typeof GWC_CONFIG !== "undefined" &&
    GWC_CONFIG.GEMINI_API_KEY &&
    GWC_CONFIG.GEMINI_API_KEY !== "PASTE_YOUR_KEY_HERE";

  if (configured) {
    badge.textContent = "on";
    badge.className = "badge-on";
  } else {
    badge.textContent = "off — using Wiktionary";
    badge.className = "badge-off";
  }
}

function getVocab() {
  return new Promise((resolve) => {
    chrome.storage.local.get(VOCAB_KEY, (res) => resolve(res[VOCAB_KEY] || []));
  });
}

function setVocab(list) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [VOCAB_KEY]: list }, resolve);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function renderVocab() {
  const list = await getVocab();
  const container = document.getElementById("vocab-list");
  const empty = document.getElementById("empty-state");
  const footer = document.getElementById("footer");
  const count = document.getElementById("count");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.style.display = "block";
    footer.style.display = "none";
    return;
  }

  empty.style.display = "none";
  footer.style.display = "flex";
  count.textContent = list.length + (list.length === 1 ? " word" : " words");

  const sorted = [...list].sort((a, b) => b.savedAt - a.savedAt);

  container.innerHTML = sorted
    .map(
      (item) => `
      <div class="vocab-item" data-word="${escapeHtml(item.word)}">
        <div>
          <div class="vocab-word-row">
            <span class="vocab-word">${escapeHtml(item.word)}</span>
            ${item.gender ? `<span class="vocab-gender">${item.gender}</span>` : ""}
          </div>
          <div class="vocab-def">${escapeHtml((item.definitions && item.definitions[0]) || "")}</div>
        </div>
        <button class="vocab-remove" title="Remove" data-word="${escapeHtml(item.word)}">&#10005;</button>
      </div>`
    )
    .join("");

  container.querySelectorAll(".vocab-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const word = e.currentTarget.dataset.word;
      const current = await getVocab();
      await setVocab(current.filter((w) => w.word !== word));
      renderVocab();
    });
  });
}

function exportCsv() {
  getVocab().then((list) => {
    if (list.length === 0) return;
    const rows = [["word", "part of speech", "gender", "definition", "example", "saved at"]];
    list.forEach((item) => {
      rows.push([
        item.word,
        item.pos || "",
        item.gender || "",
        (item.definitions && item.definitions[0]) || "",
        item.example || "",
        new Date(item.savedAt).toISOString().slice(0, 10),
      ]);
    });
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "german-vocab.csv";
    a.click();
    URL.revokeObjectURL(url);
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    document.getElementById("panel-status").style.display = target === "status" ? "block" : "none";
    document.getElementById("panel-vocab").style.display = target === "vocab" ? "block" : "none";
    if (target === "vocab") renderVocab();
  });
});

document.getElementById("export-btn").addEventListener("click", exportCsv);

updateAiStatusBadge();
renderVocab();
