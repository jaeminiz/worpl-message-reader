const fs = require("node:fs/promises");
const path = require("node:path");

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestamp(now = new Date()) {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function buildRunLogPath(outputPath, now = new Date()) {
  const directory = path.join(path.dirname(outputPath), "logs");
  const baseName = path.basename(outputPath, path.extname(outputPath));
  return path.join(directory, `${baseName}_${timestamp(now)}.log`);
}

function safeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || ""
  };
}

async function writeRunErrorLog({
  logPath,
  error,
  options = {},
  runOptions = {},
  readMessages = [],
  skippedMessages = [],
  failedMessage = null,
  outputPath,
  expectedCount,
  pageUrl
}) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const safe = safeError(error);
  const lines = [
    "WORPL Message Reader error log",
    `createdAt: ${new Date().toISOString()}`,
    `errorName: ${safe.name}`,
    `errorMessage: ${safe.message}`,
    `pageUrl: ${pageUrl || ""}`,
    `outputPath: ${outputPath || ""}`,
    `mode: ${options.mode || ""}`,
    `keyword: ${options.keyword || ""}`,
    `maxReads: ${runOptions.maxReads || ""}`,
    `checkpointEvery: ${runOptions.checkpointEvery || ""}`,
    `maxScanPages: ${runOptions.maxScanPages || ""}`,
    `navigationTimeoutSeconds: ${runOptions.navigationTimeoutSeconds || ""}`,
    `navigationTimeoutMs: ${runOptions.navigationTimeoutMs || ""}`,
    `expectedCount: ${expectedCount || 0}`,
    `recordedCount: ${readMessages.length}`,
    `skippedCount: ${skippedMessages.length}`,
    "",
    "Failed message:",
    failedMessage
      ? [
          `Date=${failedMessage.date || ""}`,
          `Author=${failedMessage.author || ""}`,
          `Title=${failedMessage.title || ""}`,
          `Link=${failedMessage.link || ""}`,
          `DataKey=${failedMessage.link || failedMessage.clickKey || ""}`
        ].join(" | ")
      : "",
    "",
    "Recorded messages:",
    ...readMessages.map((message, index) =>
      [
        `#${index + 1}`,
        `Date=${message.date || ""}`,
        `Author=${message.author || ""}`,
        `Title=${message.title || ""}`,
        `Link=${message.link || ""}`
      ].join(" | ")
    ),
    "",
    "Skipped messages:",
    ...skippedMessages.map((message, index) =>
      [
        `#${index + 1}`,
        `Reason=${message.skipReason || ""}`,
        `Date=${message.date || ""}`,
        `Author=${message.author || ""}`,
        `Title=${message.title || ""}`,
        `Link=${message.link || ""}`
      ].join(" | ")
    ),
    "",
    "Stack:",
    safe.stack
  ];

  await fs.writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  return logPath;
}

module.exports = {
  buildRunLogPath,
  writeRunErrorLog
};
