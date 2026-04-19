"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeReadingDaysArray,
  datesAscendingFromDailyJson,
  normalizeRowDateString,
} from "@/lib/readingRecordOcr";
import { sumWordsInSundayWeekFromDailyRecordsThisImageOnly } from "@/lib/readingDailyRowHelpers";
import { minutesToHoursMinutes, hoursMinutesToMinutes, formatMinutesToHourMinute } from "@/lib/timeFormat";
import { FeedReadingWeekCalendar } from "@/components/teacher/FeedReadingWeekCalendar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function newImageItem(file) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    ocrResult: null,
    status: "pending",
    errorMessage: "",
  };
}

const STATUS_LABEL = {
  pending: "未识别",
  ocr_ing: "识别中",
  ocr_done: "已识别",
  saved: "已保存",
  error: "识别失败",
};

/** @param {any} r — ocrResult */
function buildConfirmDraftFromOcr(r) {
  const name = String(r?.student_name || "").trim();
  const { hours, minutes } = minutesToHoursMinutes(
    r?.total_time_minutes == null || r?.total_time_minutes === "" ? 0 : r.total_time_minutes
  );
  const fromOcrRd = normalizeReadingDaysArray(r?.reading_days);
  const fromDaily = datesAscendingFromDailyJson(Array.isArray(r?.daily_records_json) ? r.daily_records_json : []);
  const computedWeekWords = sumWordsInSundayWeekFromDailyRecordsThisImageOnly(r?.daily_records_json);
  const weekWords = Math.max(0, Math.floor(Number(computedWeekWords) || 0));
  const editableWeekWords = String(weekWords);
  return {
    editableStudentName: name,
    ocrBaselineName: name,
    editableTotalWords: r?.total_words != null ? String(r.total_words) : "",
    weekWords,
    editableWeekWords,
    editableHours: String(hours),
    editableMinutes: String(minutes),
    editableTotalBooks: r?.total_books != null ? String(r.total_books) : "",
    editableTotalReadingDays: r?.total_reading_days != null ? String(r.total_reading_days) : "",
    editableReadingDays: fromOcrRd.length ? [...fromOcrRd] : [...fromDaily],
  };
}

/** 若 item 上尚未写入本周新单词初值，则根据当前 ocr 补全（不覆盖老师已改过的 editableWeekWords） */
function mergeWeekWordsIfMissing(item) {
  if (!item?.ocrResult) return item;
  if (Object.prototype.hasOwnProperty.call(item, "editableWeekWords") && item.editableWeekWords !== undefined) {
    return item;
  }
  const { weekWords, editableWeekWords } = buildConfirmDraftFromOcr(item.ocrResult);
  return { ...item, weekWords, editableWeekWords };
}

function itemHasOcrReady(item) {
  return Boolean(item?.ocrResult) && item.status !== "pending" && item.status !== "ocr_ing";
}

/** 从列表项读取弹窗可编辑快照（以 item 为准，不回写 OCR 覆盖老师已改字段） */
function getEditableSliceFromItem(item) {
  if (!item?.ocrResult) return null;
  const fromOcr = buildConfirmDraftFromOcr(item.ocrResult);
  if (!("editableStudentName" in item)) return fromOcr;
  return {
    editableStudentName: item.editableStudentName,
    ocrBaselineName: item.ocrBaselineName ?? fromOcr.ocrBaselineName,
    editableTotalWords: item.editableTotalWords ?? "",
    editableWeekWords:
      item.editableWeekWords !== undefined && item.editableWeekWords !== null
        ? String(item.editableWeekWords)
        : fromOcr.editableWeekWords,
    editableHours: item.editableHours ?? "0",
    editableMinutes: item.editableMinutes ?? "0",
    editableTotalBooks: item.editableTotalBooks ?? "",
    editableTotalReadingDays: item.editableTotalReadingDays ?? "",
    editableReadingDays: Array.isArray(item.editableReadingDays) ? [...item.editableReadingDays] : fromOcr.editableReadingDays,
  };
}

