function completionMessage(count) {
  if (typeof count === "object" && count) {
    const recordedCount = normalizeCount(count.recordedCount);
    const expectedCount = normalizeCount(count.expectedCount);
    const skippedCount = normalizeCount(count.skippedCount);

    if (skippedCount > 0 && expectedCount > recordedCount) {
      return `쪽지 읽기 ${recordedCount}건 완료 - 최초 대상 ${expectedCount}건 중 ${skippedCount}건은 중복 또는 동시 읽음으로 목록에서 사라져 엑셀에는 ${recordedCount}건만 기록했습니다.`;
    }

    return `쪽지 읽기 ${recordedCount}건 완료`;
  }

  return `쪽지 읽기 ${normalizeCount(count)}건 완료`;
}

function normalizeCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

module.exports = {
  completionMessage
};
