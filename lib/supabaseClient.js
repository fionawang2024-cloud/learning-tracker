import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

/**
 * 仅用于 PostgREST / Storage 等数据访问，不使用 Supabase Auth。
 * 关闭会话持久化与自动刷新，避免浏览器对 `/auth/v1/token?grant_type=refresh_token` 的轮询
 *（旧版登录残留在 localStorage 时会导致大量失败请求）。
 */
export const supabaseNoAuthClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

/**
 * Lazy Supabase browser client. Env is only read when this is called (not at import time),
 * so `next build` can run without NEXT_PUBLIC_* set in the build environment.
 */
export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in environment variables"
    );
  }

  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, supabaseNoAuthClientOptions);
  }
  return cachedClient;
}
