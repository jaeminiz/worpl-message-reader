const fs = require("node:fs");
const { chromium } = require("playwright-core");
const { completionMessage } = require("./app-messages.cjs");
const { DEFAULT_INBOX_URL, filterMessages } = require("./message-parser.cjs");
const { buildSheetName, defaultOutputPath, writeMessagesWorkbook } = require("./excel-writer.cjs");

class WorplMessageAutomation {
  constructor({ profileDir }) {
    this.profileDir = profileDir;
    this.context = null;
    this.lastPreview = [];
  }

  async openChrome(startUrl = DEFAULT_INBOX_URL) {
    if (this.context && !this.isContextUsable()) {
      this.context = null;
      this.lastPreview = [];
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
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
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
    await this.ensureInboxPage(page, options.inboxUrl || DEFAULT_INBOX_URL);
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
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
          const pageText = normalize(document.body?.textContent || "");
          const unreadMatches = Array.from(pageText.matchAll(/쪽지함\s*\((\d+)\)/g)).map((match) => Number(match[1]));
          const selectedCategory =
            document.querySelector("input[name='show']:checked, input[name='type']:checked, select[name='show'], select[name='type']")?.value || "";

          return {
            url: location.href,
            fallbackCategory: selectedCategory,
            unreadBadgeCount: unreadMatches.length ? Math.max(...unreadMatches) : 0,
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
      rows: frameSnapshots.flatMap((item) => item.rows.map((row) => ({ ...row, frameUrl: row.frameUrl || item.url })))
    };

    this.lastPreview =
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
      count: this.lastPreview.length,
      candidateCount,
      newCandidateCount,
      unreadBadgeCount: snapshot.unreadBadgeCount,
      messages: this.lastPreview
    };
  }

  async readVisibleMessages(options = {}) {
    const page = await this.getActivePage();
    const inboxUrl = options.inboxUrl || DEFAULT_INBOX_URL;
    const firstPreview = await this.preview(options);

    if (firstPreview.messages.length === 0) {
      throw new Error("읽음 처리할 신규 쪽지가 없습니다. 먼저 미리보기를 확인하세요.");
    }

    const readMessages = [];
    const processedKeys = new Set();
    const requestedMaxReads = Number(options.maxReads || 20);
    const maxReads = Math.min(Math.max(Number.isFinite(requestedMaxReads) ? requestedMaxReads : 20, 1), 100);
    const expectedCount = this.expectedReadCount(firstPreview, options, maxReads);
    const sheetName = buildSheetName({ mode: options.mode, keyword: options.keyword, maxReads });

    while (readMessages.length < maxReads) {
      await this.ensureInboxPage(page, inboxUrl);
      const currentPreview = await this.preview(options);

      if (currentPreview.unreadBadgeCount === 0) {
        break;
      }

      const message = currentPreview.messages.find((candidate) => !processedKeys.has(this.messageKey(candidate)));

      if (!message) {
        break;
      }

      await this.clickMessage(page, message);
      processedKeys.add(this.messageKey(message));
      readMessages.push(message);
      await this.ensureInboxPage(page, inboxUrl);
    }

    const recordedMessages = readMessages.map((message, index) => ({ ...message, sequence: index + 1 }));
    const skippedCount = Math.max(0, expectedCount - recordedMessages.length);
    const runSummary =
      skippedCount > 0
        ? {
            expectedCount,
            recordedCount: recordedMessages.length,
            skippedCount,
            reason: "중복 또는 동시 읽음으로 목록에서 사라진 쪽지가 있어 실제 클릭한 쪽지만 기록했습니다."
          }
        : null;
    const outputPath = await writeMessagesWorkbook(recordedMessages, options.outputPath || defaultOutputPath(new Date(), sheetName), {
      sheetName,
      runSummary
    });
    this.lastPreview = [];
    const messageStats = {
      recordedCount: recordedMessages.length,
      expectedCount,
      skippedCount
    };

    return {
      count: recordedMessages.length,
      expectedCount,
      skippedCount,
      completionMessage: completionMessage(messageStats),
      outputPath,
      messages: recordedMessages
    };
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
    const inboxUrl = options.inboxUrl || DEFAULT_INBOX_URL;
    await this.ensureInboxPage(page, inboxUrl);
    const preview = this.lastPreview.length ? this.lastPreview : (await this.preview(options)).messages;
    const message = preview[index];

    if (!message) {
      throw new Error("선택한 미리보기 쪽지를 찾을 수 없습니다. 다시 미리보기를 실행하세요.");
    }

    await this.clickMessage(page, message);
    return message;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  async closeNewPages(pagesBeforeClick) {
    const pagesAfterClick = this.context ? this.context.pages() : [];
    const newPages = pagesAfterClick.filter((candidate) => !pagesBeforeClick.has(candidate));

    for (const newPage of newPages) {
      await newPage.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
      await newPage.close({ runBeforeUnload: true }).catch(() => {});
    }
  }

  async clickMessage(page, message) {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    const pagesBeforeClick = new Set(this.context.pages());
    const urlBeforeClick = page.url();
    const frame = page.frames().find((item) => item.url() === message.frameUrl) || page.mainFrame();
    const clicked = await frame.evaluate((messageToClick) => {
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
      target.click();
      return true;
    }, message);

    if (!clicked) {
      throw new Error(`쪽지 링크를 찾을 수 없습니다: ${message.title}`);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    await this.closeNewPages(pagesBeforeClick);
    await this.restoreInboxIfNeeded(page, urlBeforeClick);
  }

  async restoreInboxIfNeeded(page, urlBeforeClick) {
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});

    if (page.isClosed()) {
      throw new Error("받은쪽지함 Chrome 탭이 닫혔습니다. 다시 Chrome을 열고 미리보기부터 실행하세요.");
    }

    const currentUrl = page.url();

    if (currentUrl === urlBeforeClick || /class=Message&action=inbox/i.test(currentUrl)) {
      return;
    }

    await page.waitForTimeout(500);

    if (page.url() !== "about:blank") {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    }

  }

  async ensureInboxPage(page, inboxUrl = DEFAULT_INBOX_URL) {
    if (page.isClosed()) {
      throw new Error("Chrome 탭이 닫혔습니다. Chrome을 다시 열어주세요.");
    }

    if (!/class=Message&action=inbox/i.test(page.url())) {
      await page.goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      return;
    }

    await page.goto(inboxUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  }

  messageKey(message) {
    return `${message.link || ""}::${message.title || ""}`;
  }
}

module.exports = {
  WorplMessageAutomation
};
