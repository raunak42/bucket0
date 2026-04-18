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
- **Uploads:** AWS SDK v3, presigned URLs, multipart uploads
- **Validation/UX:** Zod, react-hot-toast
- **Deploy:** Vercel

## Architecture

- **My Drive:** app-managed S3 bucket with a per-user prefix
- **External buckets:** user-provided S3-compatible credentials encrypted server-side before storage
- **Uploads:** browser uploads directly to object storage using presigned URLs

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

## Notes

This is an MVP focused on strong file workflows and a polished storage dashboard rather than a full production storage platform.
