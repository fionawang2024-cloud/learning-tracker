"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  getOrCreateStudent,
  ensureStudentDisplayNameIfEmpty,
  createDiaryRecord,
  createReadingRecord,
  persistReadingOcrToRecord,
} from "@/lib/db";
import {
  deriveReadingDaysDescending,
  normalizeDailyRecordsJson,
  normalizeReadingDaysArray,
} from "@/lib/readingRecordOcr";
import { getAndClearPendingDisplayName } from "@/lib/pendingDisplayName";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { emitStudentRecordsUpdated } from "@/lib/studentRecordsEvents";
import { uploadDiaryImage, uploadReadingImage } from "@/lib/storage";
import { compressImageForUpload } from "@/lib/clientImageCompress";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

const BUCKET_BANNER_ZH =
  "请在 Supabase Storage 创建两个 buckets：diary-images 和 reading-images（开发阶段建议设为 Public）";

function isBucketMissingError(error) {
  const msg = (error?.message || String(error)).toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    (msg.includes("bucket") &&
      (msg.includes("not found") || msg.includes("missing") || msg.includes("exist")))
  );
}

export default function StudentPage() {
  const [user, setUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBucketBanner, setShowBucketBanner] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [diarySuccess, setDiarySuccess] = useState(null);
  const [readingSuccess, setReadingSuccess] = useState(null);
  const [diarySaving, setDiarySaving] = useState(false);
  const [readingSaving, setReadingSaving] = useState(false);
  /** 弱网优化：压缩 / 上传阶段提示（移动端可读） */
  const [diaryPhaseMessage, setDiaryPhaseMessage] = useState("");
  const [readingPhaseMessage, setReadingPhaseMessage] = useState("");

  const [diaryItems, setDiaryItems] = useState([]);
  const [readingItems, setReadingItems] = useState([]);

  const [previewModal, setPreviewModal] = useState(null);
  const [modalImageError, setModalImageError] = useState(false);
  const diaryInputRef = useRef(null);
  const readingInputRef = useRef(null);

  const nextId = useRef(0);
  const diaryItemsRef = useRef([]);
  const readingItemsRef = useRef([]);
  diaryItemsRef.current = diaryItems;
  readingItemsRef.current = readingItems;

  function makeImageItem(file) {
    const id = `img-${Date.now()}-${nextId.current++}`;
    return { id, file, previewUrl: URL.createObjectURL(file) };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (cancelled || !u) {
        setLoading(false);
        return;
      }
      setUser(u);
      let s = await getOrCreateStudent(u);
      if (cancelled || !s) {
        setLoading(false);
        return;
      }
      s = await ensureStudentDisplayNameIfEmpty(s, u, getAndClearPendingDisplayName);
      if (!cancelled) setStudent(s);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!diarySuccess) return;
    const t = setTimeout(() => setDiarySuccess(null), 6000);
    return () => clearTimeout(t);
  }, [diarySuccess]);

  useEffect(() => {
    if (!readingSuccess) return;
    const t = setTimeout(() => setReadingSuccess(null), 6000);
    return () => clearTimeout(t);
  }, [readingSuccess]);

  async function refreshStudentAfterUpload() {
    if (!user) return;
    try {
      let s = await getOrCreateStudent(user);
      if (s) {
        s = await ensureStudentDisplayNameIfEmpty(s, user, getAndClearPendingDisplayName);
        setStudent(s);
      }
      emitStudentRecordsUpdated();
    } catch (_) {}
  }

  const revokeUrls = useCallback((urls) => {
    urls.forEach((u) => {
      try {
        if (u && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(u);
      } catch (_) {}
    });
  }, []);

  useEffect(() => {
    return () => {
      diaryItemsRef.current.forEach((item) => {
        try {
          if (item?.previewUrl && typeof URL.revokeObjectURL === "function")
            URL.revokeObjectURL(item.previewUrl);
        } catch (_) {}
      });
      readingItemsRef.current.forEach((item) => {
        try {
          if (item?.previewUrl && typeof URL.revokeObjectURL === "function")
            URL.revokeObjectURL(item.previewUrl);
        } catch (_) {}
      });
    };
  }, []);

  useEffect(() => {
    setModalImageError(false);
  }, [previewModal]);

  function onDiarySelect(e) {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;
    const newItems = newFiles.map((f) => makeImageItem(f));
    setDiaryItems((prev) => [...prev, ...newItems]);
    if (diaryInputRef.current) diaryInputRef.current.value = "";
  }

  function onReadingSelect(e) {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;
    const file = newFiles[0];
    // 阅读记录：仅保留当前拍摄的一张，替换时释放旧预览 URL
    setReadingItems((prev) => {
      prev.forEach((item) => {
        if (item?.previewUrl) revokeUrls([item.previewUrl]);
      });
      return [makeImageItem(file)];
    });
    if (readingInputRef.current) readingInputRef.current.value = "";
  }

  function removeDiaryAt(i) {
    const item = diaryItems[i];
    if (item?.previewUrl) revokeUrls([item.previewUrl]);
    setDiaryItems((prev) => prev.filter((_, j) => j !== i));
    if (previewModal?.type === "diary" && (previewModal.index === i || previewModal.index > i)) {
      const next = previewModal.index === i ? (i >= 1 ? i - 1 : 0) : previewModal.index - 1;
      if (diaryItems.length <= 1) setPreviewModal(null);
      else setPreviewModal({ type: "diary", index: Math.max(0, next) });
    }
  }

  function removeReadingAt(i) {
    const item = readingItems[i];
    if (item?.previewUrl) revokeUrls([item.previewUrl]);
    setReadingItems((prev) => prev.filter((_, j) => j !== i));
    if (previewModal?.type === "reading" && (previewModal.index === i || previewModal.index > i)) {
      const next = previewModal.index === i ? (i >= 1 ? i - 1 : 0) : previewModal.index - 1;
      if (readingItems.length <= 1) setPreviewModal(null);
      else setPreviewModal({ type: "reading", index: Math.max(0, next) });
    }
  }

  async function startDiaryUpload() {
    if (!student?.id || diaryItems.length === 0) return;
    setDiarySaving(true);
    setUploadError("");
    setShowBucketBanner(false);
    const today = new Date().toISOString().slice(0, 10);
    const items = diaryItems;
    try {
      for (let i = 0; i < items.length; i++) {
        const path = await uploadDiaryImage(student.id, items[i].file, i);
        await createDiaryRecord({
          student_id: student.id,
          upload_date: today,
          image_path: path,
          corrected_text: "",
        });
      }
      setDiarySuccess({ photos: items.length });
      items.forEach((item) => revokeUrls([item.previewUrl]));
      setDiaryItems([]);
      await refreshStudentAfterUpload();
    } catch (err) {
      if (isBucketMissingError(err)) setShowBucketBanner(true);
      else
        setUploadError(
          err?.message
            ? `上传未成功：${err.message}。请检查网络后重试。`
            : "上传未成功，请检查网络后重试。"
        );
    } finally {
      setDiaryPhaseMessage("");
      setDiarySaving(false);
    }
  }

  async function startReadingUpload() {
    if (!student?.id || readingItems.length === 0) return;
    setReadingSaving(true);
    setUploadError("");
    setShowBucketBanner(false);
    const today = new Date().toISOString().slice(0, 10);
    const items = readingItems;
    const recognizedDaysInBatch = new Set();
    try {
      for (let i = 0; i < items.length; i++) {
        setReadingPhaseMessage("正在优化图片，请稍候…");
        const fileToUpload = await compressImageForUpload(items[i].file);
        setReadingPhaseMessage("上传中，请稍候…");
        const path = await uploadReadingImage(student.id, fileToUpload, i);
        const formData = new FormData();
        formData.append("image", fileToUpload);
        let extraction = {
          total_words: null,
          total_time_minutes: null,
          total_reading_days: null,
          confidence: 0,
          raw_text: "",
        };
        try {
          const res = await fetch("/api/extract-reading", { method: "POST", body: formData });
          const data = await res.json();
          if (
            data &&
            (data.total_words != null ||
              data.total_time_minutes != null ||
              data.total_reading_days != null ||
              (Array.isArray(data.daily_records_json) && data.daily_records_json.length > 0))
          ) {
            extraction = data;
          }
        } catch (_) {}
        const status =
          extraction.extraction_status ||
          (extraction.confidence > 0 ||
          extraction.total_words != null ||
          extraction.total_time_minutes != null
            ? "success"
            : "failed");

        const dailyNorm = normalizeDailyRecordsJson(extraction.daily_records_json);
        const readingDaysPersist =
          Array.isArray(extraction.reading_days) && extraction.reading_days.length > 0
            ? extraction.reading_days
            : deriveReadingDaysDescending(dailyNorm);

        normalizeReadingDaysArray(readingDaysPersist).forEach((d) => recognizedDaysInBatch.add(d));

        const readingInsertPayload = {
          student_id: student.id,
          upload_date: today,
          image_path: path,
          total_words: extraction.total_words ?? 0,
          total_time_minutes: extraction.total_time_minutes ?? 0,
          weekly_new_words: 0,
          weekly_new_time: 0,
          extraction_status: status,
          total_reading_days: extraction.total_reading_days ?? null,
          confidence: extraction.confidence ?? 0,
          raw_text: extraction.raw_text ?? "",
          total_books: extraction.total_books ?? null,
          daily_records_json: dailyNorm,
          reading_days: readingDaysPersist,
        };

        console.log("[student] post-OCR createReadingRecord payload (summary):", {
          total_words: readingInsertPayload.total_words,
          total_time_minutes: readingInsertPayload.total_time_minutes,
          total_books: readingInsertPayload.total_books,
          total_reading_days: readingInsertPayload.total_reading_days,
          daily_records_json_length: readingInsertPayload.daily_records_json.length,
          reading_days: readingInsertPayload.reading_days,
          extraction_status: readingInsertPayload.extraction_status,
        });

        const created = await createReadingRecord(readingInsertPayload);
        if (!created?.id) {
          console.error("[student] createReadingRecord returned no id — cannot persist OCR", created);
          throw new Error("阅读记录创建失败：未返回 id");
        }

        console.log(
          "[student] chaining OCR persistence: update reading_records row id =",
          created.id
        );
        try {
          await persistReadingOcrToRecord(created.id, readingInsertPayload);
          console.log(
            "[student] persistReadingOcrToRecord SUCCESS — reading_days should now be in Supabase for id",
            created.id
          );
        } catch (persistErr) {
          console.error(
            "[student] persistReadingOcrToRecord FAILED — row may lack reading_days / daily_records_json",
            persistErr?.message || persistErr
          );
          throw persistErr;
        }
      }
      setReadingPhaseMessage("");
      setReadingSuccess({
        photos: items.length,
        daysRecognized: recognizedDaysInBatch.size,
      });
      items.forEach((item) => revokeUrls([item.previewUrl]));
      setReadingItems([]);
      await refreshStudentAfterUpload();
    } catch (err) {
      if (isBucketMissingError(err)) setShowBucketBanner(true);
      else
        setUploadError(
          err?.message
            ? `上传未成功：${err.message}。请检查网络后重试。`
            : "上传未成功，请检查网络后重试。"
        );
    } finally {
      setReadingPhaseMessage("");
      setReadingSaving(false);
    }
  }

  const diaryPreviewList = diaryItems.length > 0;
  const readingPreviewList = readingItems.length > 0;

  const previewModalItems = previewModal?.type === "diary" ? diaryItems : readingItems;
  const previewModalIndex = Math.min(
    previewModal?.index ?? 0,
    Math.max(0, (previewModalItems?.length ?? 1) - 1)
  );
  const previewModalTotal = previewModalItems?.length ?? 0;
  const currentPreviewItem = previewModalItems?.[previewModalIndex] ?? null;
  const currentPreviewUrl = currentPreviewItem?.previewUrl ?? null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-gray-500">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Alert variant="warning">未登录</Alert>
        <Link href="/login" className="text-teal-600 hover:underline">
          去登录
        </Link>
      </div>
    );
  }

  if (!student) {
    return <Alert variant="error">无法加载学生资料</Alert>;
  }

  const displayName = formatStudentDisplayName(student, "同学");

  return (
    <div className="space-y-6 sm:space-y-10 pb-8 sm:pb-10 max-w-lg mx-auto w-full min-w-0">
      {showBucketBanner && <Alert variant="warning">{BUCKET_BANNER_ZH}</Alert>}
      {uploadError && <Alert variant="error">{uploadError}</Alert>}
      {diarySaving && diaryPhaseMessage && (
        <p
          className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-medium text-teal-900"
          role="status"
          aria-live="polite"
        >
          {diaryPhaseMessage}
        </p>
      )}
      {readingSaving && readingPhaseMessage && (
        <p
          className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-medium text-teal-900"
          role="status"
          aria-live="polite"
        >
          {readingPhaseMessage}
        </p>
      )}

      <div className="rounded-2xl border border-teal-100/80 bg-white/90 px-4 py-3.5 sm:px-5 sm:py-5 shadow-sm">
        <p className="text-lg sm:text-xl font-semibold text-gray-900 leading-snug break-words">
          你好，
          <span className="block sm:inline sm:ml-1">{displayName}</span>
        </p>
        <p className="text-xs sm:text-sm text-gray-600 mt-1.5 leading-relaxed">
          先传阅读记录，再传英语日记。
        </p>
      </div>

      <div className="flex flex-col gap-6 sm:gap-10">
        {/* 上传阅读记录 */}
        <Card className="overflow-hidden shadow-sm border-teal-100/60">
          <input
            ref={readingInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onReadingSelect}
            disabled={readingSaving}
          />
          <div className="p-4 sm:p-7 space-y-4 sm:space-y-5">
            <button
              type="button"
              onClick={() => readingInputRef.current?.click()}
              disabled={readingSaving}
              className="w-full min-h-[156px] sm:min-h-[172px] flex flex-col items-center justify-center gap-2 sm:gap-3 px-4 sm:px-6 py-6 sm:py-8 rounded-2xl border-2 border-teal-200 bg-gradient-to-b from-teal-50/90 to-teal-50 hover:from-teal-100 hover:to-teal-50 hover:border-teal-300 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 shadow-sm"
            >
              <span className="text-4xl sm:text-5xl" aria-hidden>
                📷
              </span>
              <span className="text-lg sm:text-xl font-bold text-gray-900 text-center px-1">
                上传阅读记录
              </span>
              <span className="text-sm text-gray-600 text-center px-2 leading-relaxed">
                请拍摄平板上的阅读记录页面（单张）
              </span>
              <span className="text-base font-semibold text-teal-700">点这里打开相机</span>
            </button>

            {readingPreviewList && (
              <>
                <div className="flex flex-wrap gap-4">
                  {readingItems.map((item, i) => (
                    <div key={item.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ type: "reading", index: i })}
                        className="block w-24 h-24 rounded-2xl overflow-hidden border-2 border-teal-200 bg-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400"
                      >
                        <img
                          src={item.previewUrl}
                          alt={`预览 ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeReadingAt(i);
                        }}
                        className="absolute -top-1 -right-1 w-9 h-9 rounded-full bg-red-500 text-white text-xl leading-none flex items-center justify-center shadow hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-offset-1"
                        aria-label="删除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={startReadingUpload}
                  disabled={readingSaving}
                  className="w-full min-h-12 text-base font-semibold rounded-xl"
                >
                  {readingSaving ? "上传中，请稍候…" : "开始上传阅读记录"}
                </Button>
              </>
            )}
            {readingSuccess && (
              <div
                className="rounded-2xl bg-emerald-50 border-2 border-emerald-200 px-5 py-5 text-center space-y-2"
                role="status"
                aria-live="polite"
              >
                <p className="text-base font-bold text-emerald-900">上传成功</p>
                <p className="text-sm text-emerald-900/90 leading-relaxed">
                  已成功保存 {readingSuccess.photos} 张照片到系统。
                </p>
                {readingSuccess.daysRecognized > 0 ? (
                  <p className="text-sm text-emerald-900/90 leading-relaxed font-medium">
                    识别到 {readingSuccess.daysRecognized} 个阅读打卡日期。请到顶部「历史学习记录」核对打卡日历。
                  </p>
                ) : (
                  <p className="text-sm text-amber-900/90 leading-relaxed">
                    本次未识别到具体阅读日期，可请老师在后台核对或补录。
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* 上传英语日记 */}
        <Card className="overflow-hidden shadow-sm border-teal-100/60">
          <input
            ref={diaryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onDiarySelect}
            disabled={diarySaving}
          />
          <div className="p-4 sm:p-7 space-y-4 sm:space-y-5">
            <button
              type="button"
              onClick={() => diaryInputRef.current?.click()}
              disabled={diarySaving}
              className="w-full min-h-[156px] sm:min-h-[172px] flex flex-col items-center justify-center gap-2 sm:gap-3 px-4 sm:px-6 py-6 sm:py-8 rounded-2xl border-2 border-teal-200 bg-gradient-to-b from-teal-50/90 to-teal-50 hover:from-teal-100 hover:to-teal-50 hover:border-teal-300 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 shadow-sm"
            >
              <span className="text-4xl sm:text-5xl" aria-hidden>
                📔
              </span>
              <span className="text-lg sm:text-xl font-bold text-gray-900 text-center px-1">
                上传英语日记
              </span>
              <span className="text-sm text-gray-600 text-center leading-relaxed">
                可选择多张日记照片一次性上传
              </span>
            </button>

            {diaryPreviewList && (
              <>
                <div className="flex flex-wrap gap-4">
                  {diaryItems.map((item, i) => (
                    <div key={item.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ type: "diary", index: i })}
                        className="block w-24 h-24 rounded-2xl overflow-hidden border-2 border-teal-200 bg-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400"
                      >
                        <img
                          src={item.previewUrl}
                          alt={`预览 ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDiaryAt(i);
                        }}
                        className="absolute -top-1 -right-1 w-9 h-9 rounded-full bg-red-500 text-white text-xl leading-none flex items-center justify-center shadow hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-offset-1"
                        aria-label="删除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={startDiaryUpload}
                  disabled={diarySaving}
                  className="w-full min-h-12 text-base font-semibold rounded-xl"
                >
                  {diarySaving ? "上传中，请稍候…" : "开始上传英语日记"}
                </Button>
              </>
            )}
            {diarySuccess && (
              <div
                className="rounded-2xl bg-emerald-50 border-2 border-emerald-200 px-5 py-5 text-center space-y-2"
                role="status"
                aria-live="polite"
              >
                <p className="text-base font-bold text-emerald-900">上传成功</p>
                <p className="text-sm text-emerald-900/90 leading-relaxed">
                  已成功上传 {diarySuccess.photos} 张照片。老师批改后，在「历史学习记录」中查看。
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Preview modal */}
      {previewModal && previewModalItems?.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setPreviewModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <div
            className="relative bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-h-[70vh] flex justify-center items-center min-h-[200px]">
              {currentPreviewUrl && !modalImageError ? (
                <img
                  key={`${previewModal?.type}-${previewModalIndex}-${currentPreviewUrl}`}
                  src={currentPreviewUrl}
                  alt={`预览 ${previewModalIndex + 1}`}
                  className="max-h-[70vh] w-auto object-contain rounded-xl"
                  onError={() => setModalImageError(true)}
                />
              ) : (
                <p className="text-gray-500 text-sm">无法显示图片预览</p>
              )}
            </div>
            <div className="flex items-center justify-center gap-4 mt-4">
              {previewModalTotal > 1 && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPreviewModal({
                        ...previewModal,
                        index: (previewModalIndex - 1 + previewModalTotal) % previewModalTotal,
                      })
                    }
                  >
                    上一张
                  </Button>
                  <span className="text-sm text-gray-600">
                    {previewModalIndex + 1} / {previewModalTotal}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPreviewModal({
                        ...previewModal,
                        index: (previewModalIndex + 1) % previewModalTotal,
                      })
                    }
                  >
                    下一张
                  </Button>
                </>
              )}
            </div>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => setPreviewModal(null)}
            >
              关闭
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
