/** 从整段文本解析「姓名：分数」或「姓名：请假」；支持中英文冒号、空格与换行分隔 */

export function parseSpeakingBulkText(text) {
  const pairs = [];
  const failed = [];
  const re = /([^\s:：\n]+)\s*[:：]\s*(请假|\d+)/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const name = m[1].trim();
    const raw = m[2].trim();
    if (!name) continue;
    if (raw === "请假") {
      pairs.push({ name, kind: "leave" });
      continue;
    }
    const score = parseInt(raw, 10);
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      failed.push(`无法识别：${m[0].trim()}`);
      continue;
    }
    pairs.push({ name, kind: "score", score });
  }
  return { pairs, failed };
}
