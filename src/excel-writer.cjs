const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");

function pad(value) {
  return String(value).padStart(2, "0");
}

function sanitizeSheetName(value) {
  const cleaned = String(value || "")
    .replace(/[\\/?*:[\]]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || "쪽지";
}

function buildSheetName(options = {}) {
  if (options.mode === "all-new") {
    const maxReads = Number.isFinite(Number(options.maxReads)) ? Number(options.maxReads) : 20;
    return sanitizeSheetName(`신규${Math.min(Math.max(maxReads, 1), 1000)}개`);
  }

  return sanitizeSheetName(options.keyword || "키워드");
}

function buildOutputFileName(now = new Date(), sheetName = "쪽지") {
  const stamp = [
    String(now.getFullYear()).slice(-2),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes())
  ].join("");
  return `${stamp}_WP쪽지_${sanitizeSheetName(sheetName)}.xlsx`;
}

function defaultOutputPath(now = new Date(), sheetName = "쪽지") {
  return path.join(os.homedir(), "Documents", "WORPL Message Reader", buildOutputFileName(now, sheetName));
}

async function writeMessagesWorkbook(messages, outputPath = defaultOutputPath(), options = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WORPL Message Reader";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sanitizeSheetName(options.sheetName || "쪽지"), {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  sheet.columns = [
    { header: "순번", key: "sequence", width: 8 },
    { header: "Date", key: "date", width: 20 },
    { header: "작성자", key: "author", width: 22 },
    { header: "제목", key: "title", width: 60 },
    { header: "링크", key: "link", width: 72 }
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF315C80" }
  };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  messages.forEach((message, index) => {
    sheet.addRow({
      sequence: index + 1,
      date: message.date || "",
      author: message.author || message.category || "",
      title: message.title || "",
      link: message.link || ""
    });
  });

  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    const linkCell = row.getCell(5);
    if (linkCell.value) {
      linkCell.value = {
        text: String(linkCell.value),
        hyperlink: String(linkCell.value)
      };
      linkCell.font = { color: { argb: "FF125C75" }, underline: true };
    }
  }

  sheet.autoFilter = {
    from: "A1",
    to: "E1"
  };

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9DDE6" } },
        left: { style: "thin", color: { argb: "FFD9DDE6" } },
        bottom: { style: "thin", color: { argb: "FFD9DDE6" } },
        right: { style: "thin", color: { argb: "FFD9DDE6" } }
      };
    });
  });

  if (options.runSummary) {
    addRunSummarySheet(workbook, options.runSummary);
  }

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

function addRunSummarySheet(workbook, runSummary) {
  const sheet = workbook.addWorksheet("처리 안내");
  sheet.columns = [
    { header: "항목", key: "name", width: 24 },
    { header: "내용", key: "value", width: 80 }
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF315C80" }
  };

  sheet.addRow({ name: "최초 대상 건수", value: runSummary.expectedCount || 0 });
  sheet.addRow({ name: "엑셀 기록 건수", value: runSummary.recordedCount || 0 });
  sheet.addRow({ name: "미기록 건수", value: runSummary.skippedCount || 0 });
  sheet.addRow({ name: "사유", value: runSummary.reason || "" });

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9DDE6" } },
        left: { style: "thin", color: { argb: "FFD9DDE6" } },
        bottom: { style: "thin", color: { argb: "FFD9DDE6" } },
        right: { style: "thin", color: { argb: "FFD9DDE6" } }
      };
    });
  });
}

module.exports = {
  buildOutputFileName,
  buildSheetName,
  defaultOutputPath,
  sanitizeSheetName,
  writeMessagesWorkbook
};
