"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { isTeacherEmail } from "@/lib/constants";
import { hasDevTeacherAccess } from "@/lib/devMode";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTeacherButton, setShowTeacherButton] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    setShowTeacherButton(hasDevTeacherAccess());
  }, []);

  if (loading) {
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
            {user ? "当前登录" : "未登录"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {user ? (
            <>
              <p className="text-sm text-gray-600">
                当前登录：{user.email}
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/student">
                  <Button variant="primary" className="w-full sm:w-auto">
                    学生端
                  </Button>
                </Link>
                {(isTeacherEmail(user.email) || showTeacherButton) && (
                  <Link href="/teacher">
                    <Button variant="secondary" className="w-full sm:w-auto">
                      教师端
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