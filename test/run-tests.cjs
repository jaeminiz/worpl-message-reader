const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { filterMessages, parseInboxHtml } = require("../src/message-parser.cjs");
const { completionMessage } = require("../src/app-messages.cjs");
const { buildOutputFileName, buildSheetName, defaultOutputPath, writeMessagesWorkbook } = require("../src/excel-writer.cjs");
const {
  collectMessagesAcrossPages,
  messageKey,
  normalizeRunOptions,
  sameMessage,
  shouldWriteCheckpoint
} = require("../src/run-state.cjs");
const { WorplMessageAutomation } = require("../src/automation.cjs");

async function testParserExtractsNewRows() {
  const html = `
    <table>
      <tr><th>선택</th><th>작성자</th><th>제목</th><th>분류</th><th>Date</th></tr>
      <tr>
        <td><input type="checkbox"></td>
        <td>마스킹</td>
        <td><a href="/?class=Message&action=view&id=101">BNWAS TOUCH 확인 요청</a> <span style="color: red">new</span></td>
        <td>업무관리</td>
        <td>2026/06/11 09:10 am</td>
      </tr>
      <tr>
        <td><input type="checkbox"></td>
        <td>마스킹</td>
        <td><a href="/?class=Message&action=view&id=102">도면 검토 회신</a></td>
        <td>사용자</td>
        <td>2026/06/10 05:20 pm</td>
      </tr>
    </table>`;

  const messages = parseInboxHtml(html, {
    baseUrl: "http://marsen.marsen.co.kr/?class=Message&action=inbox",
    mode: "all-new"
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    sequence: 1,
    date: "2026/06/11 09:10 am",
    author: "마스킹",
    title: "BNWAS TOUCH 확인 요청",
    link: "http://marsen.marsen.co.kr/?class=Message&action=view&id=101",
    clickKey: "/?class=Message&action=view&id=101",
    frameUrl: ""
  });
}

