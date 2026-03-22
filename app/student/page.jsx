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
} from "@/lib/readingRecordOcr";
import { getAndClearPendingDisplayName } from "@/lib/pendingDisplayName";
import { uploadDiaryImage, uploadReadingImage } from "@/lib/storage";
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
  const [diarySuccessCount, setDiarySuccessCount] = useState(0);
  const [readingSuccessCount, setReadingSuccessCount] = useState(0);
  const [diarySaving, setDiarySaving] = useState(false);
  const [readingSaving, setReadingSaving] = useState(false);

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
    if (diarySuccessCount === 0) return;
    const t = setTimeout(() => setDiarySuccessCount(0), 3000);
    return () => clearTimeout(t);
  }, [diarySuccessCount]);

  useEffect(() => {
    if (readingSuccessCount === 0) return;
    const t = setTimeout(() => setReadingSuccessCount(0), 3000);
    return () => clearTimeout(t);
  }, [readingSuccessCount]);

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
      setDiarySuccessCount(items.length);
      items.forEach((item) => revokeUrls([item.previewUrl]));
      setDiaryItems([]);
    } catch (err) {
      if (isBucketMissingError(err)) setShowBucketBanner(true);
      else setUploadError(err?.message || "上传失败，请重试");
    } finally {
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
    try {
      for (let i = 0; i < items.length; i++) {
        const path = await uploadReadingImage(student.id, items[i].file, i);
        const formData = new FormData();
        formData.append("image", items[i].file);
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
      setReadingSuccessCount(items.length);
      items.forEach((item) => revokeUrls([item.previewUrl]));
      setReadingItems([]);
    } catch (err) {
      if (isBucketMissingError(err)) setShowBucketBanner(true);
      else setUploadError(err?.message || "上传失败，请重试");
    } finally {
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

  const displayName = (student.display_name || "").trim() || "同学";

  return (
    <div className="space-y-8">
      {showBucketBanner && <Alert variant="warning">{BUCKET_BANNER_ZH}</Alert>}
      {uploadError && <Alert variant="error">{uploadError}</Alert>}

      <Card>
        <CardContent className="pt-6">
          <p className="text-lg text-gray-800">你好呀，{displayName}，开始今天的英语学习吧！</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2">
        {/* 上传英语日记 */}
        <Card className="overflow-hidden">
          <input
            ref={diaryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onDiarySelect}
            disabled={diarySaving}
          />
          <div className="p-6 space-y-4">
            <button
              type="button"
              onClick={() => diaryInputRef.current?.click()}
              disabled={diarySaving}
              className="w-full min-h-[140px] flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:border-teal-300 transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2"
            >
              <span className="text-4xl" aria-hidden>📔</span>
              <span className="text-lg font-semibold text-gray-800">上传英语日记</span>
              <span className="text-sm text-gray-600">点击选择多张图片</span>
            </button>

            {diaryPreviewList && (
              <>
                <div className="flex flex-wrap gap-3">
                  {diaryItems.map((item, i) => (
                    <div key={item.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ type: "diary", index: i })}
                        className="block w-20 h-20 rounded-xl overflow-hidden border-2 border-teal-200 bg-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400"
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
                        className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-red-500 text-white text-lg leading-none flex items-center justify-center shadow hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-offset-1"
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
                  className="w-full"
                >
                  {diarySaving ? "上传中…" : "开始上传"}
                </Button>
              </>
            )}
            {diarySuccessCount > 0 && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center">
                <p className="text-sm font-medium text-emerald-800">
                  上传成功：已上传 {diarySuccessCount} 张照片
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* 上传阅读记录 */}
        <Card className="overflow-hidden">
          <input
            ref={readingInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onReadingSelect}
            disabled={readingSaving}
          />
          <div className="p-6 space-y-4">
            <button
              type="button"
              onClick={() => readingInputRef.current?.click()}
              disabled={readingSaving}
              className="w-full min-h-[140px] flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:border-teal-300 transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2"
            >
              <span className="text-4xl" aria-hidden>📷</span>
              <span className="text-lg font-semibold text-gray-800">拍摄阅读记录</span>
              <span className="text-sm text-gray-600 text-center px-2">
                请直接拍摄平板上的阅读记录页面
              </span>
              <span className="text-base font-semibold text-teal-700">打开相机拍照</span>
            </button>

            {readingPreviewList && (
              <>
                <div className="flex flex-wrap gap-3">
                  {readingItems.map((item, i) => (
                    <div key={item.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ type: "reading", index: i })}
                        className="block w-20 h-20 rounded-xl overflow-hidden border-2 border-teal-200 bg-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400"
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
                        className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-red-500 text-white text-lg leading-none flex items-center justify-center shadow hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-offset-1"
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
                  className="w-full"
                >
                  {readingSaving ? "上传中…" : "开始上传"}
                </Button>
              </>
            )}
            {readingSuccessCount > 0 && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center">
                <p className="text-sm font-medium text-emerald-800">
                  上传成功：已上传 {readingSuccessCount} 张照片
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
