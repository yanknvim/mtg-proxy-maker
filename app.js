const SCRYFALL_NAMED_ENDPOINT = "https://api.scryfall.com/cards/named";
const REQUEST_DELAY_MS = 110;

const state = {
  cards: [],
  pdfBlobUrl: null,
};

const decklistInput = document.getElementById("decklist");
const previewButton = document.getElementById("previewButton");
const downloadButton = document.getElementById("downloadButton");
const statusMessage = document.getElementById("statusMessage");
const previewGrid = document.getElementById("previewGrid");
const previewPlaceholder = document.getElementById("previewPlaceholder");
const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const themeToggle = document.getElementById("themeToggle");

previewButton.addEventListener("click", () => buildPreview());
downloadButton.addEventListener("click", () => downloadPdf());
themeToggle.addEventListener("click", () => toggleTheme());

// テーマ初期化
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  themeToggle.textContent = savedTheme === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  themeToggle.textContent = next === "dark" ? "☀️" : "🌙";
}

initTheme();

function setStatus(text, type = "info") {
  statusMessage.textContent = text;
  statusMessage.className = `status ${type}`;
}

function setProgress(percent, text) {
  progressContainer.classList.remove("hidden");
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text || `${Math.round(percent)}%`;
}

function hideProgress() {
  progressContainer.classList.add("hidden");
  progressFill.style.width = "0%";
}

function parseDecklist(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const count = Number(match[1]);
      const name = match[2].trim();
      if (count > 0 && name) {
        entries.push({ count, name });
      }
    }
  }
  return entries;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractImageUrls(cardJson) {
  const urls = { front: null, back: null };

  if (cardJson.image_uris?.large) {
    urls.front = cardJson.image_uris.large;
  } else if (Array.isArray(cardJson.card_faces) && cardJson.card_faces.length > 0) {
    const [face1, face2] = cardJson.card_faces;
    if (face1?.image_uris?.large) {
      urls.front = face1.image_uris.large;
    }
    if (face2?.image_uris?.large) {
      urls.back = face2.image_uris.large;
    }
  }

  return urls;
}

async function fetchCard(name) {
  const response = await fetch(`${SCRYFALL_NAMED_ENDPOINT}?fuzzy=${encodeURIComponent(name)}`);
  if (!response.ok) {
    throw new Error(`Scryfall応答コード ${response.status}`);
  }
  return response.json();
}

async function buildPreview() {
  revokePdfUrl();
  previewGrid.innerHTML = "";
  previewGrid.classList.add("empty");
  previewPlaceholder.style.display = "";
  downloadButton.disabled = true;
  setStatus("デッキリストを解析中...", "info");

  const entries = parseDecklist(decklistInput.value);
  if (entries.length === 0) {
    setStatus("有効なカード行が見つかりませんでした。フォーマットを確認してください。", "error");
    return;
  }

  setStatus(`${entries.length} 種のカードを取得中...`, "info");
  const collected = [];
  let processedNames = 0;

  for (const entry of entries) {
    try {
      const json = await fetchCard(entry.name);
      const urls = extractImageUrls(json);
      const displayName = json.name ?? entry.name;

      for (let i = 0; i < entry.count; i += 1) {
        if (urls.front) {
          collected.push({ name: displayName, side: "表面", url: urls.front });
        }
        if (urls.back) {
          collected.push({ name: displayName, side: "裏面", url: urls.back });
        }
      }
      processedNames += 1;
      setStatus(`${processedNames}/${entries.length} 種を取得中...`, "info");
    } catch (error) {
      console.error(`${entry.name} の取得に失敗:`, error);
      setStatus(`${entry.name} の取得に失敗しました: ${error.message}`, "error");
      return;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (collected.length === 0) {
    setStatus("カード画像を取得できませんでした。", "error");
    return;
  }

  state.cards = collected;
  renderPreview(collected);
  setStatus(`${collected.length} 枚のカードを準備しました。必要に応じてPDFをダウンロードできます。`, "success");
  downloadButton.disabled = false;
}

function renderPreview(cards) {
  previewGrid.innerHTML = "";
  if (cards.length === 0) {
    previewGrid.classList.add("empty");
    previewPlaceholder.style.display = "";
    return;
  }

  previewPlaceholder.style.display = "none";
  previewGrid.classList.remove("empty");

  for (const card of cards) {
    const figure = document.createElement("figure");
    figure.className = "preview-item";

    const img = document.createElement("img");
    img.src = card.url;
    img.alt = `${card.name} - ${card.side}`;
    img.loading = "lazy";

    const caption = document.createElement("figcaption");
    const nameSpan = document.createElement("span");
    nameSpan.className = "card-name";
    nameSpan.textContent = card.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = card.side;

    caption.append(nameSpan, badge);
    figure.append(img, caption);
    previewGrid.append(figure);
  }
}

function revokePdfUrl() {
  if (state.pdfBlobUrl) {
    URL.revokeObjectURL(state.pdfBlobUrl);
    state.pdfBlobUrl = null;
  }
}

function downloadPdf() {
  if (state.cards.length === 0) {
    setStatus("先にプレビューを作成してください。", "error");
    return;
  }

  setStatus("PDFを生成中...", "info");

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const cardWidth = 63;
  const cardHeight = 88;
  const columns = 3;
  const rows = 3;
  const cardsPerPage = columns * rows;
  const horizontalGap = (pageWidth - 2 * margin - columns * cardWidth) / (columns - 1);
  const verticalGap = (pageHeight - 2 * margin - rows * cardHeight) / (rows - 1);

  let indexOnPage = 0;
  let pages = 1;
  const addPageIfNeeded = () => {
    if (indexOnPage >= cardsPerPage) {
      pdf.addPage();
      pages += 1;
      indexOnPage = 0;
    }
  };

  const drawCard = async (card) => {
    addPageIfNeeded();
    const column = indexOnPage % columns;
    const row = Math.floor(indexOnPage / columns);
    const x = margin + column * (cardWidth + horizontalGap);
    const y = margin + row * (cardHeight + verticalGap);

    const image = await loadImageAsDataURL(card.url);
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y, cardWidth, cardHeight);
    pdf.addImage(image, "JPEG", x, y, cardWidth, cardHeight);
    indexOnPage += 1;
  };

  (async () => {
    try {
      const total = state.cards.length;
      setProgress(0, `0 / ${total} 枚`);

      for (let i = 0; i < total; i++) {
        await drawCard(state.cards[i]);
        const percent = ((i + 1) / total) * 100;
        setProgress(percent, `${i + 1} / ${total} 枚`);
      }

      const blob = pdf.output("blob");
      revokePdfUrl();
      state.pdfBlobUrl = URL.createObjectURL(blob);
      triggerDownload(state.pdfBlobUrl, "mtg-proxy.pdf");
      hideProgress();
      setStatus(`PDFを生成しました（${pages} ページ / ${total} 枚）。`, "success");
    } catch (error) {
      console.error("PDF生成に失敗:", error);
      hideProgress();
      setStatus(`PDF生成に失敗しました: ${error.message}`, "error");
    }
  })();
}

function triggerDownload(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function loadImageAsDataURL(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`画像取得に失敗 (${response.status})`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(blob);
  });
}
