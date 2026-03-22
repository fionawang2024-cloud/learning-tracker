import { deriveReadingDaysDescending } from "@/lib/readingRecordOcr";

/**
 * POST /api/extract-reading
 * 改进版阅读截图识别管线（支持截图 + 拍照）：
 *
 * 1. 图像预处理（自动旋转、对比度、锐化、降噪等） -> preprocessImage()
 * 2. OCR 引擎（Tesseract / Vision API 等） -> runOcr()
 * 3. 文本解析：
 *    - 顶部累计数据：累计时间 / 累计单词 / 累计本数 / 连续天数
 *    - 每日记录表格：按日期行解析
 *
 * 输入：FormData, 包含 "image" (File) 或 "url" (string)
 * 输出（示例）：
 * {
 *   total_words,
 *   total_time_minutes,
 *   total_books,
 *   total_reading_days,
 *   confidence,
 *   raw_text,
 *   daily_records_json: [
 *     { date: "2026-03-14", words: 1245, time_minutes: 62, books: 10 },
 *     ...
 *   ],
 *   extraction_status: "success" | "needs_review" | "failed"
 * }
 *
 * 重要：本文件只实现解析与状态判断，真正的 OCR 引擎可在 runOcr() 中接入。
 */

const CUMULATIVE_SEARCH_WINDOW = 5;

/**
 * 将中文时长转为分钟（忽略秒）：支持
 * 532时24分10秒、1时1分6秒、37分43秒、1时40秒 等
 */
function parseChineseTimeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  const hourMatch = s.match(/(\d+)\s*时/);
  const minuteMatch = s.match(/(\d+)\s*分/);
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const minutes = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
  if ((hourMatch && isNaN(hours)) || (minuteMatch && isNaN(minutes))) {
    return null;
  }
  if (!hourMatch && !minuteMatch) return null;
  const totalMinutes = (hours || 0) * 60 + (minutes || 0);
  return isNaN(totalMinutes) ? null : totalMinutes;
}

function normalizeDurationToken(tok) {
  return String(tok).trim().replace(/\s+/g, "");
}

/** 优先匹配的时长形态（数字越小越优先，同距离时选用更完整的模式） */
function timePatternRank(tok) {
  const t = normalizeDurationToken(tok);
  if (/^\d+时\d+分\d+秒$/.test(t)) return 0;
  if (/^\d+时\d+分$/.test(t)) return 1;
  if (/^\d+分\d+秒$/.test(t)) return 2;
  if (/^\d+时\d+秒$/.test(t)) return 3;
  return 99;
}

function isPreferredChineseDurationToken(tok) {
  return timePatternRank(tok) < 99;
}

function isPureDigitsToken(tok) {
  const s = String(tok).replace(/,/g, "").trim();
  return /^\d+$/.test(s);
}