function testParserAcceptsJavascriptSubjectLinks() {
  const html = `
    <table>
      <tr>
        <td><a href="javascript:viewMessage('A-100')">납기 확인 요청</a> <span style="color: #ff0000">new</span></td>
        <td>알림</td>
        <td>2026-06-12 08:30</td>
      </tr>
      <tr>
        <td><a href="javascript:_keyDEL('A-100')">삭제</a></td>
        <td>2026-06-12 08:30</td>
      </tr>
    </table>`;

  const messages = parseInboxHtml(html, {
    mode: "all-new"
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, "납기 확인 요청");
  assert.equal(messages[0].link, "javascript:viewMessage('A-100')");
  assert.equal(messages[0].author, "");
}

function testParserIgnoresNonRedNewMarkers() {
  const html = `
    <table>
      <tr>
        <td>작성자</td>
        <td><a href="/?class=Message&action=view&id=201">현대미포 키워드 포함</a> <span>new</span></td>
        <td>11:36 am</td>
      </tr>
      <tr>
        <td>작성자</td>
        <td><a href="/?class=Message&action=view&id=202">현대미포 굵은 표시</a></td>
        <td>11:33 am</td>
      </tr>
      <tr>
        <td>작성자</td>
        <td><a href="/?class=Message&action=view&id=203">현대미포 이미지 표시</a> <img src="/img/new.gif"></td>
        <td>11:31 am</td>
      </tr>
    </table>`;

  const messages = parseInboxHtml(html, {
    mode: "keyword-new",
    keyword: "현대미포"
  });

  assert.deepEqual(messages, []);
}

function testKeywordModes() {
  const rows = [
    {
      date: "2026/06/11",
      author: "품관팀_검사손건",
      title: "납기 확인 요청",
      link: "http://example.invalid/1",
      isNew: true
    },
    {
      date: "2026/06/11",
      author: "시스템",
      title: "회의 알림",
      link: "http://example.invalid/2",
      isNew: true
    },
    {
      date: "2026/06/10",
      author: "설계팀",
      title: "납기 완료",
      link: "http://example.invalid/3",
      isNew: false
    }
  ];

  assert.deepEqual(
    filterMessages(rows, {
      mode: "keyword-new",
      keyword: "납기"
    }).map((message) => message.title),
    ["납기 확인 요청"]
  );
  assert.deepEqual(
    filterMessages(rows, {
      mode: "all-new"
    }).map((message) => message.title),
    ["납기 확인 요청", "회의 알림"]
  );
}

async function testWorkbookOutput() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-${Date.now()}.xlsx`);
  await writeMessagesWorkbook(
    [
      {
        sequence: 1,
        date: "2026/06/11 09:10 am",
        author: "품관팀_검사손건",
        title: "BNWAS TOUCH 확인 요청",
        link: "http://marsen.marsen.co.kr/?class=Message&action=view&id=101"
      }
    ],
    outputPath,
    { sheetName: "BNWAS" }
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const sheet = workbook.getWorksheet("BNWAS");

  assert.ok(sheet);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["순번", "Date", "작성자", "제목", "링크"]);
  assert.equal(sheet.getRow(2).getCell(1).value, 1);
  assert.equal(sheet.getRow(2).getCell(4).value, "BNWAS TOUCH 확인 요청");
  assert.equal(sheet.getRow(2).getCell(5).value.hyperlink, "http://marsen.marsen.co.kr/?class=Message&action=view&id=101");

  await fs.unlink(outputPath);
}

async function testWorkbookRenumbersSavedRowsAndWritesRunSummary() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-summary-${Date.now()}.xlsx`);
  await writeMessagesWorkbook(
    [
      {
        sequence: 1,
        date: "01:41 pm",
        author: "작성자1",
        title: "같은 순번 첫 행",
        link: "http://example.invalid/1"
      },
      {
        sequence: 1,
        date: "01:40 pm",
        author: "작성자2",
        title: "같은 순번 둘째 행",
        link: "http://example.invalid/2"
      }
    ],
    outputPath,
    {
      sheetName: "신규20개",
      runSummary: {
        expectedCount: 17,
        recordedCount: 15,
        skippedCount: 2,
        reason: "중복 또는 동시 읽음으로 목록에서 사라진 쪽지가 있어 실제 클릭한 쪽지만 기록했습니다."
      }
    }
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const sheet = workbook.getWorksheet("신규20개");
  const summarySheet = workbook.getWorksheet("처리 안내");

  assert.equal(sheet.getRow(2).getCell(1).value, 1);
  assert.equal(sheet.getRow(3).getCell(1).value, 2);
  assert.ok(summarySheet);
  assert.equal(summarySheet.getRow(2).getCell(2).value, 17);
  assert.equal(summarySheet.getRow(3).getCell(2).value, 15);
  assert.equal(summarySheet.getRow(4).getCell(2).value, 2);

  await fs.unlink(outputPath);
}

function testSheetAndFileNames() {
  assert.equal(buildSheetName({ mode: "keyword-new", keyword: "현보" }), "현보");
  assert.equal(buildSheetName({ mode: "all-new", maxReads: 20 }), "신규20개");
  assert.equal(buildSheetName({ mode: "all-new", maxReads: 1000 }), "신규1000개");
  assert.equal(buildSheetName({ mode: "keyword-new", keyword: "A/B:C*D?E[F]" }), "A_B_C_D_E_F");
  assert.equal(buildOutputFileName(new Date(2026, 5, 12, 13, 58), "현보"), "260612_1358_WP쪽지_현보.xlsx");
  assert.ok(defaultOutputPath(new Date(2026, 5, 12, 13, 58), "신규20개").endsWith("260612_1358_WP쪽지_신규20개.xlsx"));
}

function testCompletionMessage() {
  assert.equal(completionMessage(4), "쪽지 읽기 4건 완료");
  assert.equal(completionMessage("2"), "쪽지 읽기 2건 완료");
  assert.equal(
    completionMessage({ recordedCount: 15, expectedCount: 17, skippedCount: 2 }),
    "쪽지 읽기 15건 완료 - 최초 대상 17건 중 2건은 중복 또는 동시 읽음으로 목록에서 사라져 엑셀에는 15건만 기록했습니다."
  );
  assert.equal(
    completionMessage({ recordedCount: 7, expectedCount: 20, skippedCount: 13, paused: true }),
    "쪽지 읽기 7건 기록 후 일시정지 - 최초 대상 20건 중 남은 13건은 처리하지 않았습니다."
  );
}

