This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 教师权限与登录

- 登录页区分 **我是学生** / **我是老师**；学生可填显示名，老师不填姓名。
- 魔法链接回调地址为 **`/auth/callback`**。请在 Supabase Dashboard → Authentication → URL Configuration 中将  
  `http://localhost:3000/auth/callback` 与生产环境 `https://你的域名/auth/callback` 加入 **Redirect URLs**。
- 教师白名单：环境变量 **`TEACHER_AUTHORIZED_EMAILS`**（见 `.env.example`）；未设置时使用 `lib/teacherAuthorization.js` 内的 `FALLBACK_AUTHORIZED_TEACHER_EMAILS`。
- 服务端校验接口：`GET /api/auth/teacher-status`（需 `Authorization: Bearer <access_token>`）。
