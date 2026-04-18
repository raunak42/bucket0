# Bucket0

Bucket0 is a Bucket0-inspired file storage dashboard built with Next.js. It gives users a managed **My Drive** plus support for connecting external **S3-compatible buckets** like Amazon S3, Cloudflare R2, and Wasabi.

## What it does

- Email/password + GitHub/Google auth
- Managed storage with per-user isolation
- External bucket connections
- File and folder browsing
- File upload, folder upload, drag-and-drop upload
- Multipart uploads for large files
- Preview, download, and delete
- List + grid views
- Search, filter, sort, pagination
- Responsive dashboard UI

## Tech stack

- **Framework:** Next.js 16, React 19, TypeScript
- **Styling/UI:** Tailwind CSS 4, shadcn/ui, Radix UI, Lucide
- **Auth:** Better Auth
- **Database/ORM:** Neon Postgres, Prisma 7, Prisma Accelerate
- **Storage:** Amazon S3, Cloudflare R2, Wasabi
- **Uploads:** AWS SDK v3, presigned URLs, multipart uploads, server-side proxying for external buckets
- **Validation/UX:** Zod, react-hot-toast
- **Deploy:** Railway (recommended), Vercel for managed-only/direct upload flows

## Architecture

- **My Drive:** app-managed S3 bucket with a per-user prefix
- **External buckets:** user-provided S3-compatible credentials encrypted server-side before storage
- **Uploads:** managed storage uses direct presigned uploads; external buckets are proxied through the app server so uploads work without bucket CORS

## Local development

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open `http://localhost:3000`.

## Required services

- Neon/Postgres database
- Better Auth providers (GitHub / Google if you want social login)
- An S3 bucket for managed storage
- Optional external buckets for testing S3 / R2 / Wasabi connections

## Railway deployment

This repo includes Railway-ready config:

- `next.config.ts` uses `output: "standalone"`
- `railway.toml` sets the build and start commands
- `npm run build:railway` prepares `.next/standalone`
- `npm run start:railway` runs the standalone server

For Railway, set the same environment variables you use locally, plus make sure:

- `BETTER_AUTH_URL` matches your Railway public domain
- GitHub and Google OAuth callback URLs use that Railway domain
- `prisma migrate deploy` has been run against production
- managed S3 CORS is still configured for your app origin

With the current architecture:

- **Managed My Drive** still uploads browser -> bucket, so managed bucket CORS is required
- **External buckets** upload/preview/download through the app server, so external bucket CORS is not required

## Notes

This is an MVP focused on strong file workflows and a polished storage dashboard rather than a full production storage platform.