function testCollectMessagesAcrossPagesKeepsSearchingPastEmptyFirstPage() {
  const pages = [
    {
      messages: [],
      candidateCount: 20,
      newCandidateCount: 20,
      unreadBadgeCount: 40,
      url: "http://example.invalid/inbox?page=1"
    },
    {
      messages: [
        {
          sequence: 1,
          date: "2026/06/23",
          author: "설계팀",
          title: "납기 키워드 확인",
          link: "http://example.invalid/101",
          clickKey: "/101",
          frameUrl: "http://example.invalid/inbox?page=2"
        }
      ],
      candidateCount: 20,
      newCandidateCount: 20,
      unreadBadgeCount: 40,
      url: "http://example.invalid/inbox?page=2"
    }
  ];

  const result = collectMessagesAcrossPages(pages, { maxReads: 20 });

  assert.equal(result.count, 1);
  assert.equal(result.messages[0].sequence, 1);
  assert.equal(result.messages[0].title, "납기 키워드 확인");
  assert.equal(result.scannedPages, 2);
  assert.equal(result.candidateCount, 40);
  assert.equal(result.newCandidateCount, 40);
}

function testCollectMessagesAcrossPagesDeduplicatesAndLimits() {
  const pages = [
    {
      messages: [
        { sequence: 1, title: "A", link: "http://example.invalid/a" },
        { sequence: 2, title: "B", link: "http://example.invalid/b" }
      ]
    },
    {
      messages: [
        { sequence: 1, title: "A", link: "http://example.invalid/a" },
        { sequence: 2, title: "C", link: "http://example.invalid/c" }
      ]
    }
  ];

  const result = collectMessagesAcrossPages(pages, { maxReads: 2 });

  assert.deepEqual(
    result.messages.map((message) => message.title),
    ["A", "B"]
  );
}

function testMessageIdentityUsesDataIdWhenTitleChanges() {
  const original = {
    title: "260623_현보_기광운_현대미포조선_HMD8425_45K LPGC_BNWAS_R 0_(목표 260707)",
    link: "http://example.invalid/class.php?class=Message&action=link&data_id=20260623164832baff"
  };
  const refreshed = {
    title: "260623 현보 기광운 현대미포조선 HMD8425 45K LPGC BNWAS R 0 (목표 260707)",
    link: "http://example.invalid/?class=Message&action=link&data_id=20260623164832baff"
  };

  assert.equal(messageKey(original), "data_id:20260623164832baff");
  assert.equal(sameMessage(original, refreshed), true);
}

function testNormalizeRunOptionsAllowsLargeRunsWithCheckpoints() {
  assert.deepEqual(normalizeRunOptions({ maxReads: 1000 }), {
    maxReads: 1000,
    checkpointEvery: 20,
    maxScanPages: 50,
    navigationTimeoutSeconds: 500,
    navigationTimeoutMs: 500000
  });
  assert.equal(normalizeRunOptions({ maxReads: 5000 }).maxReads, 1000);
  assert.equal(normalizeRunOptions({ checkpointEvery: 50 }).checkpointEvery, 50);
  assert.equal(normalizeRunOptions({ navigationTimeoutSeconds: 300 }).navigationTimeoutMs, 300000);
  assert.equal(normalizeRunOptions({ navigationTimeoutSeconds: 999 }).navigationTimeoutSeconds, 600);
  assert.equal(shouldWriteCheckpoint(20, 20), true);
  assert.equal(shouldWriteCheckpoint(21, 20), false);
}

async function testKeywordPreviewAppliesWorplSearchBeforeScanning() {
  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.actions = [];
    }

    async getActivePage() {
      return { id: "page" };
    }

    async ensureInboxPage() {
      this.actions.push("ensure");
    }

    async applyKeywordSearch(_page, options) {
      this.actions.push(`search:${options.keyword}`);
      return { searched: true };
    }

    async previewCurrentPage() {
      this.actions.push("scan");
      return {
        url: "http://example.invalid/?class=Message&action=inbox",
        count: 1,
        candidateCount: 1,
        newCandidateCount: 1,
        unreadBadgeCount: 1,
        nextPage: null,
        messages: [{ title: "부적합 키워드", link: "http://example.invalid/1" }]
      };
    }
  }

  const automation = new TestAutomation();
  const result = await automation.preview({ mode: "keyword-new", keyword: "부적합", maxReads: 20 });

  assert.deepEqual(automation.actions, ["ensure", "search:부적합", "scan"]);
  assert.equal(result.count, 1);
}

