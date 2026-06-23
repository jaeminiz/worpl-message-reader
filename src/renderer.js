const startUrl = document.querySelector("#startUrl");
const keyword = document.querySelector("#keyword");
const maxReads = document.querySelector("#maxReads");
const openChromeButton = document.querySelector("#openChrome");
const previewButton = document.querySelector("#preview");
const runButton = document.querySelector("#run");
const pauseButton = document.querySelector("#pause");
const openOutputButton = document.querySelector("#openOutput");
const chromeStatus = document.querySelector("#chromeStatus");
const summary = document.querySelector("#summary");
const rows = document.querySelector("#rows");
const outputPath = document.querySelector("#outputPath");
const appVersion = document.querySelector("#appVersion");

let lastOutputPath = "";
let isRunning = false;
rows.dataset.count = "0";

function getMode() {
  return document.querySelector("input[name='mode']:checked")?.value || "keyword-new";
}

function getOptions() {
  return {
    mode: getMode(),
    keyword: keyword.value.trim(),
    inboxUrl: startUrl.value.trim(),
    maxReads: Number(maxReads.value || "20")
  };
}

function setBusy(isBusy) {
  openChromeButton.disabled = isBusy;
  previewButton.disabled = isBusy;
  runButton.disabled = isBusy || rows.dataset.count === "0";
  pauseButton.disabled = !isRunning;
}

function showError(target, message) {
  target.textContent = message;
  target.classList.add("error");
}

function showStatus(target, message) {
  target.textContent = message;
  target.classList.remove("error");
}

function renderRows(messages) {
  rows.dataset.count = String(messages.length);
  runButton.disabled = messages.length === 0;

  if (messages.length === 0) {
    rows.innerHTML = '<tr><td colspan="5" class="empty">표시할 쪽지가 없습니다.</td></tr>';
    return;
  }

  rows.innerHTML = messages
    .map(
      (message, index) => `<tr>
        <td>${message.sequence}</td>
        <td>${escapeHtml(message.author || message.category)}</td>
        <td>${escapeHtml(message.title)}</td>
        <td>${escapeHtml(message.date)}</td>
        <td><button class="link-button" data-preview-index="${index}" type="button">${escapeHtml(message.link)}</button></td>
      </tr>`
    )
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

openChromeButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await window.worplReader.openChrome(startUrl.value.trim());
    showStatus(chromeStatus, `Chrome 열림: ${result.url}`);
  } catch (error) {
    showError(chromeStatus, error.message || "Chrome을 열 수 없습니다.");
  } finally {
    setBusy(false);
  }
});

previewButton.addEventListener("click", async () => {
  const options = getOptions();
  if (options.mode === "keyword-new" && !options.keyword) {
    showError(summary, "키워드 신규만 모드에서는 제목 키워드를 입력하세요.");
    return;
  }

  setBusy(true);
  try {
    const result = await window.worplReader.preview(options);
    renderRows(result.messages);
    showStatus(
      summary,
      `${result.count}건 대상. WORPL 신규 ${result.unreadBadgeCount || 0}건, 제목 후보 ${result.candidateCount || 0}건, 신규 후보 ${result.newCandidateCount || 0}건. 현재 페이지: ${result.url}`
    );
  } catch (error) {
    renderRows([]);
    showError(summary, error.message || "미리보기에 실패했습니다.");
  } finally {
    setBusy(false);
  }
});

runButton.addEventListener("click", async () => {
  if (rows.dataset.count === "0") return;
  if (!window.confirm("미리보기 대상 쪽지를 실제로 클릭해 읽음 처리합니다. 실행할까요?")) {
    return;
  }

  setBusy(true);
  isRunning = true;
  pauseButton.disabled = false;
  try {
    const result = await window.worplReader.run(getOptions());
    lastOutputPath = result.outputPath;
    const message = result.completionMessage || `쪽지 읽기 ${result.count}건 완료`;
    renderRows(result.messages || []);
    showStatus(summary, message);
    showStatus(outputPath, result.outputPath);
    openOutputButton.disabled = false;
    window.alert(message);
  } catch (error) {
    showError(summary, error.message || "읽음 처리 실행에 실패했습니다.");
  } finally {
    isRunning = false;
    setBusy(false);
  }
});

pauseButton.addEventListener("click", async () => {
  pauseButton.disabled = true;
  try {
    await window.worplReader.pause();
    showStatus(summary, "일시정지 요청됨. 현재 쪽지 처리가 끝나면 읽은 쪽지만 저장하고 멈춥니다.");
  } catch (error) {
    showError(summary, error.message || "일시정지 요청에 실패했습니다.");
  }
});

rows.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.previewIndex) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.worplReader.openPreviewMessage(Number(target.dataset.previewIndex), getOptions());
    showStatus(summary, `쪽지 링크 열림: ${result.title}`);
  } catch (error) {
    showError(summary, error.message || "쪽지 링크를 열 수 없습니다.");
  } finally {
    setBusy(false);
  }
});

openOutputButton.addEventListener("click", async () => {
  if (lastOutputPath) {
    await window.worplReader.openPath(lastOutputPath);
  }
});

document.querySelectorAll("input[name='mode']").forEach((input) => {
  input.addEventListener("change", () => {
    renderRows([]);
    showStatus(summary, "조건이 변경되었습니다. 다시 미리보기를 실행하세요.");
  });
});

keyword.addEventListener("input", () => {
  renderRows([]);
  showStatus(summary, "키워드가 변경되었습니다. 다시 미리보기를 실행하세요.");
});

maxReads.addEventListener("input", () => {
  showStatus(summary, "읽을 수량이 변경되었습니다. 실행 시 새 수량이 적용됩니다.");
});

window.worplReader
  .getVersion()
  .then((version) => {
    appVersion.textContent = `v${version}`;
  })
  .catch(() => {
    appVersion.textContent = "버전 확인 불가";
  });
