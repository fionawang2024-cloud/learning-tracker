/** Fired after student-side diary or reading upload succeeds so other views can refetch. */
export const STUDENT_RECORDS_UPDATED_EVENT = "xiecun-student-records-updated";

export function emitStudentRecordsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STUDENT_RECORDS_UPDATED_EVENT));
  }
}
