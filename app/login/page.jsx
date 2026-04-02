"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { setLoginIntent, LOGIN_INTENT_STUDENT, LOGIN_INTENT_TEACHER } from "@/lib/loginIntent";
import { routeAfterAuthSession } from "@/lib/postAuthRouting";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const noTeacherReason = searchParams.get("reason") === "no_teacher";

  const [role, setRole] = useState("student");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState({ type: null, text: "" });
  const [loading, setLoading] = useState(false);
  const [sessionBoot, setSessionBoot] = useState(true);

  /** 已有有效会话：直接进入学生端 / 教师端 / 首次补全姓名，不再展示登录表 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession();
      if (cancelled) return;
      if (session?.user) {
        await routeAfterAuthSession(session.user, router);
      }
      if (!cancelled) setSessionBoot(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSendEmail(e) {
    e.preventDefault();
    setMessage({ type: null, text: "" });
    setLoading(true);
    try {
      const emailTrim = email.trim();
      if (role === "student") {
        setLoginIntent(LOGIN_INTENT_STUDENT);
      } else {
        setLoginIntent(LOGIN_INTENT_TEACHER);
      }

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const redirectTo = origin ? `${origin}/auth/callback` : undefined;

      const { error } = await getSupabaseClient().auth.signInWithOtp({
        email: emailTrim,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (error) {
        setMessage({ type: "error", text: `登录失败，请重试（系统信息：${error.message}）` });
        return;
      }
      setMessage({
        type: "success",
        text: "登录邮件已发送，请去邮箱点击链接完成登录",
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: `登录失败，请重试（系统信息：${err?.message || "未知错误"}）`,
      });
    } finally {
      setLoading(false);
    }
  }

  if (sessionBoot) {
    return (
      <div className="max-w-md mx-auto py-16 text-center text-gray-500 text-sm">加载中…</div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader className="space-y-4">
          <CardTitle>登录</CardTitle>
          <CardDescription>
            请选择身份后再输入邮箱；系统将发送登录链接到您的邮箱。
          </CardDescription>
          <div
            className="flex rounded-2xl border border-teal-200/80 bg-teal-50/50 p-1 gap-1"
            role="tablist"
            aria-label="登录身份"
          >
            <button
              type="button"
              role="tab"
              aria-selected={role === "student"}
              onClick={() => setRole("student")}
              className={`flex-1 min-h-11 rounded-xl text-sm font-semibold transition-colors ${
                role === "student"
                  ? "bg-white text-teal-900 shadow-sm border border-teal-100"
                  : "text-teal-800/80 hover:text-teal-900"
              }`}
            >
              我是学生
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={role === "teacher"}
              onClick={() => setRole("teacher")}
              className={`flex-1 min-h-11 rounded-xl text-sm font-semibold transition-colors ${
                role === "teacher"
                  ? "bg-white text-teal-900 shadow-sm border border-teal-100"
                  : "text-teal-800/80 hover:text-teal-900"
              }`}
            >
              我是老师
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {noTeacherReason && (
            <Alert variant="error" className="mb-4">
              该账号没有教师权限。请确认使用教师邮箱登录，或改用「我是学生」入口。
            </Alert>
          )}
          <form onSubmit={handleSendEmail} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>
            {role === "student" && (
              <p className="text-sm text-gray-600 leading-relaxed">
                学生登录只需邮箱验证。
                <span className="block mt-1 text-xs text-gray-500">
                  首次登录验证成功后，将单独引导您填写一次学生显示名并写入系统；之后再次登录无需重复填写。
                </span>
              </p>
            )}
            {role === "teacher" && (
              <p className="text-sm text-gray-600 leading-relaxed">
                教师登录无需填写姓名。登录成功后系统会校验您是否在教师白名单中；未授权账号无法进入教师端。
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full min-h-11">
              {loading ? "发送中…" : "发送登录邮件"}
            </Button>
          </form>
          {message.text && (
            <Alert variant={message.type === "error" ? "error" : "success"} className="mt-4">
              {message.text}
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto py-12 text-center text-gray-500">加载中…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