async function testReadVisibleMessagesProcessesOneSearchPageAsBatch() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-batch-${Date.now()}.xlsx`);

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.previewCalls = 0;
      this.clickedTitles = [];
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox",
        isClosed: () => false
      };
    }

    async ensureInboxPage() {}

    async preview(options) {
      this.previewCalls += 1;
      return {
        url: "http://example.invalid/?class=Message&action=inbox",
        count: 2,
        candidateCount: 2,
        newCandidateCount: 2,
        unreadBadgeCount: 2,
        scannedPages: options.maxScanPages || 1,
        messages: [
          {
            sequence: 1,
            date: "09:46 am",
            author: "설계팀",
            title: "부적합 첫번째",
            link: "http://example.invalid/1",
            clickKey: "/1",
            frameUrl: "http://example.invalid/?class=Message&action=inbox",
            pageUrl: "http://example.invalid/?class=Message&action=inbox"
          },
          {
            sequence: 2,
            date: "09:45 am",
            author: "설계팀",
            title: "부적합 두번째",
            link: "http://example.invalid/2",
            clickKey: "/2",
            frameUrl: "http://example.invalid/?class=Message&action=inbox",
            pageUrl: "http://example.invalid/?class=Message&action=inbox"
          }
        ]
      };
    }

    async clickMessage(_page, message) {
      this.clickedTitles.push(message.title);
    }
  }

  const automation = new TestAutomation();
  const result = await automation.readVisibleMessages({
    mode: "keyword-new",
    keyword: "부적합",
    maxReads: 2,
    outputPath
  });

  assert.deepEqual(automation.clickedTitles, ["부적합 첫번째", "부적합 두번째"]);
  assert.equal(automation.previewCalls, 1);
  assert.equal(result.count, 2);

  await fs.unlink(outputPath);
}

async function testReadVisibleMessagesUsesExistingPreviewWithoutRefreshing() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-existing-preview-${Date.now()}.xlsx`);

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.clickedTitles = [];
      this.lastPreview = [
        {
          sequence: 1,
          date: "01:54 pm",
          author: "기영2팀",
          title: "작요 검색 결과",
          link: "http://example.invalid/?class=Message&action=link&data_id=1",
          clickKey: "/?class=Message&action=link&data_id=1",
          frameUrl: "http://example.invalid/?class=Message&action=inbox&search=작요",
          pageUrl: "http://example.invalid/?class=Message&action=inbox&search=작요"
        }
      ];
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox&search=작요",
        isClosed: () => false
      };
    }

    async ensureInboxPage() {
      throw new Error("미리보기 직후 읽음 처리는 받은쪽지함 새로고침을 먼저 하면 안 됩니다.");
    }

    async preview() {
      throw new Error("미리보기 직후 읽음 처리는 키워드 재검색을 먼저 하면 안 됩니다.");
    }

    async clickMessage(_page, message) {
      this.clickedTitles.push(message.title);
    }
  }

  const automation = new TestAutomation();
  const result = await automation.readVisibleMessages({
    mode: "keyword-new",
    keyword: "작요",
    maxReads: 1,
    outputPath
  });

  assert.deepEqual(automation.clickedTitles, ["작요 검색 결과"]);
  assert.equal(result.count, 1);

  await fs.unlink(outputPath);
}

async function testClickMessageDefersDomClickBeforeNavigation() {
  const page = {
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () => "http://example.invalid/?class=Message&action=inbox",
    isClosed: () => false,
    frames: () => [frame],
    mainFrame: () => frame,
    goBack: async () => {}
  };
  const frame = {
    url: () => "http://example.invalid/?class=Message&action=inbox",
    evaluate: async (fn) => {
      if (!fn.toString().includes("setTimeout")) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      return true;
    }
  };
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  automation.context = {
    pages: () => [page]
  };

  await automation.clickMessage(page, {
    title: "즉시 이동 쪽지",
    link: "http://example.invalid/?class=Message&action=link&data_id=1",
    clickKey: "/?class=Message&action=link&data_id=1",
    frameUrl: "http://example.invalid/?class=Message&action=inbox",
    pageUrl: "http://example.invalid/?class=Message&action=inbox"
  });
}

