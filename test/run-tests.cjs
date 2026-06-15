const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { filterMessages, parseInboxHtml } = require("../src/message-parser.cjs");
const { completionMessage } = require("../src/app-messages.cjs");
const { buildOutputFileName, buildSheetName, defaultOutputPath, writeMessagesWorkbook } = require("../src/excel-writer.cjs");

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
    ["completionMessage returns Korean completion text", testCompletionMessage]
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
