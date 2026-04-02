import { getSupabaseClient } from "./supabaseClient";

export function getDiaryImagePath(studentId, index = 0) {
  return `${studentId}/${Date.now()}-${index}.jpg`;
}

export function getReadingImagePath(studentId, index = 0) {
  return `${studentId}/${Date.now()}-${index}.jpg`;
}

export async function uploadDiaryImage(studentId, file, index = 0) {
  const path = getDiaryImagePath(studentId, index);
  console.log("[storage] uploadDiaryImage", { bucket: "diary-images", path });
  const { data, error } = await getSupabaseClient().storage
    .from("diary-images")
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

export async function uploadReadingImage(studentId, file, index = 0) {
  const path = getReadingImagePath(studentId, index);
  console.log("[storage] uploadReadingImage", { bucket: "reading-images", path });
  const { data, error } = await getSupabaseClient().storage
    .from("reading-images")
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Public bucket: use this URL directly in <img src="...">.
 * supabase.storage.from(bucket).getPublicUrl(path)
 */
export function getPublicUrl(bucket, path) {
  console.log("[storage] getPublicUrl", { bucket, path });
  const { data } = getSupabaseClient().storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Private bucket: use this when public URL returns 403.
 * Returns a signed URL valid for expiresIn seconds (default 1 hour).
 */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  console.log("[storage] getSignedUrl request", { bucket, path, expiresIn });
  try {
    const { data, error } = await getSupabaseClient().storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);
    if (error) {
      console.error("[storage] getSignedUrl error:", error);
      console.error("[storage] getSignedUrl details:", error?.message, error?.details, error?.hint);
      throw error;
    }
    console.log("[storage] getSignedUrl success", { bucket, path, hasUrl: !!data?.signedUrl });
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error("[storage] getSignedUrl failed:", e);
    throw e;
  }
}