/** 阅读记录上传与 OCR（嵌入「记录上传页面」） */
export default function ReadingRecordSection({ onSaved }) {
  /**
   * 每张图：file / ocrResult / status + 可编辑字段（与 OCR 后写入，老师修改写回同一条）
   * @type {{ id: string; file: File; previewUrl: string; ocrResult: any; status: string; errorMessage: string; editableStudentName?: string; ocrBaselineName?: string; editableTotalWords?: string; weekWords?: number; editableWeekWords?: string; editableHours?: string; editableMinutes?: string; editableTotalBooks?: string; editableTotalReadingDays?: string; editableReadingDays?: string[] }[]}
   */
  const [selectedImages, setSelectedImages] = useState([]);
  const selectedImagesRef = useRef(selectedImages);
  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  const [fileInputKey, setFileInputKey] = useState(0);
  /** 仅用于「开始 OCR」整段识别；弹窗打开期间必须为 false，否则底部按钮会全部被 disabled */
  const [busy, setBusy] = useState(false);
  /** 仅「确认并保存」请求中 */
  const [savingReading, setSavingReading] = useState(false);
  const [hint, setHint] = useState("");
  const [saveError, setSaveError] = useState("");

  const [confirmModal, setConfirmModal] = useState(null);
  const confirmModalRef = useRef(null);
  const [confirmOrderedIds, setConfirmOrderedIds] = useState([]);
  const [confirmCurrentIndex, setConfirmCurrentIndex] = useState(0);
  const confirmOrderedIdsRef = useRef([]);
  const confirmCurrentIndexRef = useRef(0);
  useEffect(() => {
    confirmOrderedIdsRef.current = confirmOrderedIds;
  }, [confirmOrderedIds]);
  useEffect(() => {
    confirmCurrentIndexRef.current = confirmCurrentIndex;
  }, [confirmCurrentIndex]);
  const confirmAdvanceRef = useRef(null);

  const [lightboxUrl, setLightboxUrl] = useState(null);

  const appendFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setSelectedImages((prev) => [...prev, ...files.map(newImageItem)]);
    setFileInputKey((k) => k + 1);
  }, []);

  function syncRefAfterImages(next) {
    selectedImagesRef.current = next;
  }

  const removeImage = useCallback((id) => {
    const orderBefore = confirmOrderedIdsRef.current;
    const wasCurrent = confirmModalRef.current?.id === id;
    const inQueue = orderBefore.includes(id);
    const nextOrder = orderBefore.filter((x) => x !== id);

    setSelectedImages((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((x) => x.id !== id);
      syncRefAfterImages(next);
      return next;
    });

    if (inQueue) {
      if (!wasCurrent) {
        const curId = confirmModalRef.current?.id;
        const curIdx = curId != null ? orderBefore.indexOf(curId) : -1;
        const rm = orderBefore.indexOf(id);
        if (curId && rm >= 0 && curIdx >= 0 && rm < curIdx) {
          setConfirmCurrentIndex((i) => Math.max(0, i - 1));
        }
      }
      setConfirmOrderedIds(nextOrder);
    }

    if (!wasCurrent) return;

    if (nextOrder.length === 0) {
      const r = confirmAdvanceRef.current;
      confirmAdvanceRef.current = null;
      confirmModalRef.current = null;
      setConfirmModal(null);
      setConfirmOrderedIds([]);
      setConfirmCurrentIndex(0);
      setSaveError("");
      r?.();
      return;
    }
    const oldIdx = orderBefore.indexOf(id);
    const newIdx = Math.min(oldIdx, nextOrder.length - 1);
    const nid = nextOrder[newIdx];
    const item = selectedImagesRef.current.find((x) => x.id === nid);
    if (!item) {
      const r = confirmAdvanceRef.current;
      confirmAdvanceRef.current = null;
      confirmModalRef.current = null;
      setConfirmModal(null);
      setConfirmOrderedIds([]);
      setConfirmCurrentIndex(0);
      setSaveError("");
      r?.();
      return;
    }
    setSelectedImages((prev) => {
      const nextList = prev.map((x) => (x.id === nid ? mergeWeekWordsIfMissing(x) : x));
      syncRefAfterImages(nextList);
      return nextList;
    });
    const merged = mergeWeekWordsIfMissing(item);
    const payload = {
      id: merged.id,
      file: merged.file,
      previewUrl: merged.previewUrl,
      ocrResult: merged.ocrResult,
    };
    confirmModalRef.current = payload;
    setConfirmModal(payload);
    setConfirmCurrentIndex(newIdx);
  }, []);

  useEffect(() => {
    return () => {
      selectedImagesRef.current.forEach((x) => {
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      });
    };
  }, []);

  function waitForConfirmClose() {
    return new Promise((resolve) => {
      confirmAdvanceRef.current = resolve;
    });
  }

  function finishConfirmStep() {
    const r = confirmAdvanceRef.current;
    confirmAdvanceRef.current = null;
    confirmModalRef.current = null;
    setConfirmModal(null);
    setConfirmOrderedIds([]);
    setConfirmCurrentIndex(0);
    setSaveError("");
    r?.();
  }

  /** 将弹窗内编辑写回 selectedImages[id]（单一数据源） */
  function patchSelectedImageDraft(id, partial) {
    if (!id) return;
    setSelectedImages((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, ...partial } : x));
      syncRefAfterImages(next);
      return next;
    });
  }

  async function runOcrForId(id) {
    const item = selectedImagesRef.current.find((x) => x.id === id);
    if (!item || item.status === "saved") return null;

    setSelectedImages((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, status: "ocr_ing", errorMessage: "" } : x));
      syncRefAfterImages(next);
      return next;
    });

    let ocrResult;
    try {
      const fd = new FormData();
      fd.append("image", item.file);
      const res = await fetch("/api/extract-reading", { method: "POST", body: fd });
      ocrResult = await res.json().catch(() => ({}));
    } catch (e) {
      console.error("[teacher] OCR failed", e);
      ocrResult = {
        extraction_status: "failed",
        student_name: "",
        daily_records_json: [],
        reading_days: [],
        _networkError: e?.message || String(e),
      };
    }

    const errMsg = ocrResult?._networkError || ocrResult?.error || ocrResult?.errorDetail || "";
    const networkFailed = Boolean(ocrResult?._networkError);
    const listStatus = networkFailed ? "error" : "ocr_done";
    const draft = buildConfirmDraftFromOcr(ocrResult);

    setSelectedImages((prev) => {
      const next = prev.map((x) =>
        x.id === id
          ? {
              ...x,
              status: listStatus,
              ocrResult,
              errorMessage: errMsg,
              ...draft,
            }
          : x
      );
      syncRefAfterImages(next);
      return next;
    });

    return {
      id,
      file: item.file,
      previewUrl: item.previewUrl,
      ocrResult,
    };
  }

  /** 当前列表中所有「已可确认」的图片 id（顺序与 selectedImages 一致） */
  function getOcrReadyOrderedIds() {
    return selectedImagesRef.current.filter(itemHasOcrReady).map((x) => x.id);
  }

  /** 从缩略图打开：不切 waitForConfirmClose，仅展示 */
  function openConfirmModalFromThumbnail(clickedId) {
    if (busy) {
      console.log("[confirm] thumbnail ignored: 批量 OCR 进行中");
      return;
    }
    const items = selectedImagesRef.current;
    const clicked = items.find((x) => x.id === clickedId);
    const idxInList = items.findIndex((x) => x.id === clickedId);
    console.log("[confirm] thumbnail click", { clickedId, indexInSelectedImages: idxInList, status: clicked?.status });

    if (!itemHasOcrReady(clicked)) {
      console.log("[confirm] thumbnail ignored: OCR 未就绪", { status: clicked?.status });
      setHint("请先点击「开始 OCR 识别」完成识别后，再点开此图。");
      return;
    }

    const ocrIds = getOcrReadyOrderedIds();
    const idx = ocrIds.indexOf(clickedId);
    if (idx < 0) return;

    setSaveError("");
    setConfirmOrderedIds(ocrIds);
    setConfirmCurrentIndex(idx);
    const payload = {
      id: clicked.id,
      file: clicked.file,
      previewUrl: clicked.previewUrl,
      ocrResult: clicked.ocrResult,
    };
    confirmModalRef.current = payload;
    setConfirmModal(payload);
    console.log("[confirm] open modal from thumbnail", { currentIndex: idx, orderedCount: ocrIds.length });
  }

  async function openConfirmBatchModal(payloads) {
    const list = (payloads || []).filter((p) => p && p.ocrResult != null);
    if (!list.length) return;
    setSaveError("");
    const orderedIds = list.map((p) => p.id);
    setConfirmOrderedIds(orderedIds);
    setConfirmCurrentIndex(0);
    const first = list[0];
    confirmModalRef.current = first;
    setConfirmModal(first);
    console.log("[confirm] open batch modal", { currentIndex: 0, orderedIds });
    await waitForConfirmClose();
  }

  function goConfirmDelta(delta) {
    if (savingReading) {
      console.log("[confirm] 上/下一个 disabled: 正在保存 reading");
      return;
    }
    const next = confirmCurrentIndex + delta;
    if (next < 0 || next >= confirmOrderedIds.length) {
      console.log("[confirm] 上/下一个 noop", { delta, confirmCurrentIndex, len: confirmOrderedIds.length });
      return;
    }
    const nid = confirmOrderedIds[next];
    const item = selectedImagesRef.current.find((x) => x.id === nid);
    if (!item?.ocrResult) return;
    setSelectedImages((prev) => {
      const nextList = prev.map((x) => (x.id === nid ? mergeWeekWordsIfMissing(x) : x));
      syncRefAfterImages(nextList);
      return nextList;
    });
    const merged = mergeWeekWordsIfMissing(item);
    const payload = {
      id: merged.id,
      file: merged.file,
      previewUrl: merged.previewUrl,
      ocrResult: merged.ocrResult,
    };
    confirmModalRef.current = payload;
    setConfirmModal(payload);
    setConfirmCurrentIndex(next);
    setSaveError("");
    console.log("[confirm] navigate", { newIndex: next, imageId: nid });
  }

  function handleModalSkipCurrent() {
    if (savingReading) {
      console.log("[confirm] 跳过此张 disabled: 正在保存");
      return;
    }
    const id = confirmModalRef.current?.id;
    if (!id) return;
    const order = confirmOrderedIdsRef.current;
    const nextOrder = order.filter((x) => x !== id);
    setConfirmOrderedIds(nextOrder);
    console.log("[confirm] skip current", { id, remaining: nextOrder.length });

    if (nextOrder.length === 0) {
      finishConfirmStep();
      return;
    }
    const oldIdx = order.indexOf(id);
    const newIdx = Math.min(oldIdx, nextOrder.length - 1);
    const nid = nextOrder[newIdx];
    const item = selectedImagesRef.current.find((x) => x.id === nid);
    if (!item?.ocrResult) {
      finishConfirmStep();
      return;
    }
    setSelectedImages((prev) => {
      const nextList = prev.map((x) => (x.id === nid ? mergeWeekWordsIfMissing(x) : x));
      syncRefAfterImages(nextList);
      return nextList;
    });
    const merged = mergeWeekWordsIfMissing(item);
    const payload = {
      id: merged.id,
      file: merged.file,
      previewUrl: merged.previewUrl,
      ocrResult: merged.ocrResult,
    };
    confirmModalRef.current = payload;
    setConfirmModal(payload);
    setConfirmCurrentIndex(newIdx);
    setSaveError("");
  }

  async function saveOneReadingRecord(item, teacher) {
    const ocr = item?.ocrResult || {};
    const finalName = String(teacher.confirmedStudentName || "").trim();
    if (!finalName) throw new Error("请先填写学生姓名");

    console.log("[save-reading client] POST /api/save-reading-record", {
      imageId: item?.id,
      confirmedStudentName: finalName,
      totalWords: teacher.totalWords,
      totalTimeMinutes: teacher.totalTimeMinutes,
      totalBooks: teacher.totalBooks,
      totalReadingDays: teacher.totalReadingDays,
      weeklyNewWords: teacher.weeklyNewWords,
      readingDaysLen: Array.isArray(teacher.readingDaysYmd) ? teacher.readingDaysYmd.length : null,
    });

    const fd = new FormData();
    fd.append("image", item.file);
    fd.append("confirmed_student_name", finalName);
    fd.append("ocr_student_name", String(ocr.student_name ?? "").trim());
    fd.append("student_name", finalName);
    fd.append("total_words", teacher.totalWords === null || teacher.totalWords === undefined ? "" : String(teacher.totalWords));
    fd.append("total_time_minutes", teacher.totalTimeMinutes === null || teacher.totalTimeMinutes === undefined ? "" : String(teacher.totalTimeMinutes));
    fd.append("total_books", teacher.totalBooks === null || teacher.totalBooks === undefined ? "" : String(teacher.totalBooks));
    fd.append(
      "total_reading_days",
      teacher.totalReadingDays === null || teacher.totalReadingDays === undefined ? "" : String(teacher.totalReadingDays)
    );
    fd.append(
      "weekly_new_words",
      teacher.weeklyNewWords === null || teacher.weeklyNewWords === undefined ? "" : String(teacher.weeklyNewWords)
    );
    fd.append("daily_records_json", JSON.stringify(ocr.daily_records_json || []));
    fd.append("reading_days", JSON.stringify(teacher.readingDaysYmd || []));
    fd.append("raw_text", String(teacher.rawText ?? ocr.raw_text ?? ""));
    fd.append("extraction_status", ocr.extraction_status || "needs_review");

    const res = await fetch("/api/save-reading-record", { method: "POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    const body =
      ct.includes("application/json") ? await res.json().catch(() => ({})) : {};

    if (!res.ok || body.ok === false) {
      const msg = body?.error || body?.message || `保存失败 HTTP ${res.status}`;
      console.error("[save-reading client] API error response", {
        httpStatus: res.status,
        contentType: ct,
        body,
        message: typeof msg === "string" ? msg : JSON.stringify(msg),
      });
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    console.log("[save-reading client] API ok", { reading_record_id: body?.reading_record?.id });
  }

  async function startOcrAndConfirmSequence() {
    const snapshot = [...selectedImagesRef.current];
    const toProcess = snapshot.filter((x) => x.status !== "saved");
    if (!toProcess.length) {
      setHint("请先选择图片。");
      return;
    }

    setBusy(true);
    setHint("");

    try {
      const payloads = [];
      for (const { id } of toProcess) {
        const latest = () => selectedImagesRef.current.find((x) => x.id === id);
        if (latest()?.status === "saved") continue;

        const payload = await runOcrForId(id);
        if (!payload) continue;

        if (payload.ocrResult?._networkError) {
          setHint(
            (h) =>
              (h ? `${h}；` : "") +
              `本张图片请求失败：${payload.ocrResult._networkError}（仍会打开确认窗口，可修改姓名后重试保存或跳过）`
          );
        } else if (payload.ocrResult?.extraction_status === "failed") {
          setHint(
            (h) =>
              (h ? `${h}；` : "") +
              "本张 OCR 识别质量较低（failed），请核对右侧信息或手动填写姓名后再保存。"
          );
        }

        payloads.push(payload);
      }
      setBusy(false);
      if (payloads.length) await openConfirmBatchModal(payloads);
      setHint((h) => (h ? `${h} ` : "") + "本轮处理结束。");
      onSaved?.();
    } catch (e) {
      console.error(e);
      setHint(e?.message || "处理中断，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function parseOptionalNonNegIntField(raw, label) {
    const t = String(raw ?? "").trim();
    if (t === "") return null;
    if (!/^\d+$/.test(t)) throw new Error(`${label}须为 0 或正整数`);
    return parseInt(t, 10);
  }

  async function handleModalSave() {
    const modal = confirmModalRef.current;
    if (!modal) return;
    if (savingReading) {
      console.log("[confirm] 保存 ignored: 已在保存中");
      return;
    }

    const item = selectedImagesRef.current.find((x) => x.id === modal.id);
    const draft = getEditableSliceFromItem(item);
    if (!draft) {
      setSaveError("当前图片没有可保存的识别数据。");
      return;
    }

    const finalName = String(draft.editableStudentName || "").trim();
    if (!finalName) {
      setSaveError("请先填写学生姓名");
      return;
    }

    let totalWords;
    let totalBooks;
    let totalReadingDays;
    let totalTimeMinutes;
    let weeklyNewWords;
    try {
      totalWords = parseOptionalNonNegIntField(draft.editableTotalWords, "总单词数");
      totalBooks = parseOptionalNonNegIntField(draft.editableTotalBooks, "总本数");
      totalReadingDays = parseOptionalNonNegIntField(draft.editableTotalReadingDays, "连续阅读天数");
      weeklyNewWords = parseOptionalNonNegIntField(draft.editableWeekWords, "本周新单词");
      const hRaw = String(draft.editableHours ?? "").trim();
      const mRaw = String(draft.editableMinutes ?? "").trim();
      if (hRaw === "" && mRaw === "") {
        totalTimeMinutes = null;
      } else {
        if (hRaw !== "" && !/^\d+$/.test(hRaw)) throw new Error("总时间「小时」须为 0 或正整数");
        if (mRaw !== "" && !/^\d+$/.test(mRaw)) throw new Error("总时间「分钟」须为 0 或正整数");
        const h = hRaw === "" ? 0 : parseInt(hRaw, 10);
        const mi = mRaw === "" ? 0 : parseInt(mRaw, 10);
        if (h < 0 || mi < 0) throw new Error("总时间的小时、分钟不能为负数");
        totalTimeMinutes = hoursMinutesToMinutes(h, mi);
      }
    } catch (ve) {
      setSaveError(ve instanceof Error ? ve.message : String(ve));
      return;
    }

    const ocrSnap = modal.ocrResult || {};
    const readingDaysYmd = [
      ...new Set(draft.editableReadingDays.map((d) => normalizeRowDateString(d)).filter(Boolean)),
    ].sort();

    console.log("[confirm] save click", {
      imageId: modal.id,
      editable: {
        ...draft,
        readingDaysCount: readingDaysYmd.length,
      },
    });

    setSaveError("");
    setSavingReading(true);
    setHint("正在保存记录…");
    try {
      await saveOneReadingRecord(modal, {
        confirmedStudentName: finalName,
        totalWords,
        totalTimeMinutes,
        totalBooks,
        totalReadingDays,
        weeklyNewWords,
        readingDaysYmd,
        rawText: String(ocrSnap.raw_text ?? ""),
      });
      patchSelectedImageDraft(modal.id, {
        editableStudentName: draft.editableStudentName,
        ocrBaselineName: draft.ocrBaselineName,
        editableTotalWords: draft.editableTotalWords,
        editableWeekWords: draft.editableWeekWords,
        editableHours: draft.editableHours,
        editableMinutes: draft.editableMinutes,
        editableTotalBooks: draft.editableTotalBooks,
        editableTotalReadingDays: draft.editableTotalReadingDays,
        editableReadingDays: draft.editableReadingDays,
        status: "saved",
      });
      setHint("已保存。");
      onSaved?.();

      const order = confirmOrderedIdsRef.current;
      const curIdx = confirmCurrentIndexRef.current;
      const newOrder = order.filter((x) => x !== modal.id);
      setConfirmOrderedIds(newOrder);
      if (newOrder.length === 0) {
        finishConfirmStep();
      } else {
        const newIdx = Math.min(curIdx, newOrder.length - 1);
        const nid = newOrder[newIdx];
        const nextItem = selectedImagesRef.current.find((x) => x.id === nid);
        if (!nextItem?.ocrResult) {
          finishConfirmStep();
        } else {
          const payload = {
            id: nextItem.id,
            file: nextItem.file,
            previewUrl: nextItem.previewUrl,
            ocrResult: nextItem.ocrResult,
          };
          confirmModalRef.current = payload;
          setConfirmModal(payload);
          setConfirmCurrentIndex(newIdx);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[confirm] saveReadingRecord failed:", e);
      setSaveError(msg || "保存失败");
      setHint("");
    } finally {
      setSavingReading(false);
    }
  }

  function handleModalCloseAll() {
    finishConfirmStep();
  }

  function handleConfirmCalendarToggle(dateStr, currentlyRead) {
    const id = confirmModalRef.current?.id;
    if (!id) return;
    const key = normalizeRowDateString(dateStr);
    if (!key) return;
    setSelectedImages((prev) => {
      const next = prev.map((x) => {
        if (x.id !== id) return x;
        const d = getEditableSliceFromItem(x);
        if (!d) return x;
        const base = new Set(d.editableReadingDays.map((y) => normalizeRowDateString(y)).filter(Boolean));
        if (currentlyRead) base.delete(key);
        else base.add(key);
        return { ...x, editableReadingDays: [...base].sort() };
      });
      syncRefAfterImages(next);
      return next;
    });
  }

  const ocr = confirmModal?.ocrResult;
  const currentItem = useMemo(
    () => selectedImages.find((x) => x.id === confirmModal?.id),
    [selectedImages, confirmModal?.id]
  );
  const currentDraft = useMemo(() => getEditableSliceFromItem(currentItem), [currentItem]);
  const calendarRecord = useMemo(
    () => ({
      reading_days: currentDraft?.editableReadingDays ?? [],
      daily_records_json: Array.isArray(ocr?.daily_records_json) ? ocr.daily_records_json : [],
    }),
    [currentDraft?.editableReadingDays, ocr?.daily_records_json]
  );
  const totalTimePreviewLabel = useMemo(() => {
    if (!currentDraft) return "—";
    const h = parseInt(String(currentDraft.editableHours ?? "").trim() || "0", 10);
    const m = parseInt(String(currentDraft.editableMinutes ?? "").trim() || "0", 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return "—";
    return formatMinutesToHourMinute(hoursMinutesToMinutes(h, m));
  }, [currentDraft]);
  const showOcrOriginalHint =
    Boolean(currentDraft?.ocrBaselineName) &&
    String(currentDraft?.editableStudentName || "").trim() !== currentDraft?.ocrBaselineName;
  const ocrHasProblem =
    Boolean(ocr?._networkError) ||
    ocr?.extraction_status === "failed" ||
    ocr?.extraction_status === "needs_review";

  const modalFooterLocked = savingReading;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>阅读记录</CardTitle>
          <CardDescription>批量上传截图、OCR 识别并核对后保存到阅读记录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">批量上传阅读记录</p>
            <p className="text-xs text-gray-500">
              可多次选择图片，新图会追加到下方；每张卡片可单独删除。已识别缩略图可点开继续核对。
            </p>
            <Input
              key={fileInputKey}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => {
                appendFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              onClick={startOcrAndConfirmSequence}
              disabled={!selectedImages.length || busy}
            >
              开始 OCR 识别
            </Button>
          </div>

          {selectedImages.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
              {selectedImages.map((img) => {
                const thumbOpen = itemHasOcrReady(img);
                return (
                  <div
                    key={img.id}
                    role={thumbOpen ? "button" : undefined}
                    tabIndex={thumbOpen ? 0 : undefined}
                    onClick={() => {
                      if (thumbOpen) openConfirmModalFromThumbnail(img.id);
                    }}
                    onKeyDown={(e) => {
                      if (!thumbOpen) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openConfirmModalFromThumbnail(img.id);
                      }
                    }}
                    className={`rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col ${
                      thumbOpen
                        ? "cursor-pointer border-teal-200 hover:border-teal-400 hover:shadow-md transition-colors"
                        : "border-gray-100"
                    }`}
                  >
                    <div className="relative w-full h-44 sm:h-48 bg-gray-50 overflow-hidden rounded-t-xl pointer-events-none">
                      <img
                        src={img.previewUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover object-top"
                      />
                      <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">
                        {STATUS_LABEL[img.status] || img.status}
                      </span>
                    </div>
                    <div className="p-2 flex-1 flex flex-col gap-1 min-w-0">
                      <p className="text-xs text-gray-700 truncate" title={img.file.name}>
                        {img.file.name}
                      </p>
                      {img.status === "error" && img.errorMessage && (
                        <p className="text-[10px] text-amber-700 line-clamp-2">{img.errorMessage}</p>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(img.id);
                        }}
                        className="mt-auto text-xs text-red-600 hover:text-red-700 text-left"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hint && <p className="text-sm text-gray-600">{hint}</p>}
        </CardContent>
      </Card>

      {confirmModal != null && currentDraft && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-auto">
          <div
            className="w-full max-w-6xl sm:max-w-7xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col border border-gray-100 relative z-[51]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900">确认阅读记录并保存</h3>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={handleModalCloseAll}
              >
                关闭
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              <div className="w-full lg:w-[45%] lg:min-w-[420px] lg:max-w-[min(780px,50vw)] lg:flex-shrink-0 flex flex-col gap-2 p-4 border-b lg:border-b-0 lg:border-r border-gray-100 min-h-[min(70vh,calc(85vh-100px))] lg:min-h-0 lg:h-[calc(85vh-52px)] lg:max-h-[calc(85vh-52px)]">
                <p className="text-xs text-gray-500 shrink-0">原图（点击可放大）</p>
                <button
                  type="button"
                  onClick={() => setLightboxUrl(confirmModal.previewUrl)}
                  className="rounded-xl border border-gray-100 bg-gray-50 overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-400 w-full flex-1 min-h-[min(70vh,calc(85vh-140px))] lg:min-h-0 flex items-center justify-center p-2"
                >
                  <img
                    src={confirmModal.previewUrl}
                    alt="阅读记录截图"
                    className="h-full w-full min-h-0 object-contain"
                  />
                </button>
              </div>

              <div className="flex-1 min-w-0 min-h-0 flex flex-col lg:h-[calc(85vh-52px)]">
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
                  {ocrHasProblem && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {ocr._networkError && (
                        <p className="font-medium">网络错误：{ocr._networkError}</p>
                      )}
                      {ocr.extraction_status === "failed" && !ocr._networkError && (
                        <p className="font-medium">OCR 识别失败或质量不足，请对照大图核对；仍可手动填写姓名后尝试保存。</p>
                      )}
                      {ocr.extraction_status === "needs_review" && (
                        <p className="font-medium">OCR 结果需人工核对（needs_review），请检查累计数据与日期条数。</p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">学生姓名（可修改）</label>
                    <Input
                      value={currentDraft.editableStudentName}
                      onChange={(e) => patchSelectedImageDraft(confirmModal.id, { editableStudentName: e.target.value })}
                      placeholder="请输入学生姓名"
                      className="w-full"
                    />
                    {currentDraft.ocrBaselineName ? (
                      <p className="text-xs text-gray-500 mt-1">
                        OCR 识别姓名：
                        <span className="font-medium text-gray-700">{currentDraft.ocrBaselineName}</span>
                        {showOcrOriginalHint && (
                          <span className="block text-amber-700 mt-0.5">
                            您已修改姓名，保存时将使用上方输入框中的名字。
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-700 mt-1">未识别到姓名，请手动填写。</p>
                    )}
                  </div>

                  <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                    <p className="text-xs text-gray-500">
                      以下为识别结果，可直接修改后再保存；保存以当前输入为准。
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-800 mb-1">总单词数</label>
                      <Input
                        value={currentDraft.editableTotalWords}
                        onChange={(e) =>
                          patchSelectedImageDraft(confirmModal.id, {
                            editableTotalWords: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        placeholder="选填，非负整数"
                        inputMode="numeric"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-800 mb-1">本周新单词</label>
                      <Input
                        value={String(currentItem?.editableWeekWords ?? "")}
                        onChange={(e) =>
                          patchSelectedImageDraft(confirmModal.id, {
                            editableWeekWords: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        placeholder="默认同周日内日表 words 之和，可改"
                        inputMode="numeric"
                        className="w-full"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        按当前图日表：最晚日期所在自然周（周日～周六）内 words 合计；保存时写入 weekly_new_words。
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-800 mb-1">总时间</label>
                      <div className="flex flex-row flex-wrap items-center justify-start gap-x-2 gap-y-1 text-left">
                        <Input
                          value={currentDraft.editableHours}
                          onChange={(e) =>
                            patchSelectedImageDraft(confirmModal.id, {
                              editableHours: e.target.value.replace(/\D/g, ""),
                            })
                          }
                          placeholder="小时"
                          inputMode="numeric"
                          className="w-24 shrink-0 text-left"
                        />
                        <span className="text-sm text-gray-600 shrink-0">小时</span>
                        <Input
                          value={currentDraft.editableMinutes}
                          onChange={(e) =>
                            patchSelectedImageDraft(confirmModal.id, {
                              editableMinutes: e.target.value.replace(/\D/g, ""),
                            })
                          }
                          placeholder="分钟"
                          inputMode="numeric"
                          className="w-24 shrink-0 text-left"
                        />
                        <span className="text-sm text-gray-600 shrink-0">分</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        展示合计：<span className="font-medium text-gray-700">{totalTimePreviewLabel}</span>
                        （保存时按 小时×60+分 写入总分钟；若分≥60 会自动进位）
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-800 mb-1">总本数</label>
                      <Input
                        value={currentDraft.editableTotalBooks}
                        onChange={(e) =>
                          patchSelectedImageDraft(confirmModal.id, {
                            editableTotalBooks: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        placeholder="选填，非负整数"
                        inputMode="numeric"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-800 mb-1">连续阅读天数</label>
                      <Input
                        value={currentDraft.editableTotalReadingDays}
                        onChange={(e) =>
                          patchSelectedImageDraft(confirmModal.id, {
                            editableTotalReadingDays: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        placeholder="选填，非负整数"
                        inputMode="numeric"
                        className="w-full"
                      />
                    </div>
                    <p className="text-xs text-gray-600">
                      <span className="text-gray-500">OCR 识别状态：</span>
                      {ocr.extraction_status || "—"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4 min-h-[220px]">
                    <p className="text-sm font-medium text-gray-900 mb-2">阅读日期</p>
                    <p className="text-xs text-gray-600 mb-2">
                      依据明细表中的日期；默认识别到的日期为已读。点击下方日期可切换已读/未读。
                    </p>
                    <FeedReadingWeekCalendar
                      record={calendarRecord}
                      onDayRequestToggle={handleConfirmCalendarToggle}
                      useReadingDaysOnly
                      actionHint="点击日期即可切换已读 / 未读（本窗口内立即生效，保存后写入数据库）"
                    />
                  </div>

                  {saveError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {saveError}
                    </p>
                  )}
                </div>

                <div className="relative z-20 shrink-0 border-t border-gray-100 bg-white px-4 py-3 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-sm"
                      disabled={confirmCurrentIndex <= 0 || modalFooterLocked}
                      onClick={() => goConfirmDelta(-1)}
                    >
                      上一个
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-sm"
                      disabled={confirmCurrentIndex >= confirmOrderedIds.length - 1 || modalFooterLocked}
                      onClick={() => goConfirmDelta(1)}
                    >
                      下一个
                    </Button>
                    {confirmOrderedIds.length > 0 && (
                      <span className="text-xs text-gray-500 pl-1">
                        第 {confirmCurrentIndex + 1} / {confirmOrderedIds.length} 张
                        {modalFooterLocked ? "（保存中…）" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={handleModalSkipCurrent}
                      disabled={modalFooterLocked}
                    >
                      跳过此张
                    </Button>
                    <Button type="button" onClick={() => void handleModalSave()} disabled={modalFooterLocked}>
                      确认并保存
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <button
          type="button"
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
          aria-label="关闭大图"
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </button>
      )}
    </div>
  );
}
