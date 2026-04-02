"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { consumeLoginIntent, LOGIN_INTENT_STUDENT, LOGIN_INTENT_TEACHER } from "@/lib/loginIntent";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { routeAfterAuthSession } from "@/lib/postAuthRouting";

/**
 * Magic-link landing: exchange session, then redirect by login intent (student vs teacher).
 * Add this URL to Supabase Auth → Redirect URLs (e.g. https://your-domain/auth/callback).
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [hint, setHint] = useState("正在完成登录…");
  const finishedRef = useRef(false);
  const subscriptionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function finish(session) {
      if (!session?.user || cancelled || finishedRef.current) return;
      finishedRef.current = true;

      const intent = consumeLoginIntent();

      if (intent === LOGIN_INTENT_TEACHER) {
        const { authorized } = await fetchTeacherAuthorization();
        if (cancelled) return;
        if (authorized) {
          router.replace("/teacher");
          return;
        }
        finishedRef.current = false;
        setHint("");
        router.replace("/login?reason=no_teacher");
        return;
      }

      if (intent === LOGIN_INTENT_STUDENT) {
        await routeAfterAuthSession(session.user, router);
        return;
      }

      /* 无身份标记：按学生侧规则分流（含首次补全姓名） */
      await routeAfterAuthSession(session.user, router);
    }

    (async () => {
      if (typeof window !== "undefined") {
        const code = new URL(window.location.href).searchParams.get("code");
        if (code) {
          const { error } = await getSupabaseClient().auth.exchangeCodeForSession(code);
          if (error) {
            if (!cancelled) setHint("登录链接无效或已过期，请返回登录页重试。");
            return;
          }
        }
      }

      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession();
      if (cancelled) return;
      if (session?.user) {
        await finish(session);
        return;
      }

      const {
        data: { subscription },
      } = getSupabaseClient().auth.onAuthStateChange((event, nextSession) => {
        if (event === "SIGNED_IN" && nextSession) {
          finish(nextSession);
        }
      });
      subscriptionRef.current = subscription;

      if (!cancelled) {
        setHint("正在完成登录…若长时间停留，请返回登录页重试。");
      }
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <p className="text-gray-700">{hint}</p>
    </div>
  );
}