async function testClickMessageTreatsContextDestroyedAfterNavigationAsClicked() {
  let navigated = false;
  const page = {
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () =>
      navigated
        ? "http://example.invalid/?class=Project&action=view&data_id=1"
        : "http://example.invalid/?class=Message&action=inbox&search=작요",
    isClosed: () => false,
    frames: () => [frame],
    mainFrame: () => frame,
    goBack: async () => {
      navigated = false;
    }
  };
  const frame = {
    url: () => "http://example.invalid/?class=Message&action=inbox&search=작요",
    evaluate: async () => {
      navigated = true;
      throw new Error("Execution context was destroyed, most likely because of a navigation");
    }
  };
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  automation.context = {
    pages: () => [page]
  };

  await automation.clickMessage(page, {
    title: "이동 중 컨텍스트 종료 쪽지",
    link: "http://example.invalid/?class=Message&action=link&data_id=1",
    clickKey: "/?class=Message&action=link&data_id=1",
    frameUrl: "http://example.invalid/?class=Message&action=inbox&search=작요",
    pageUrl: "http://example.invalid/?class=Message&action=inbox&search=작요"
  });

  assert.equal(page.url(), "http://example.invalid/?class=Message&action=inbox&search=작요");
}

async function testClickMessageReturnsToStoredPageUrlBeforeNextClick() {
  let currentUrl = "http://example.invalid/?class=Project&action=view&data_id=first";
  const clickedTitles = [];
  const page = {
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () => currentUrl,
    isClosed: () => false,
    goto: async (url) => {
      currentUrl = url;
    },
    frames: () => [frame],
    mainFrame: () => frame,
    goBack: async () => {}
  };
  const frame = {
    url: () => currentUrl,
    evaluate: async (_fn, message) => {
      if (currentUrl !== message.pageUrl) {
        return false;
      }
      clickedTitles.push(message.title);
      return true;
    }
  };
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  automation.context = {
    pages: () => [page]
  };

  await automation.clickMessage(page, {
    title: "두번째 쪽지",
    link: "http://example.invalid/?class=Message&action=link&data_id=2",
    clickKey: "/?class=Message&action=link&data_id=2",
    frameUrl: "http://example.invalid/custom-search-result",
    pageUrl: "http://example.invalid/custom-search-result"
  });

  assert.deepEqual(clickedTitles, ["두번째 쪽지"]);
}

async function testClickMessageDoesNotOpenExactMessageLinkWhenDomLinkMissing() {
  let currentUrl = "http://example.invalid/?class=Project&action=view&data_id=first";
  const navigatedUrls = [];
  const page = {
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () => currentUrl,
    isClosed: () => false,
    goto: async (url) => {
      currentUrl = url;
      navigatedUrls.push(url);
    },
    frames: () => [frame],
    mainFrame: () => frame,
    goBack: async () => {}
  };
  const frame = {
    url: () => currentUrl,
    evaluate: async () => false
  };
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  automation.context = {
    pages: () => [page]
  };

  await assert.rejects(
    () =>
      automation.clickMessage(page, {
        title: "검색 결과에서 사라진 두번째 쪽지",
        link: "http://example.invalid/?class=Message&action=link&data_id=exact-2",
        clickKey: "/?class=Message&action=link&data_id=exact-2",
        frameUrl: "http://example.invalid/?class=Message&action=inbox",
        pageUrl: "http://example.invalid/?class=Message&action=inbox"
      }),
    /쪽지 링크를 찾을 수 없습니다/
  );

  assert.deepEqual(navigatedUrls, ["http://example.invalid/?class=Message&action=inbox"]);
}

