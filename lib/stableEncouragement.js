export const COMPLETION_ENCOURAGEMENTS = ["非常棒！", "真棒！", "特别棒！", "继续保持！", "很不错！", "加油！"];

/** 同一 studentId 映射固定一句，避免每次重渲染换句 */
export function stableEncouragementForStudentId(studentId) {
  let h = 2166136261;
  const s = String(studentId || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % COMPLETION_ENCOURAGEMENTS.length;
  return COMPLETION_ENCOURAGEMENTS[idx];
}