function numericTokenValue(tok) {
  const s = String(tok).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function gatherNearby(labelIndex, windowSize, tokens) {
  const out = [];
  for (let offset = -windowSize; offset <= windowSize; offset++) {
    if (offset === 0) continue;
    const idx = labelIndex + offset;
    if (idx < 0 || idx >= tokens.length) continue;
    const tok = tokens[idx];
    if (tok) out.push({ idx, tok, distance: Math.abs(offset) });
  }
  return out;
}

/** 从 daily_records 取日历用最新 YYYY-MM-DD */
function getLatestOcrDateFromDailyRecords(dailyRecords) {
  if (!Array.isArray(dailyRecords) || dailyRecords.length === 0) return null;
  const sorted = dailyRecords
    .map((d) => (d?.date || "").slice(0, 10))
    .filter(Boolean)
    .sort();
  return sorted.length ? sorted[sorted.length - 1] : null;
}

// 解析顶部累计数据区域（标签 ±5、字段专用规则、token 不重复使用）
function parseCumulativeStats(text) {
  const empty = {
    total_words: null,
    total_time_minutes: null,
    total_books: null,
    total_reading_days: null,
  };
  if (!text) return empty;

  const tokens = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (tokens.length === 0) return empty;

  let rawTimeToken = null;
  let rawWordsToken = null;
  let rawBooksToken = null;
  let rawDaysToken = null;
  let totalTimeMinutes = null;
  let totalWords = null;
  let totalBooks = null;
  let totalReadingDays = null;

  const usedIndices = new Set();
  const W = CUMULATIVE_SEARCH_WINDOW;

  try {
    console.log(
      `${LOG_PREFIX} tokens with indices:\n` +
        tokens.map((tok, idx) => `[${idx}] ${tok}`).join("\n")
    );
  } catch (_) {}

  // A) 累计时间：优先标准中文时长模式；若无则回退到任意可解析的「时/分/秒」片段；距离最近优先
  const idxTime = tokens.indexOf("累计时间");
  if (idxTime !== -1) {
    const nearby = gatherNearby(idxTime, W, tokens);
    const strict = nearby.filter(
      (c) =>
        isPreferredChineseDurationToken(c.tok) &&
        parseChineseTimeToMinutes(c.tok) != null
    );
    const loose = nearby.filter(
      (c) =>
        strict.every((s) => s.idx !== c.idx) &&
        /[时分秒]/.test(c.tok) &&
        parseChineseTimeToMinutes(c.tok) != null
    );
    const timeCandidates = [...strict, ...loose.map((c) => ({ ...c, rank: 100 }))].map((c) => ({
      ...c,
      rank: c.rank !== undefined ? c.rank : timePatternRank(c.tok),
    }));
    console.log(
      `${LOG_PREFIX} [累计时间] candidates (±${W}):`,
      timeCandidates.map((c) => ({ idx: c.idx, tok: c.tok, distance: c.distance, rank: c.rank }))
    );
    timeCandidates.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.rank - b.rank;
    });
    const chosen = timeCandidates[0];
    if (chosen) {
      rawTimeToken = chosen.tok;
      totalTimeMinutes = parseChineseTimeToMinutes(chosen.tok);
      usedIndices.add(chosen.idx);
      console.log(
        `${LOG_PREFIX} [累计时间] chosen: index=${chosen.idx} tok=${JSON.stringify(chosen.tok)} -> total_time_minutes=${totalTimeMinutes}`
      );
    } else {
      console.log(`${LOG_PREFIX} [累计时间] no valid candidate`);
    }
  }

  function pickNumericField(fieldName, labelIndex) {
    if (labelIndex === -1) return null;
    const nearby = gatherNearby(labelIndex, W, tokens);
    const digitCandidates = nearby.filter(
      (c) => !usedIndices.has(c.idx) && isPureDigitsToken(c.tok)
    );
    const enriched = digitCandidates.map((c) => {
      const clean = String(c.tok).replace(/,/g, "").trim();
      return { ...c, digitLen: clean.length, value: numericTokenValue(c.tok) };
    });
    console.log(
      `${LOG_PREFIX} [${fieldName}] numeric candidates (±${W}, excluding used ${[...usedIndices].join(",")}):`,
      enriched.map((c) => ({ idx: c.idx, tok: c.tok, distance: c.distance, digitLen: c.digitLen }))
    );
    enriched.sort((a, b) => {
      if (b.digitLen !== a.digitLen) return b.digitLen - a.digitLen;
      return a.distance - b.distance;
    });
    const chosen = enriched[0];
    if (chosen && chosen.value != null) {
      usedIndices.add(chosen.idx);
      console.log(
        `${LOG_PREFIX} [${fieldName}] chosen: index=${chosen.idx} tok=${JSON.stringify(chosen.tok)} -> ${chosen.value}`
      );
      return chosen;
    }
    console.log(`${LOG_PREFIX} [${fieldName}] no candidate`);
    return null;
  }

  const idxWords = tokens.indexOf("累计单词");
  const wChosen = pickNumericField("累计单词", idxWords);
  if (wChosen) {
    rawWordsToken = wChosen.tok;
    totalWords = wChosen.value;
  }

  const idxBooks = tokens.indexOf("累计本数");
  const bChosen = pickNumericField("累计本数", idxBooks);
  if (bChosen) {
    rawBooksToken = bChosen.tok;
    totalBooks = bChosen.value;
  }

  const idxDays = tokens.indexOf("连续天数");
  const dChosen = pickNumericField("连续天数", idxDays);
  if (dChosen) {
    rawDaysToken = dChosen.tok;
    totalReadingDays = dChosen.value;
  }

  console.log(
    `${LOG_PREFIX} cumulative FINAL: ` +
      `rawTimeToken=${JSON.stringify(rawTimeToken)}, rawWordsToken=${JSON.stringify(rawWordsToken)}, ` +
      `rawBooksToken=${JSON.stringify(rawBooksToken)}, rawDaysToken=${JSON.stringify(rawDaysToken)}, ` +
      `total_time_minutes=${totalTimeMinutes}, total_words=${totalWords}, total_books=${totalBooks}, total_reading_days=${totalReadingDays}`
  );

  return {
    total_words: totalWords,
    total_time_minutes: totalTimeMinutes,
    total_books: totalBooks,
    total_reading_days: totalReadingDays,
  };
}

