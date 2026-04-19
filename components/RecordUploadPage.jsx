"use client";

import { useState } from "react";
import ReadingRecordSection from "@/components/ReadingRecordSection";
import DiaryRecordsTable from "@/components/DiaryRecordsTable";
import SpeakingParticipationModule from "@/components/SpeakingParticipationModule";

export default function RecordUploadPage() {
  const [diaryRefreshKey, setDiaryRefreshKey] = useState(0);

  function bumpDiary() {
    setDiaryRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">记录上传页面</h1>
        <p className="text-sm text-gray-500 mt-1">咏梅英文剧社 · 阅读、日记与口语参与度</p>
      </div>

      <ReadingRecordSection onSaved={bumpDiary} />
      <DiaryRecordsTable refreshKey={diaryRefreshKey} />
      <SpeakingParticipationModule onSaved={bumpDiary} refreshKey={diaryRefreshKey} />
    </div>
  );
}