async function testReadVisibleMessagesRefreshesSearchInsteadOfDirectLinkFallback() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-refresh-retry-${Date.now()}.xlsx`);

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.previewCalls = 0;
      this.clickAttempts = 0;
      this.clickedTitles = [];
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox",
        isClosed: () => false
      };
    }

    async ensureInboxPage() {}

    async preview() {
      this.previewCalls += 1;
      return {
        url: "http://example.invalid/?class=Message&action=inbox",
        count: 1,
        candidateCount: 1,
        newCandidateCount: 1,
        unreadBadgeCount: 1,
        messages: [
          {
            sequence: 1,
            date: "02:19 pm",
            author: "영업1팀",
            title: "작요 재검색 대상",
            link: "http://example.invalid/?class=Message&action=link&data_id=retry-1",
            clickKey: "/?class=Message&action=link&data_id=retry-1",
            frameUrl: "http://example.invalid/?class=Message&action=inbox",
            pageUrl: "http://example.invalid/?class=Message&action=inbox"
          }
        ]
      };
    }

    async clickMessage(_page, message) {
      this.clickAttempts += 1;
      if (this.clickAttempts === 1) {
        throw new Error(`쪽지 링크를 찾을 수 없습니다: ${message.title}`);
      }
      this.clickedTitles.push(message.title);
    }
  }

  const automation = new TestAutomation();
  const result = await automation.readVisibleMessages({
    mode: "keyword-new",
    keyword: "작요",
    maxReads: 1,
    outputPath
  });

  assert.equal(automation.previewCalls, 2);
  assert.equal(automation.clickAttempts, 2);
  assert.deepEqual(automation.clickedTitles, ["작요 재검색 대상"]);
  assert.equal(result.count, 1);

  await fs.unlink(outputPath);
}

async function testReadVisibleMessagesRetriesWhenTargetIsVisibleButNoLongerNew() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-visible-candidate-${Date.now()}.xlsx`);

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.previewCalls = 0;
      this.clickAttempts = 0;
      this.clickedTitles = [];
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox&search=작요",
        isClosed: () => false
      };
    }

    async ensureInboxPage() {}

    async preview() {
      this.previewCalls += 1;
      const target = {
        sequence: 1,
        date: "02:13 pm",
        author: "구매팀",
        title: "작요 재검색 후 new 사라진 대상",
        link: "http://example.invalid/?class=Message&action=link&data_id=visible-1",
        clickKey: "/?class=Message&action=link&data_id=visible-1",
        frameUrl: "http://example.invalid/?class=Message&action=inbox&search=작요",
        pageUrl: "http://example.invalid/?class=Message&action=inbox&search=작요"
      };

      return {
        url: "http://example.invalid/?class=Message&action=inbox&search=작요",
        count: this.previewCalls === 1 ? 1 : 0,
        candidateCount: 1,
        newCandidateCount: this.previewCalls === 1 ? 1 : 0,
        unreadBadgeCount: 1,
        messages: this.previewCalls === 1 ? [target] : [],
        candidates: [target]
      };
    }

    async clickMessage(_page, message) {
      this.clickAttempts += 1;
      if (this.clickAttempts === 1) {
        throw new Error(`쪽지 링크를 찾을 수 없습니다: ${message.title}`);
      }
      this.clickedTitles.push(message.title);
    }
  }

  const automation = new TestAutomation();
  const result = await automation.readVisibleMessages({
    mode: "keyword-new",
    keyword: "작요",
    maxReads: 1,
    outputPath
  });

  assert.equal(automation.previewCalls, 2);
  assert.equal(automation.clickAttempts, 2);
  assert.deepEqual(automation.clickedTitles, ["작요 재검색 후 new 사라진 대상"]);
  assert.equal(result.count, 1);

  await fs.unlink(outputPath);
}

