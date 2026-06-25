function normalizeRunOptions(options = {}) {
  const maxReads = clampNumber(options.maxReads, 20, 1, 1000);
  const checkpointEvery = clampNumber(options.checkpointEvery, 20, 1, 100);
  const maxScanPages = clampNumber(options.maxScanPages, 50, 1, 200);
  const navigationTimeoutSeconds = clampNumber(options.navigationTimeoutSeconds, 500, 30, 600);

  return {
    maxReads,
    checkpointEvery,
    maxScanPages,
    navigationTimeoutSeconds,
    navigationTimeoutMs: navigationTimeoutSeconds * 1000
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeComparable(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractMessageDataId(message) {
  const rawValues = [message?.link, message?.clickKey, message?.onclick].filter(Boolean);
  for (const rawValue of rawValues) {
    const decoded = safeDecode(String(rawValue));
    const match = decoded.match(/(?:[?&]|^)data_id=([^&#\s]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function messageKey(message) {
  const dataId = extractMessageDataId(message);
  if (dataId) {
    return `data_id:${dataId}`;
  }

  return `${normalizeComparable(message?.link)}::${normalizeComparable(message?.title)}`;
}

function sameMessage(left, right) {
  const leftDataId = extractMessageDataId(left);
  const rightDataId = extractMessageDataId(right);
  if (leftDataId && rightDataId) {
    return leftDataId === rightDataId;
  }

  const leftLink = normalizeComparable(left?.link);
  const rightLink = normalizeComparable(right?.link);
  if (leftLink && rightLink && leftLink === rightLink) {
    return true;
  }

  const leftTitle = normalizeComparable(left?.title);
  const rightTitle = normalizeComparable(right?.title);
  if (!leftTitle || !rightTitle || leftTitle !== rightTitle) {
    return false;
  }

  return (
    normalizeComparable(left?.date) === normalizeComparable(right?.date) &&
    normalizeComparable(left?.author) === normalizeComparable(right?.author)
  );
}

function collectMessagesAcrossPages(pageResults = [], options = {}) {
  const runOptions = normalizeRunOptions(options);
  const messages = [];
  const seen = new Set();
  let candidateCount = 0;
  let newCandidateCount = 0;
  let unreadBadgeCount = 0;
  let url = "";

  for (const pageResult of pageResults) {
    candidateCount += Number(pageResult?.candidateCount || 0);
    newCandidateCount += Number(pageResult?.newCandidateCount || 0);
    unreadBadgeCount = Math.max(unreadBadgeCount, Number(pageResult?.unreadBadgeCount || 0));
    url = pageResult?.url || url;

    for (const message of pageResult?.messages || []) {
      const key = messageKey(message);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      messages.push({
        ...message,
        sequence: messages.length + 1
      });
      if (messages.length >= runOptions.maxReads) {
        return {
          url,
          count: messages.length,
          candidateCount,
          newCandidateCount,
          unreadBadgeCount,
          scannedPages: pageResults.indexOf(pageResult) + 1,
          messages
        };
      }
    }
  }

  return {
    url,
    count: messages.length,
    candidateCount,
    newCandidateCount,
    unreadBadgeCount,
    scannedPages: pageResults.length,
    messages
  };
}

function shouldWriteCheckpoint(recordedCount, checkpointEvery) {
  const checkpointSize = clampNumber(checkpointEvery, 20, 1, 100);
  return recordedCount > 0 && recordedCount % checkpointSize === 0;
}

module.exports = {
  collectMessagesAcrossPages,
  extractMessageDataId,
  messageKey,
  normalizeRunOptions,
  sameMessage,
  shouldWriteCheckpoint
};
