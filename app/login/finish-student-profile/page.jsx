"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getOrCreateStudent, updateStudentDisplayName } from "@/lib/db";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { hasDevTeacherAccess } from "@/lib/devMode";
import { studentNeedsDisplayNameSetup } from "@/lib/studentProfileSetup";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

/**
 * One-time step after first magic-link login: set students.display_name.
 * Not used for profile edits; returning users are redirected away.
 */
export default function FinishStudentProfilePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [studentId, setStudentId] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession();
      if (cancelled) return;
      const u = session?.user;
      if (!u) {
        router.replace("/login");
        return;
      }

      if (hasDevTeacherAccess()) {
        router.replace("/teacher");
        return;
      }
      const { authorized } = await fetchTeacherAuthorization();
      if (cancelled) return;
      if (authorized) {
        router.replace("/teacher");
        return;
      }

      let student;
      try {
        student = await getOrCreateStudent(u);
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled || !student) {
        if (!student) router.replace("/login");
        return;
      }

      if (!studentNeedsDisplayNameSetup(u.email, student.display_name)) {
        router.replace("/student");
        return;
      }

      setStudentId(student.id);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const name = displayName.trim();
    if (!name) {
      setError("请填写学生姓名（显示名）。");
      return;
    }
    if (!studentId) return;
    setSaving(true);
    try {
      await updateStudentDisplayName(studentId, name);
      router.replace("/student");
    } catch (err) {
      setError(err?.message || "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <div className="max-w-md mx-auto py-16 text-center text-gray-500 text-sm">加载中…</div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>完善学生信息</CardTitle>
          <CardDescription>
            首次登录请填写学生在本系统显示的姓名。此信息将保存，之后登录无需再填。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="error" className="text-sm">
                {error}
              </Alert>
            )}
            <div>
              <label htmlFor="dn" className="block text-sm font-medium text-gray-700 mb-2">
                学生姓名（显示名）<span className="text-red-500">*</span>
              </label>
              <Input
                id="dn"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="请输入真实姓名，便于老师辨认"
                required
                disabled={saving}
                autoComplete="name"
                className="w-full"
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full min-h-11">
              {saving ? "保存中…" : "保存并进入学习"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-gray-500 leading-relaxed">
            显示名保存后，日常登录只需验证邮箱，无需再次填写。改名请通过老师或后续「资料设置」功能处理。
          </p>
          <button
            type="button"
            className="mt-3 text-sm text-teal-700 hover:underline"
            onClick={async () => {
              await getSupabaseClient().auth.signOut();
              router.replace("/login");
            }}
          >
            退出并换其他账号
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