async function testReadVisibleMessagesRetriesWhenTargetTitleFormattingChanges() {
  const outputPath = path.join(os.tmpdir(), `worpl-message-reader-title-format-retry-${Date.now()}.xlsx`);

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.previewCalls = 0;
      this.clickAttempts = 0;
      this.clickedTitles = [];
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox&search=",
        isClosed: () => false
      };
    }

    async ensureInboxPage() {}

    async preview() {
      this.previewCalls += 1;
      const originalTarget = {
        sequence: 1,
        date: "04:48 pm",
        author: "구매팀_출하박종민",
        title: "260623_현보_기광운_현대미포조선_HMD8425_45K LPGC_BNWAS_R 0_(목표 260707)",
        link: "http://example.invalid/class.php?class=Message&action=link&data_id=20260623164832baff",
        clickKey: "/class.php?class=Message&action=link&data_id=20260623164832baff",
        frameUrl: "http://example.invalid/?class=Message&action=inbox&search=",
        pageUrl: "http://example.invalid/?class=Message&action=inbox&search="
      };
      const refreshedTarget = {
        ...originalTarget,
        title: "260623 현보 기광운 현대미포조선 HMD8425 45K LPGC BNWAS R 0 (목표 260707)",
        link: "http://example.invalid/?class=Message&action=link&data_id=20260623164832baff",
        clickKey: "/?class=Message&action=link&data_id=20260623164832baff"
      };

      return {
        url: "http://example.invalid/?class=Message&action=inbox&search=",
        count: this.previewCalls === 1 ? 1 : 0,
        candidateCount: 1,
        newCandidateCount: this.previewCalls === 1 ? 1 : 0,
        unreadBadgeCount: 1,
        messages: this.previewCalls === 1 ? [originalTarget] : [],
        candidates: [this.previewCalls === 1 ? originalTarget : refreshedTarget]
      };
    }

    async clickMessage(_page, message) {
      this.clickAttempts += 1;
      if (this.clickAttempts === 1) {
        throw new Error(`쪽지 링크를 찾을 수 없습니다: ${message.title}`);
      }
      this.clickedTitles.push(message.title);
    }
  }

  const automation = new TestAutomation();
  const result = await automation.readVisibleMessages({
    mode: "all-new",
    maxReads: 1,
    outputPath
  });

  assert.equal(automation.previewCalls, 2);
  assert.equal(automation.clickAttempts, 2);
  assert.deepEqual(automation.clickedTitles, ["260623 현보 기광운 현대미포조선 HMD8425 45K LPGC BNWAS R 0 (목표 260707)"]);
  assert.equal(result.count, 1);

  await fs.unlink(outputPath);
}

async function testEnsureInboxPageUsesLongTimeoutForLargeInboxes() {
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  let capturedTimeout = 0;
  const page = {
    isClosed: () => false,
    url: () => "http://example.invalid/?class=Project&action=view",
    goto: async (_url, options) => {
      capturedTimeout = options.timeout;
    }
  };

  await automation.ensureInboxPage(page, "http://example.invalid/?class=Message&action=inbox");

  assert.equal(capturedTimeout, 500000);
}

async function testEnsureInboxPageUsesUserConfiguredTimeout() {
  const automation = new WorplMessageAutomation({ profileDir: "unused" });
  let capturedTimeout = 0;
  const page = {
    isClosed: () => false,
    url: () => "http://example.invalid/?class=Message&action=inbox",
    goto: async (_url, options) => {
      capturedTimeout = options.timeout;
    }
  };

  await automation.ensureInboxPage(page, "http://example.invalid/?class=Message&action=inbox", {
    navigationTimeoutSeconds: 300,
    navigationTimeoutMs: 300000
  });

  assert.equal(capturedTimeout, 300000);
}

