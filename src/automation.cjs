const fs = require("node:fs");
const { chromium } = require("playwright-core");
const { completionMessage } = require("./app-messages.cjs");
const { DEFAULT_INBOX_URL, filterMessages } = require("./message-parser.cjs");
const { buildSheetName, defaultOutputPath, writeMessagesWorkbook } = require("./excel-writer.cjs");
const { buildRunLogPath, writeRunErrorLog } = require("./run-logger.cjs");
const { collectMessagesAcrossPages, messageKey, normalizeRunOptions, sameMessage, shouldWriteCheckpoint } = require("./run-state.cjs");

const NAVIGATION_TIMEOUT_MS = 500000;
const LOAD_STATE_TIMEOUT_MS = 30000;
const QUICK_LOAD_STATE_TIMEOUT_MS = 10000;

class WorplMessageAutomation {
  constructor({ profileDir }) {
    this.profileDir = profileDir;
    this.context = null;
    this.lastPreview = [];
    this.lastPreviewResult = null;
    this.lastPreviewOptions = null;
    this.pauseRequested = false;
  }

  async openChrome(startUrl = DEFAULT_INBOX_URL, options = {}) {
    if (this.context && !this.isContextUsable()) {
      this.context = null;
      this.lastPreview = [];
      this.lastPreviewResult = null;
      this.lastPreviewOptions = null;
    }

    if (this.context) {
      const page = await this.getActivePage();
      await page.bringToFront();
      return { url: page.url() };
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      channel: "chrome",
      headless: false,
      viewport: null,
      args: ["--start-maximized"]
    });

