"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { setPendingDisplayName } from "@/lib/pendingDisplayName";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [studentName, setStudentName] = useState("");
  const [message, setMessage] = useState({ type: null, text: "" });
  const [loading, setLoading] = useState(false);

  async function handleSendEmail(e) {
    e.preventDefault();
    setMessage({ type: null, text: "" });
    setLoading(true);
    try {
      const emailTrim = email.trim();
      const nameTrim = studentName.trim();
      if (nameTrim) setPendingDisplayName(emailTrim, nameTrim);
      const { error } = await supabase.auth.signInWithOtp({
        email: emailTrim,
        options: { emailRedirectTo: "http://localhost:3000" },
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

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>邮箱登录</CardTitle>
          <CardDescription>输入邮箱和学生姓名，我们将发送登录链接</CardDescription>
        </CardHeader>
        <CardContent>
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
              />
            </div>
            <div>
              <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-2">
                学生姓名 <span className="text-red-500">*</span>
              </label>
              <Input
                id="studentName"
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="请输入您的姓名"
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
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