async function testReadVisibleMessagesSavesPartialWorkbookAndLogOnError() {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "worpl-message-reader-error-"));
  const outputPath = path.join(runDir, "partial.xlsx");

  class TestAutomation extends WorplMessageAutomation {
    constructor() {
      super({ profileDir: "unused" });
      this.clickAttempts = 0;
    }

    async getActivePage() {
      return {
        url: () => "http://example.invalid/?class=Message&action=inbox",
        isClosed: () => false
      };
    }

    async previewRunBatch() {
      return {
        url: "http://example.invalid/?class=Message&action=inbox",
        count: 2,
        candidateCount: 2,
        newCandidateCount: 2,
        unreadBadgeCount: 2,
        messages: [
          {
            sequence: 1,
            date: "01:19 pm",
            author: "재경팀_회계",
            title: "260325_계산서_이민수_H3524",
            link: "http://example.invalid/?class=Message&action=link&data_id=partial-1"
          },
          {
            sequence: 2,
            date: "01:20 pm",
            author: "재경팀_회계",
            title: "260325_계산서_오류대상",
            link: "http://example.invalid/?class=Message&action=link&data_id=partial-2"
          }
        ]
      };
    }

    async clickMessageWithSearchRetry(_page, message) {
      this.clickAttempts += 1;
      if (this.clickAttempts === 2) {
        throw new Error(`page.goto: Timeout 10000ms exceeded: ${message.title}`);
      }
    }
  }

  const automation = new TestAutomation();
  await assert.rejects(
    () =>
      automation.readVisibleMessages({
        mode: "keyword-new",
        keyword: "계산서",
        maxReads: 2,
        outputPath
      }),
    /오류 로그/
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const sheet = workbook.getWorksheet("계산서");
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getRow(2).getCell(4).value, "260325_계산서_이민수_H3524");

  const logs = await fs.readdir(path.join(runDir, "logs"));
  assert.equal(logs.length, 1);
  const logText = await fs.readFile(path.join(runDir, "logs", logs[0]), "utf8");
  assert.match(logText, /page\.goto: Timeout 10000ms exceeded/);
  assert.match(logText, /recordedCount: 1/);

  await fs.rm(runDir, { recursive: true, force: true });
}

async function run() {
  const tests = [
    ["parseInboxHtml extracts only new message rows", testParserExtractsNewRows],
    ["parseInboxHtml accepts javascript subject links", testParserAcceptsJavascriptSubjectLinks],
    ["parseInboxHtml ignores non-red new markers", testParserIgnoresNonRedNewMarkers],
    ["filterMessages supports keyword-new and all-new modes", testKeywordModes],
    ["writeMessagesWorkbook creates requested workbook", testWorkbookOutput],
    ["writeMessagesWorkbook renumbers rows and writes run summary", testWorkbookRenumbersSavedRowsAndWritesRunSummary],
    ["sheet and file names follow run options", testSheetAndFileNames],
    ["completionMessage returns Korean completion text", testCompletionMessage],
    ["collectMessagesAcrossPages keeps searching past empty first page", testCollectMessagesAcrossPagesKeepsSearchingPastEmptyFirstPage],
    ["collectMessagesAcrossPages deduplicates and limits results", testCollectMessagesAcrossPagesDeduplicatesAndLimits],
    ["message identity uses data_id when title changes", testMessageIdentityUsesDataIdWhenTitleChanges],
    ["normalizeRunOptions allows large runs with checkpoints", testNormalizeRunOptionsAllowsLargeRunsWithCheckpoints],
    ["keyword preview applies WORPL search before scanning", testKeywordPreviewAppliesWorplSearchBeforeScanning],
    ["readVisibleMessages processes one search page as a batch", testReadVisibleMessagesProcessesOneSearchPageAsBatch],
    ["readVisibleMessages uses existing preview without refreshing", testReadVisibleMessagesUsesExistingPreviewWithoutRefreshing],
    ["clickMessage defers DOM click before navigation", testClickMessageDefersDomClickBeforeNavigation],
    ["clickMessage treats context destroyed after navigation as clicked", testClickMessageTreatsContextDestroyedAfterNavigationAsClicked],
    ["clickMessage returns to stored page URL before next click", testClickMessageReturnsToStoredPageUrlBeforeNextClick],
    ["clickMessage does not open exact message link when DOM link is missing", testClickMessageDoesNotOpenExactMessageLinkWhenDomLinkMissing],
    ["readVisibleMessages refreshes search instead of direct link fallback", testReadVisibleMessagesRefreshesSearchInsteadOfDirectLinkFallback],
    ["readVisibleMessages retries when target is visible but no longer new", testReadVisibleMessagesRetriesWhenTargetIsVisibleButNoLongerNew],
    ["readVisibleMessages retries when target title formatting changes", testReadVisibleMessagesRetriesWhenTargetTitleFormattingChanges],
    ["ensureInboxPage uses long timeout for large inboxes", testEnsureInboxPageUsesLongTimeoutForLargeInboxes],
    ["ensureInboxPage uses user configured timeout", testEnsureInboxPageUsesUserConfiguredTimeout],
    ["readVisibleMessages saves partial workbook and log on error", testReadVisibleMessagesSavesPartialWorkbookAndLogOnError]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
