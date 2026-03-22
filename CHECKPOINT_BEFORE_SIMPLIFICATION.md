# Rollback checkpoint: before student/parent simplification

**Date:** Before major product simplification (two-card upload-only student side).

## How to rollback

If you need to restore the previous implementation:

1. **If you have already committed the simplification:**  
   `git log --oneline` to find the commit hash of this checkpoint, then  
   `git checkout <commit-hash> -- app/student lib/db.js app/teacher ...`  
   or  
   `git revert` the simplification commit(s).

2. **If you have uncommitted changes only:**  
   `git checkout -- app/student/page.jsx lib/db.js` etc. to restore specific files from the last commit.  
   Or restore from this project’s backup/tag if you created one.

3. **Recommended:** Create a tag now (before pulling the simplification) for easy rollback:  
   `git tag checkpoint-before-simplification`  
   Then later: `git checkout checkpoint-before-simplification -- .`

## What this checkpoint preserves

- Full student dashboard: diary with date/upload card, reading with 7-day buttons, time/word inputs, display name editing, 本周打卡.
- Teacher side: diary feedback, reading edit with hours/minutes, report, student list.
- Routes: /student, /student/history, /teacher, /teacher/student/[id], /login.
- DB: diary_records, reading_records (no extraction_status yet).

After simplification, the student page will have only two large upload cards (日记 + 阅读), no manual inputs, and reading will use best-effort OCR with extraction_status.