// 解析每日明细：按“纵向堆叠”的日期块来读
function parseDailyRows(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const dateRegex = /^(\d{4}-\d{2}-\d{2})$/;

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(dateRegex);
    if (!m) continue;
    const date = m[1];

    let words = null;
    let timeStr = null;
    let books = null;

    // 在接下来的几行中依次寻找 words / time / books
    const windowLines = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const t = lines[j].trim();
      if (t === "") continue;
      windowLines.push(t);
    }

    // words: 第一个「纯数字」行
    for (const l of windowLines) {
      if (/^\d+$/.test(l)) {
        const v = parseInt(l, 10);
        if (!isNaN(v)) {
          words = v;
          break;
        }
      }
    }

    // time: 第一个包含 时/分/秒 的行
    for (const l of windowLines) {
      if (/[时分秒]/.test(l)) {
        timeStr = l;
        break;
      }
    }

    // books: 在 time 行之后的第一个「纯数字」行
    if (timeStr) {
      const timeIdx = windowLines.findIndex((l) => l === timeStr);
      for (let k = timeIdx + 1; k < windowLines.length; k++) {
        const l = windowLines[k];
        if (/^\d+$/.test(l)) {
          const v = parseInt(l, 10);
          if (!isNaN(v)) {
            books = v;
            break;
          }
        }
      }
    }

    const time_minutes = timeStr ? parseChineseTimeToMinutes(timeStr) : null;

    if (words != null || time_minutes != null || books != null) {
      rows.push({
        date,
        words,
        time_minutes,
        books,
      });
    }
  }

  return rows;
}

// 计算置信度 & extraction_status：必须解析出累计字段才会 success
function assessExtractionQuality({ cumulative, dailyRecords, rawText }) {
  const hasCumulative =
    cumulative.total_words != null &&
    cumulative.total_time_minutes != null &&
    cumulative.total_books != null;
  const hasDaily = dailyRecords.length > 0;

  let status = "failed";
  if (hasCumulative && hasDaily) {
    status = "success";
  } else if (hasCumulative || hasDaily) {
    status = "needs_review";
  } else {
    status = "failed";
  }

  // 简单的“置信度”估计：0 / 0.5 / 1
  const confidence = status === "success" ? 1 : status === "needs_review" ? 0.5 : 0;
  return { confidence, status };
}

// 占位：这里接入真正的图像预处理逻辑（旋转、裁剪、增强等）
async function preprocessImage(imageFileOrUrl) {
  return imageFileOrUrl;
}

const LOG_PREFIX = "[extract-reading]";

/**
 * Call Google Cloud Vision DOCUMENT_TEXT_DETECTION.
 * Returns { raw_text } or throws. Never exposes API key to client.
 */
