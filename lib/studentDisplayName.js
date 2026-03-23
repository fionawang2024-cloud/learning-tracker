/**
 * Prefer `students.display_name`. Only use email local-part (or full email) when display name is empty.
 * @param {{ display_name?: string | null; email?: string | null }} student
 * @param {string} [whenTotallyBlank] — last resort when no name and no email (e.g. "未知学生")
 */
export function formatStudentDisplayName(student, whenTotallyBlank = "") {
  const n = (student?.display_name || "").trim();
  if (n) return n;
  const email = (student?.email || "").trim();
  if (email) {
    const local = email.split("@")[0];
    return (local || email).trim();
  }
  return whenTotallyBlank;
}
