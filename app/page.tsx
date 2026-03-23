"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { hasDevTeacherAccess } from "@/lib/devMode";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTeacherEntry, setShowTeacherEntry] = useState(false);
  const [sessionResolved, setSessionResolved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setShowTeacherEntry(false);
      setSessionResolved(true);
      return;
    }
    if (hasDevTeacherAccess()) {
      setShowTeacherEntry(true);
      setSessionResolved(true);
      return;
    }
    fetchTeacherAuthorization().then(({ authorized }) => {
      setShowTeacherEntry(!!authorized);
      setSessionResolved(true);
    });
  }, [user]);

  /** 纯学生账号不经过「首页」，直接进入学生端 */
  useEffect(() => {
    if (!sessionResolved || !user || showTeacherEntry) return;
    router.replace("/student");
  }, [sessionResolved, user, showTeacherEntry, router]);

  if (loading || (user && !sessionResolved)) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-500">加载中…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>学习记录总览</CardTitle>
          <CardDescription>
            {user ? "当前登录（教师入口）" : "未登录"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {user ? (
            <>
              <p className="text-sm text-gray-600 break-all">{user.email}</p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/student">
                  <Button variant="secondary" className="w-full sm:w-auto">
                    查看学生端
                  </Button>
                </Link>
                {showTeacherEntry && (
                  <Link href="/teacher">
                    <Button variant="primary" className="w-full sm:w-auto">
                      进入教师端
                    </Button>
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">未登录</p>
              <Link href="/login">
                <Button variant="primary">去登录</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}