async function runOcr(preprocessedImage) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return "";

  console.log(`${LOG_PREFIX} OCR request starting.`);

  let body;
  if (typeof preprocessedImage === "string") {
    body = {
      requests: [
        {
          image: { source: { imageUri: preprocessedImage } },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    };
  } else if (preprocessedImage && typeof preprocessedImage.arrayBuffer === "function") {
    const buf = await preprocessedImage.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    body = {
      requests: [
        {
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    };
  } else {
    console.log(`${LOG_PREFIX} No image file or URL, skipping OCR.`);
    return "";
  }

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} Google Vision request failed:`, err?.message ?? String(err));
    throw err;
  }

  console.log(`${LOG_PREFIX} Google OCR HTTP status: ${res.status}`);

  const data = await res.json().catch(() => ({}));
  const firstResponse = data?.responses?.[0];

  const hasTextAnnotations = Array.isArray(firstResponse?.textAnnotations) && firstResponse.textAnnotations.length > 0;
  const hasFullTextAnnotation = !!firstResponse?.fullTextAnnotation;
  console.log(`${LOG_PREFIX} OCR response has textAnnotations: ${hasTextAnnotations}`);
  console.log(`${LOG_PREFIX} OCR response has fullTextAnnotation: ${hasFullTextAnnotation}`);

  if (!res.ok) {
    const errMsg = data?.error?.message || res.statusText || String(res.status);
    console.error(`${LOG_PREFIX} Google API error: ${errMsg}`);
    throw new Error(errMsg);
  }

  let raw_text = "";
  if (firstResponse?.fullTextAnnotation?.text) {
    raw_text = firstResponse.fullTextAnnotation.text;
  } else if (hasTextAnnotations && firstResponse.textAnnotations[0]?.description) {
    raw_text = firstResponse.textAnnotations[0].description;
  }

  const preview = raw_text.length > 500 ? raw_text.slice(0, 500) + "…" : raw_text;
  console.log(`${LOG_PREFIX} raw_text length: ${raw_text.length}, first 500 chars: ${JSON.stringify(preview)}`);

  return raw_text;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get("image");
    const imageUrl = formData.get("url");

    if (!imageFile && !imageUrl) {
      return Response.json(
        { error: "请提供 image 文件或 url" },
        { status: 400 }
      );
    }

    console.log(`${LOG_PREFIX} GOOGLE_VISION_API_KEY exists: ${!!process.env.GOOGLE_VISION_API_KEY}`);
    const preprocessed = await preprocessImage(imageFile || imageUrl);
    let raw_text;
    try {
      raw_text = await runOcr(preprocessed);
    } catch (ocrErr) {
      const msg = ocrErr?.message ?? String(ocrErr);
      console.error(`${LOG_PREFIX} OCR pipeline error (full):`, msg);
      return Response.json(
        {
          error: "OCR 请求失败",
          errorDetail: msg,
          total_words: null,
          total_time_minutes: null,
          total_books: null,
          total_reading_days: null,
          confidence: 0,
          raw_text: "",
          daily_records_json: [],
          reading_days: null,
          extraction_status: "failed",
        },
        { status: 200 }
      );
    }

    const cumulative = parseCumulativeStats(raw_text);
    const daily_records_json = parseDailyRows(raw_text);
    const latestOcrDateForCalendar = getLatestOcrDateFromDailyRecords(daily_records_json);
    console.log(
      `${LOG_PREFIX} latest OCR date for calendar week default: ${latestOcrDateForCalendar ?? "(none)"}`
    );
    const { confidence, status } = assessExtractionQuality({
      cumulative,
      dailyRecords: daily_records_json,
      rawText: raw_text,
    });

    const reading_days = deriveReadingDaysDescending(daily_records_json);

    console.log(
      `${LOG_PREFIX} Parsing result: total_words=${cumulative.total_words} total_time_minutes=${cumulative.total_time_minutes} total_books=${cumulative.total_books} total_reading_days=${cumulative.total_reading_days} daily_records_count=${daily_records_json.length} extraction_status=${status} reading_days_count=${reading_days?.length ?? 0}`
    );

    const result = {
      total_words: cumulative.total_words,
      total_time_minutes: cumulative.total_time_minutes,
      total_books: cumulative.total_books,
      total_reading_days: cumulative.total_reading_days,
      confidence,
      raw_text,
      daily_records_json,
      reading_days,
      extraction_status: status,
    };

    console.log(
      `${LOG_PREFIX} OCR response payload (persist preview):`,
      JSON.stringify({
        total_words: result.total_words,
        total_time_minutes: result.total_time_minutes,
        total_books: result.total_books,
        total_reading_days: result.total_reading_days,
        daily_records_json_length: daily_records_json.length,
        reading_days: result.reading_days,
        extraction_status: result.extraction_status,
      })
    );

    return Response.json(result);
  } catch (e) {
    console.error(LOG_PREFIX, e);
    return Response.json(
      {
        error: "识别失败",
        total_words: null,
        total_time_minutes: null,
        total_books: null,
        total_reading_days: null,
        confidence: 0,
        raw_text: "",
        daily_records_json: [],
        reading_days: null,
        extraction_status: "failed",
      },
      { status: 200 }
    );
  }
}
