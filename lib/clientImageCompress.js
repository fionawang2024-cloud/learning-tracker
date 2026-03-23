/**
 * Client-side image resize + JPEG compression for weak networks.
 * Does not change OCR APIs — only the File sent to storage / extract-reading.
 *
 * Strategy: long edge max 1600px, aspect ratio preserved, JPEG ~0.76 quality.
 * Skip if original under 500KB. On any failure, returns the original file.
 */

const MAX_LONG_EDGE = 1600;
/** Between 0.7 – 0.8; balanced for Chinese + digits on homework photos */
const JPEG_QUALITY_PRIMARY = 0.76;
const JPEG_QUALITY_FALLBACK = 0.72;
/** Do not recompress small files (per product spec) */
const SKIP_COMPRESS_BELOW_BYTES = 500 * 1024;
/** Soft target — if still larger, try slightly lower quality once */
const SOFT_MAX_BYTES = 800 * 1024;

function yieldToMain() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function isLikelyDecodableRaster(file) {
  const t = (file?.type || "").toLowerCase();
  if (!t) return true;
  return /^(image\/jpeg|image\/jpg|image\/pjpeg|image\/png|image\/webp)$/i.test(t);
}

/**
 * @param {File|Blob} file
 * @returns {Promise<ImageBitmap|HTMLImageElement|null>}
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch (_) {
      /* continue to <img> */
    }
  }
  return decodeViaImageElement(file);
}

function decodeViaImageElement(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function releaseSource(src) {
  if (src && typeof src.close === "function") src.close();
}

function intrinsicSize(src) {
  const w = src.naturalWidth ?? src.width;
  const h = src.naturalHeight ?? src.height;
  return { w, h };
}

function toJpegBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

/**
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressImageForUpload(file) {
  if (!file || typeof file.size !== "number") return file;
  if (file.size < SKIP_COMPRESS_BELOW_BYTES) return file;
  if (!isLikelyDecodableRaster(file)) return file;

  await yieldToMain();

  let src = null;
  try {
    src = await decodeImage(file);
    if (!src) return file;

    const { w: w0, h: h0 } = intrinsicSize(src);
    if (!w0 || !h0) {
      releaseSource(src);
      return file;
    }

    let w = w0;
    let h = h0;
    const long = Math.max(w, h);
    if (long > MAX_LONG_EDGE) {
      const scale = MAX_LONG_EDGE / long;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    await yieldToMain();

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      releaseSource(src);
      return file;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    releaseSource(src);
    src = null;

    let blob = await toJpegBlob(canvas, JPEG_QUALITY_PRIMARY);
    if (blob && blob.size > SOFT_MAX_BYTES) {
      const smaller = await toJpegBlob(canvas, JPEG_QUALITY_FALLBACK);
      if (smaller && smaller.size > 0 && smaller.size < blob.size) {
        blob = smaller;
      }
    }

    if (!blob || blob.size === 0) return file;
    if (blob.size >= file.size) return file;

    const stem =
      file.name && /\.[^.]+$/.test(file.name)
        ? file.name.replace(/\.[^.]+$/, "")
        : `photo-${Date.now()}`;
    return new File([blob], `${stem}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (e) {
    console.warn("[clientImageCompress] using original file", e);
    if (src) releaseSource(src);
    return file;
  }
}