    const page = await this.getActivePage();
    if (page.url() === "about:blank") {
      const runOptions = normalizeRunOptions(options);
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) });
    }

    return { url: page.url() };
  }

  async getActivePage() {
    if (!this.context) {
      throw new Error("Chrome을 먼저 여세요.");
    }

    if (!this.isContextUsable()) {
      this.context = null;
      this.lastPreview = [];
      this.lastPreviewResult = null;
      this.lastPreviewOptions = null;
      throw new Error("Chrome 창이 닫혔습니다. Chrome 열기를 다시 눌러주세요.");
    }

    const pages = this.context.pages().filter((page) => !page.isClosed());
    const inboxPage = [...pages].reverse().find((page) => /class=Message|\/messages/i.test(page.url()));
    return inboxPage || pages[pages.length - 1] || (await this.context.newPage());
  }

  isContextUsable() {
    if (!this.context) {
      return false;
    }

    try {
      this.context.pages();
      return true;
    } catch {
      return false;
    }
  }

  async preview(options = {}) {
    const page = await this.getActivePage();
    const runOptions = normalizeRunOptions(options);
    await this.ensureInboxPage(page, options.inboxUrl || DEFAULT_INBOX_URL, runOptions);
    await this.applyKeywordSearch(page, options);
    const pageResults = [];
    const visitedPages = new Set();

    for (let pageIndex = 0; pageIndex < runOptions.maxScanPages; pageIndex += 1) {
      const currentPageResult = await this.previewCurrentPage(page, options);
      pageResults.push(currentPageResult);
      const collected = collectMessagesAcrossPages(pageResults, runOptions);

      if (collected.count >= runOptions.maxReads || !currentPageResult.nextPage) {
        break;
      }

      const nextPageKey = this.nextPageKey(currentPageResult.nextPage, currentPageResult.url, pageIndex);
      if (!nextPageKey || visitedPages.has(nextPageKey)) {
        break;
      }
      visitedPages.add(nextPageKey);

      const moved = await this.gotoNextInboxPage(page, currentPageResult.nextPage, runOptions);
      if (!moved) {
        break;
      }
    }

    const result = collectMessagesAcrossPages(pageResults, runOptions);
    this.lastPreview = result.messages;
    this.lastPreviewResult = result;
    this.lastPreviewOptions = {
      mode: options.mode || "",
      keyword: String(options.keyword || "").trim()
    };

    return result;
  }

  async previewCurrentPage(page, options = {}) {
    await page.waitForLoadState("domcontentloaded", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    const frameSnapshots = [];

    for (const frame of page.frames()) {
      const snapshot = await frame
        .evaluate(() => {
          const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
          const toAbsoluteHref = (href) => {
            if (!href) return "";
            if (/^javascript:/i.test(href)) return href;
            try {
              return new URL(href, location.href).href;
            } catch {
              return href;
            }
          };
          const rows = Array.from(document.querySelectorAll("tr"));
          const anchors = Array.from(document.querySelectorAll("a"));
          const pageText = normalize(document.body?.textContent || "");
          const unreadMatches = Array.from(pageText.matchAll(/쪽지함\s*\((\d+)\)/g)).map((match) => Number(match[1]));
          const selectedCategory =
            document.querySelector("input[name='show']:checked, input[name='type']:checked, select[name='show'], select[name='type']")?.value || "";
          const nextLink = anchors
            .map((link) => {
              const href = link.getAttribute("href") || "";
              const onclick = link.getAttribute("onclick") || "";
              const text = normalize(link.textContent);
              const label = normalize(`${text} ${link.getAttribute("aria-label") || ""} ${link.getAttribute("title") || ""}`);

              return {
                href,
                onclick,
                absoluteHref: toAbsoluteHref(href),
                text,
                label
              };
            })
            .find((link) => {
              if (!link.href && !link.onclick) return false;
              if (/delete|del|edit|write|sms|schedule_edit|user_group|삭제|전송|저장/i.test(`${link.href} ${link.onclick} ${link.text}`)) {
                return false;
              }
              return /(^|\s)(다음|next|>|›|»)(\s|$)/i.test(link.label);
            });

          return {
            url: location.href,
            fallbackCategory: selectedCategory,
            unreadBadgeCount: unreadMatches.length ? Math.max(...unreadMatches) : 0,
            nextPage: nextLink
              ? {
                  href: nextLink.absoluteHref || nextLink.href,
                  clickKey: nextLink.href || nextLink.onclick || nextLink.text,
                  text: nextLink.text,
                  frameUrl: location.href
                }
              : null,
            rows: rows.map((row) => {
              const cells = Array.from(row.querySelectorAll("th,td")).map((cell) => normalize(cell.textContent));
              const isRowCellText = (cell) =>
                cell &&
                !/^(선택|작성자|제목|date)$/i.test(cell) &&
                !/\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|am|pm/i.test(cell) &&
                !/function\s|class=|action=|ajax|javascript:/i.test(cell);
              const rawLinks = Array.from(row.querySelectorAll("a"));
              const links = rawLinks.map((link, index) => {
                const href = link.getAttribute("href") || "";
                const onclick = link.getAttribute("onclick") || "";
                const text = normalize(link.textContent);

                return {
                  index,
                  href,
                  onclick,
                  absoluteHref: toAbsoluteHref(href),
                  text
                };
              });
              const isUnsafe = (link) => /delete|del|edit|write|sms|schedule_edit|user_group|삭제|전송|저장/i.test(`${link.href} ${link.onclick} ${link.text}`);
              const messageLink =
                links.find((link) => link.text && /class=Message|action=(view|read|detail)|message/i.test(`${link.absoluteHref} ${link.onclick}`) && !isUnsafe(link)) ||
                links.find((link) => link.text && !isUnsafe(link));
              const linkCellIndex = messageLink
                ? Array.from(row.querySelectorAll("th,td")).findIndex((cell) => cell.contains(rawLinks[messageLink.index]))
                : -1;
              const date = [...cells].reverse().find((cell) => /\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|am|pm/i.test(cell)) || "";
              const author = linkCellIndex > 0 ? [...cells.slice(0, linkCellIndex)].reverse().find(isRowCellText) || "" : "";
              const titleCell = linkCellIndex >= 0 ? Array.from(row.querySelectorAll("th,td"))[linkCellIndex] : null;
              const isRedText = (element) => {
                const color = getComputedStyle(element).color || "";
                const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                if (rgb) {
                  return Number(rgb[1]) >= 150 && Number(rgb[2]) <= 90 && Number(rgb[3]) <= 90;
                }
                return /(^|\s)(red|#f00|#ff0000)(\s|$)/i.test(color);
              };
              const redNewMarker = titleCell
                ? Array.from(titleCell.querySelectorAll("*")).some((element) => normalize(element.textContent).toLowerCase() === "new" && isRedText(element))
                : false;

              return {
                date,
                author,
                title: messageLink?.text || "",
                link: messageLink?.absoluteHref || messageLink?.href || "",
                clickKey: messageLink?.href || messageLink?.onclick || messageLink?.text || "",
                frameUrl: location.href,
                isNew: redNewMarker
              };
            })
          };
        })
        .catch(() => null);

      if (snapshot) {
        frameSnapshots.push(snapshot);
      }
    }

    const snapshot = {
      url: page.url(),
      fallbackCategory: frameSnapshots.find((item) => item.fallbackCategory)?.fallbackCategory || "",
      unreadBadgeCount: Math.max(0, ...frameSnapshots.map((item) => item.unreadBadgeCount || 0)),
      nextPage: frameSnapshots.find((item) => item.nextPage)?.nextPage || null,
      rows: frameSnapshots.flatMap((item) => item.rows.map((row) => ({ ...row, frameUrl: row.frameUrl || item.url })))
    };

    const messages =
      snapshot.unreadBadgeCount === 0
        ? []
        : filterMessages(snapshot.rows, {
            mode: options.mode,
            keyword: options.keyword,
            fallbackCategory: snapshot.fallbackCategory
          });
    const candidateCount = snapshot.rows.filter((row) => row.title && row.link).length;
    const newCandidateCount = snapshot.rows.filter((row) => row.title && row.link && row.isNew).length;

    return {
      url: snapshot.url,
      count: messages.length,
      candidateCount,
      newCandidateCount,
      unreadBadgeCount: snapshot.unreadBadgeCount,
      nextPage: snapshot.nextPage,
      messages: messages.map((message) => ({ ...message, pageUrl: snapshot.url })),
      candidates: snapshot.rows
        .filter((row) => row.title && row.link)
        .map((message, index) => ({ ...message, sequence: index + 1, pageUrl: snapshot.url }))
    };
  }

  async applyKeywordSearch(page, options = {}) {
    const keyword = String(options.keyword || "").trim();
    if (options.mode !== "keyword-new" || !keyword) {
      return { searched: false };
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});

    for (const frame of page.frames()) {
      const result = await frame
        .evaluate(async (searchKeyword) => {
          const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
          const textInputs = Array.from(
            document.querySelectorAll("input:not([type]), input[type='text'], input[type='search']")
          );
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const scoreInput = (input) => {
            const descriptor = normalize(
              [
                input.id,
                input.name,
                input.placeholder,
                input.title,
                input.getAttribute("aria-label"),
                input.closest("form")?.textContent
              ].join(" ")
            ).toLowerCase();
            let score = visible(input) ? 1 : -100;
            if (/검색|search|find|keyword|키워드/.test(descriptor)) score += 10;
            if (input.value && input.value === searchKeyword) score += 4;
            if (input.type === "search") score += 2;
            if (input.closest("form")) score += 2;
            return score;
          };
          const searchInput = textInputs
            .map((input) => ({ input, score: scoreInput(input) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.input;

          if (!searchInput) {
            return { searched: false, reason: "검색 입력칸을 찾지 못했습니다." };
          }

          searchInput.focus();
          searchInput.value = searchKeyword;
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          searchInput.dispatchEvent(new Event("change", { bubbles: true }));

          const form = searchInput.closest("form");
          const nearby = form || searchInput.parentElement || document;
          const buttons = Array.from(nearby.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
          const searchButton = buttons.find((button) => {
            const label = normalize(
              [
                button.textContent,
                button.value,
                button.getAttribute("aria-label"),
                button.getAttribute("title"),
                button.querySelector("img")?.getAttribute("alt")
              ].join(" ")
            );
            return /검색|search|찾기|🔍/.test(label);
          });

          if (searchButton) {
            searchButton.click();
            return { searched: true, method: "button" };
          }

          if (form) {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.submit();
            }
            return { searched: true, method: "form" };
          }

          searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
          searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
          return { searched: true, method: "enter" };
        }, keyword)
        .catch((error) => ({ searched: false, reason: error.message }));

      if (result.searched) {
        await page.waitForLoadState("domcontentloaded", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(700);
        return result;
      }
    }

    return { searched: false, reason: "검색 입력칸을 찾지 못했습니다." };
  }

  async readVisibleMessages(options = {}) {
    const page = await this.getActivePage();
    const inboxUrl = options.inboxUrl || DEFAULT_INBOX_URL;
    const runOptions = normalizeRunOptions(options);
    this.pauseRequested = false;
    const maxReads = runOptions.maxReads;
    const readMessages = [];
    const sheetName = buildSheetName({ mode: options.mode, keyword: options.keyword, maxReads });
    const outputPath = options.outputPath || defaultOutputPath(new Date(), sheetName);
    const processedKeys = new Set();
    let expectedCount = 0;

    try {
      const firstPreview = this.reusablePreview(options, maxReads) || (await this.previewRunBatch(options, runOptions, maxReads, true));

      if (firstPreview.messages.length === 0) {
        throw new Error("읽음 처리할 신규 쪽지가 없습니다. 먼저 미리보기를 확인하세요.");
      }

      expectedCount = this.expectedReadCount(firstPreview, options, maxReads);
      let currentPreview = firstPreview;

      while (readMessages.length < maxReads) {
        if (this.pauseRequested) {
          break;
        }

        if (!currentPreview) {
          await this.ensureInboxPage(page, inboxUrl, runOptions);
          currentPreview = await this.previewRunBatch(options, runOptions, maxReads - readMessages.length, false);
          expectedCount = Math.max(expectedCount, Math.min(maxReads, readMessages.length + currentPreview.count));
        }

        if (currentPreview.unreadBadgeCount === 0) {
          break;
        }

        const messages = currentPreview.messages.filter((candidate) => !processedKeys.has(this.messageKey(candidate)));

        if (messages.length === 0) {
          break;
        }

        for (const message of messages) {
          if (this.pauseRequested || readMessages.length >= maxReads) {
            break;
          }

          await this.clickMessageWithSearchRetry(page, message, options, runOptions);
          processedKeys.add(this.messageKey(message));
          readMessages.push(message);

          if (shouldWriteCheckpoint(readMessages.length, runOptions.checkpointEvery)) {
            await this.writeRunWorkbook(readMessages, outputPath, sheetName, {
              expectedCount,
              paused: false
            });
          }
        }

        currentPreview = null;
      }

      return await this.finishRun(readMessages, outputPath, sheetName, expectedCount);
    } catch (error) {
      if (/읽음 처리할 신규 쪽지가 없습니다/.test(error.message || "")) {
        this.pauseRequested = false;
        throw error;
      }

      const savedOutputPath = await this.writeRunWorkbook(readMessages, outputPath, sheetName, {
        expectedCount,
        paused: false,
        reason: `오류가 발생하여 중단했습니다. 실제로 읽은 ${readMessages.length}건만 기록했습니다.`
      });
      const logPath = await writeRunErrorLog({
        logPath: buildRunLogPath(outputPath),
        error,
        options,
        runOptions,
        readMessages,
        outputPath: savedOutputPath,
        expectedCount,
        pageUrl: typeof page.url === "function" ? page.url() : ""
      });
      this.lastPreview = [];
      this.lastPreviewResult = null;
      this.lastPreviewOptions = null;
      this.pauseRequested = false;
      throw new Error(
        `읽음 처리 중 오류가 발생했습니다. 실제로 읽은 ${readMessages.length}건은 엑셀에 저장했습니다: ${savedOutputPath}. 오류 로그: ${logPath}. 원인: ${error.message}`
      );
    }
  }

  async finishRun(readMessages, outputPath, sheetName, expectedCount) {
    const recordedMessages = readMessages.map((message, index) => ({ ...message, sequence: index + 1 }));
    const paused = this.pauseRequested;
    const skippedCount = Math.max(0, expectedCount - recordedMessages.length);
    const runSummary =
      paused
        ? {
            expectedCount,
            recordedCount: recordedMessages.length,
            skippedCount,
            reason: "사용자가 일시정지하여 실제로 읽은 쪽지만 기록했습니다."
          }
        : skippedCount > 0
        ? {
            expectedCount,
            recordedCount: recordedMessages.length,
            skippedCount,
            reason: "중복 또는 동시 읽음으로 목록에서 사라진 쪽지가 있어 실제 클릭한 쪽지만 기록했습니다."
          }
        : null;
    const savedOutputPath = await writeMessagesWorkbook(recordedMessages, outputPath, {
      sheetName,
      runSummary
    });
    this.lastPreview = [];
    this.lastPreviewResult = null;
    this.lastPreviewOptions = null;
    this.pauseRequested = false;
    const messageStats = {
      recordedCount: recordedMessages.length,
      expectedCount,
      skippedCount,
      paused
    };

    return {
      count: recordedMessages.length,
      expectedCount,
      skippedCount,
      paused,
      completionMessage: completionMessage(messageStats),
      outputPath: savedOutputPath,
      messages: recordedMessages
    };
  }

  async previewRunBatch(options, runOptions, remainingReads, allowDeepScan) {
    const pageLimit = Math.max(1, Number(remainingReads || 1));
    const firstPagePreview = await this.preview({
      ...options,
      maxReads: pageLimit,
      maxScanPages: 1
    });

    if (firstPagePreview.messages.length > 0 || !allowDeepScan || runOptions.maxScanPages <= 1) {
      return firstPagePreview;
    }

    return this.preview({
      ...options,
      maxReads: pageLimit,
      maxScanPages: runOptions.maxScanPages
    });
  }

  reusablePreview(options, maxReads) {
    if (!this.lastPreview.length) {
      return null;
    }

    const expectedMode = options.mode || "";
    const expectedKeyword = String(options.keyword || "").trim();
    if (
      this.lastPreviewOptions &&
      (this.lastPreviewOptions.mode !== expectedMode || this.lastPreviewOptions.keyword !== expectedKeyword)
    ) {
      return null;
    }

    const messages = this.lastPreview.slice(0, maxReads).map((message, index) => ({
      ...message,
      sequence: index + 1
    }));

    return {
      ...(this.lastPreviewResult || {}),
      count: messages.length,
      unreadBadgeCount: Math.max(messages.length, Number(this.lastPreviewResult?.unreadBadgeCount || 0)),
      messages
    };
  }

  async writeRunWorkbook(readMessages, outputPath, sheetName, options = {}) {
    const recordedMessages = readMessages.map((message, index) => ({ ...message, sequence: index + 1 }));
    const skippedCount = Math.max(0, Number(options.expectedCount || 0) - recordedMessages.length);
    return writeMessagesWorkbook(recordedMessages, outputPath, {
      sheetName,
      runSummary: {
        expectedCount: options.expectedCount || recordedMessages.length,
        recordedCount: recordedMessages.length,
        skippedCount,
        reason: options.reason || (options.paused
          ? "사용자가 일시정지하여 실제로 읽은 쪽지만 기록했습니다."
          : "중간 저장 파일입니다. 실행이 끝나면 최종 결과로 다시 저장됩니다.")
      }
    });
  }

  async clickMessageWithSearchRetry(page, message, options, runOptions) {
    try {
      await this.clickMessage(page, message, runOptions);
      return message;
    } catch (error) {
      if (!/쪽지 링크를 찾을 수 없습니다/.test(error.message || "")) {
        throw error;
      }
    }

    const refreshedPreview = await this.preview({
      ...options,
      maxReads: runOptions.maxReads,
      maxScanPages: Math.min(Math.max(1, runOptions.maxScanPages), 3)
    });
    const refreshedMessage = [...refreshedPreview.messages, ...(refreshedPreview.candidates || [])].find(
      (candidate) => sameMessage(candidate, message)
    );

    if (!refreshedMessage) {
      throw new Error(`쪽지 링크를 현재 검색 결과에서 다시 확인할 수 없습니다: ${message.title}`);
    }

    await this.clickMessage(page, refreshedMessage, runOptions);
    return refreshedMessage;
  }

  expectedReadCount(preview, options, maxReads) {
    if (options.mode === "all-new") {
      const unreadCount = preview.unreadBadgeCount || preview.count || 0;
      return Math.min(unreadCount, maxReads);
    }

    return Math.min(preview.count || 0, maxReads);
  }

  async openPreviewMessage(index, options = {}) {
    const page = await this.getActivePage();
    const runOptions = normalizeRunOptions(options);
    const inboxUrl = options.inboxUrl || DEFAULT_INBOX_URL;
    await this.ensureInboxPage(page, inboxUrl, runOptions);
    const preview = this.lastPreview.length ? this.lastPreview : (await this.preview(options)).messages;
    const message = preview[index];

    if (!message) {
      throw new Error("선택한 미리보기 쪽지를 찾을 수 없습니다. 다시 미리보기를 실행하세요.");
    }

    await this.clickMessage(page, message, runOptions);
    return message;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  requestPause() {
    this.pauseRequested = true;
    return { pauseRequested: true };
  }

  nextPageKey(nextPage, currentUrl = "", pageIndex = 0) {
    return `${currentUrl}::${pageIndex}::${nextPage?.frameUrl || ""}::${nextPage?.href || ""}::${nextPage?.clickKey || ""}`;
  }

  async gotoNextInboxPage(page, nextPage, runOptions = normalizeRunOptions()) {
    if (!nextPage) {
      return false;
    }

    if (nextPage.href && !/^javascript:/i.test(nextPage.href)) {
      await page.goto(nextPage.href, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) }).catch(() => {});
      return true;
    }

    const frame = page.frames().find((item) => item.url() === nextPage.frameUrl) || page.mainFrame();
    const clicked = await frame
      .evaluate((targetPage) => {
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
        const links = Array.from(document.querySelectorAll("a"));
        const target = links.find((link) => {
          const href = link.getAttribute("href") || "";
          const onclick = link.getAttribute("onclick") || "";
          const text = normalize(link.textContent);

          return href === targetPage.clickKey || onclick === targetPage.clickKey || text === targetPage.text;
        });

        if (!target) return false;
        setTimeout(() => target.click(), 0);
        return true;
      }, nextPage)
      .catch(() => false);

    if (clicked) {
      await page.waitForLoadState("domcontentloaded", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(500);
    }

    return clicked;
  }

  async closeNewPages(pagesBeforeClick) {
    const pagesAfterClick = this.context ? this.context.pages() : [];
    const newPages = pagesAfterClick.filter((candidate) => !pagesBeforeClick.has(candidate));

    for (const newPage of newPages) {
      await newPage.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});
      await newPage.close({ runBeforeUnload: true }).catch(() => {});
    }
  }

  async clickMessage(page, message, runOptions = normalizeRunOptions()) {
    await page.waitForLoadState("domcontentloaded", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    if (message.pageUrl && page.url() !== message.pageUrl) {
      await page.goto(message.pageUrl, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    }

    const pagesBeforeClick = new Set(this.context.pages());
    const urlBeforeClick = page.url();
    const frame = page.frames().find((item) => item.url() === message.frameUrl) || page.mainFrame();
    const clicked = await frame
      .evaluate((messageToClick) => {
        const candidates = Array.from(document.querySelectorAll("a"));
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
        const toComparableHref = (href) => {
          if (!href) return "";
          if (/^javascript:/i.test(href)) return href;
          try {
            return new URL(href, location.href).href;
          } catch {
            return href;
          }
        };
        const target = candidates.find((link) => {
          const href = link.getAttribute("href") || "";
          const onclick = link.getAttribute("onclick") || "";
          const text = normalize(link.textContent);

          return (
            toComparableHref(href) === messageToClick.link ||
            href === messageToClick.clickKey ||
            onclick === messageToClick.clickKey ||
            (text && text === messageToClick.title)
          );
        });
        if (!target) return false;
        setTimeout(() => target.click(), 0);
        return true;
      }, message)
      .catch(async (error) => {
        if (/Execution context was destroyed|navigation/i.test(error.message || "")) {
          await page.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});
          return page.url() !== urlBeforeClick;
        }
        throw error;
      });

    if (!clicked) {
      throw new Error(`쪽지 링크를 찾을 수 없습니다: ${message.title}`);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(700);
    await this.closeNewPages(pagesBeforeClick);
    await this.restoreInboxIfNeeded(page, urlBeforeClick, runOptions);
  }

  async restoreInboxIfNeeded(page, urlBeforeClick, runOptions = normalizeRunOptions()) {
    await page.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});

    if (page.isClosed()) {
      throw new Error("받은쪽지함 Chrome 탭이 닫혔습니다. 다시 Chrome을 열고 미리보기부터 실행하세요.");
    }

    if (page.url() === urlBeforeClick || /class=Message&action=inbox/i.test(page.url())) {
      return;
    }

    await page.waitForTimeout(500);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (page.url() === urlBeforeClick || /class=Message&action=inbox/i.test(page.url()) || page.url() === "about:blank") {
        return;
      }

      await page.goBack({ waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: QUICK_LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    }
  }

  async ensureInboxPage(page, inboxUrl = DEFAULT_INBOX_URL, runOptions = normalizeRunOptions()) {
    if (page.isClosed()) {
      throw new Error("Chrome 탭이 닫혔습니다. Chrome을 다시 열어주세요.");
    }

    if (!/class=Message&action=inbox/i.test(page.url())) {
      await page.goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) });
      return;
    }

    await page.goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs(runOptions) });
  }

  navigationTimeoutMs(runOptions = normalizeRunOptions()) {
    return runOptions.navigationTimeoutMs || NAVIGATION_TIMEOUT_MS;
  }

  messageKey(message) {
    return messageKey(message);
  }
}

module.exports = {
  WorplMessageAutomation
};
