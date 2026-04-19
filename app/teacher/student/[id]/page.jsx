"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TeacherStudentRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <p className="text-sm text-gray-500 py-8 text-center">正在返回首页…</p>
  );
}
