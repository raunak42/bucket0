# Bucket0-Inspired MVP Spec

## Goal
Build a polished, file-first Bucket0-style MVP in **12 hours max**.

The app should prove skill in:
- Next.js
- React
- Tailwind
- Auth
- S3-compatible storage APIs
- Multipart uploads with presigned URLs

This is a **proof-of-work MVP**, not a full production clone.

---

## Product Positioning
A modern storage dashboard with:
- **My Drive**: managed storage provided by the app
- **External Buckets**: user-connected S3-compatible buckets
- strong **file workflows** over broad provider support

### Core product idea
Users can:
- sign in
- browse files and folders
- upload files
- upload large files to managed storage via multipart presigned uploads
- connect one or more external S3-compatible buckets
- manage files in a clean dashboard

---

## Constraints
- Build time: **12 hours max**
- Current app: **Next.js 16**, **React 19**, **Tailwind 4**
- Optimize for demo value and shipping speed
- Prefer depth in file workflows over breadth in provider integrations

---

## Scope Summary

### In scope
- Auth
- Protected dashboard
- Managed storage (**My Drive**)
- External bucket connections (**generic S3-compatible**)
- File/folder browsing
- File upload
- Multipart presigned upload flow for **My Drive**
- Download
- Delete
- Create folder
- Basic preview for images, optional PDF preview if fast
- Clean responsive UI

### Out of scope
- Teams
- Chat
- Billing
- Share links
- Password-protected links
- Activity feeds
- AgentBucket
- Mobile app
- Full PDF tools
- Full multi-provider custom implementations
- True Azure Blob support
- Production-grade resumable uploads across sessions

---

## Product Decisions

### 1. File-first over provider-first
We will **go deep on file workflows** and **light on providers**.

#### Why
A stronger demo is:
- great upload UX
- multipart large-file support
- good folder navigation
- good previews
- clean dashboard

A weaker demo is:
- lots of provider logos
- shallow or unreliable file operations

### 2. Default storage architecture
**Do not create a new bucket per user.**

Use one app-owned S3-compatible bucket for managed storage.
Each user gets a prefix:

```txt
managed/{userId}/
```

Example:

```txt
app-managed-storage/
  managed/user_123/
  managed/user_456/
```

This becomes **My Drive** in the UI.

### 3. External bucket strategy
Support a **generic S3-compatible connection** model.

This covers:
- AWS S3
- Cloudflare R2
- DigitalOcean Spaces
- Backblaze B2 S3
- MinIO
- other S3-compatible providers

UI may include presets, but backend logic should stay generic.

### 4. Multipart upload strategy
Multipart upload is a key showcase feature.

For MVP:
- **My Drive** gets full multipart + presigned upload support
- **External Buckets** get basic upload support first

This keeps the advanced implementation focused and achievable.

---

## Target Users
- Developers
- indie hackers
- teams managing assets in object storage
- hiring reviewers evaluating frontend + S3 API skill

---

## MVP User Stories

### Auth
- As a user, I can sign up / sign in
- As a user, I can access a protected dashboard
- As a user, I can sign out

### My Drive
- As a user, I get a default managed drive when I create an account
- As a user, I can browse files and folders in My Drive
- As a user, I can upload files to My Drive
- As a user, I can upload larger files to My Drive using multipart upload
- As a user, I can create folders in My Drive
- As a user, I can delete files/folders in My Drive
- As a user, I can download files from My Drive

### External Buckets
- As a user, I can connect an external S3-compatible bucket
- As a user, I can browse files in a connected external bucket
- As a user, I can upload/download/delete files in a connected external bucket

### File UI
- As a user, I can navigate using breadcrumbs
- As a user, I can see file name, size, type, and modified time
- As a user, I can preview common image files

---

## MVP Features

## 1. Auth
### Required
- Sign in
- Sign up
- Sign out
- Protected dashboard routes

### Recommendation
Use the fastest practical solution:
- Clerk, or
- Supabase Auth, or
- Auth.js

For MVP speed, hosted auth is acceptable.

### Acceptance criteria
- Unauthenticated users are redirected away from dashboard
- Authenticated users land in dashboard
- Each user only sees their own drives and connections

---

## 2. My Drive
### Description
Default app-managed storage created automatically for every user.

### Storage mapping
- bucket: app-owned managed bucket
- prefix: `managed/{userId}/`

### Required actions
- List files/folders
- Upload file
- Multipart upload for large files
- Create folder
- Delete file
- Download file

### Acceptance criteria
- A new user has a visible **My Drive** entry in the sidebar
- Uploads appear in My Drive without page inconsistency
- Folder navigation works using prefixes

---

## 3. External Buckets
### Description
Users can connect their own S3-compatible bucket.

### Connection fields
- Display name
- Bucket name
- Region
- Endpoint (optional for AWS, required for most custom providers)
- Access key
- Secret key
- Optional root prefix

### Required actions
- Add connection
- Validate credentials
- Browse files
- Upload file
- Delete file
- Download file

### Acceptance criteria
- User can connect a valid bucket
- Connected bucket appears in sidebar
- User can browse and manage files in the bucket

---

## 4. File Manager UX
### Layout
- Sidebar
  - My Drive
  - External Buckets
  - Add Bucket button
- Main panel
  - Breadcrumbs
  - Toolbar
  - File table/grid

### Toolbar actions
- Upload
- New Folder
- Refresh

### File list columns
- Name
- Type
- Size
- Last Modified
- Actions

### Nice-to-have polish
- Empty states
- Loading skeletons/spinners
- File-type icons
- Selected row state

### Acceptance criteria
- User can switch between storage sources
- User can drill into folders and back out via breadcrumbs
- Empty buckets do not feel broken

---

## 5. Multipart Uploads for My Drive
### Why it matters
This is the highest-signal technical feature in the MVP.

### Supported flow
1. User selects a file
2. Frontend requests multipart upload initialization
3. Backend creates multipart upload in managed storage
4. Frontend requests presigned URLs for parts
5. Frontend uploads parts directly to storage
6. Frontend sends uploaded part ETags back to backend
7. Backend completes multipart upload

### Initial implementation constraints
- Multipart only for **My Drive**
- Sequential part uploads are acceptable for v1
- Parallel uploads are optional if time remains
- Abort endpoint is optional but recommended

### Chunk size
- Minimum: 5 MB
- Recommended for MVP: 8–10 MB

### Acceptance criteria
- Large file upload completes without routing through app server
- Progress is visible
- Upload completion results in a valid file in My Drive

---

## 6. Basic Preview
### Required
- Image preview in modal/panel

### Optional
- PDF preview if implementation is quick

### Acceptance criteria
- Clicking an image file opens a usable preview
- Non-previewable file types still support download

---

## Technical Architecture

## Frontend
- Next.js App Router
- React 19
- Tailwind 4
- Client components only where needed for interactivity

## Backend
- Next.js route handlers for storage APIs
- Server-side auth checks on protected routes and API endpoints

## Storage
### Managed storage
- one app-owned S3-compatible bucket
- per-user prefix

### External storage
- one record per external bucket connection
- credentials stored securely

### S3 client layer
Create a small storage abstraction:
- `listObjects()`
- `createFolder()`
- `deleteObject()`
- `getDownloadUrl()`
- `uploadSmallObject()`
- `startMultipartUpload()`
- `signMultipartPart()`
- `completeMultipartUpload()`

---

## Data Model
A simple schema is enough for MVP.

## `users`
Managed by auth provider or app auth layer.

## `storage_connections`
```ts
id
userId
name
type            // 'managed' | 'external'
provider        // 'internal' | 's3'
bucketName
region
endpoint
accessKeyEnc
secretKeyEnc
rootPrefix
isDefault
createdAt
updatedAt
```

### Notes
- Managed storage row is created on user signup
- For managed storage:
  - `provider = 'internal'`
  - credentials can come from env vars instead of row values
- For external buckets:
  - secrets must be encrypted at rest

---

## Route Plan

## Public routes
- `/`
- `/sign-in`
- `/sign-up`

## Protected routes
- `/dashboard`
- `/dashboard/[connectionId]` or query-param-driven source selection

---

## API Plan

### Auth/bootstrap
- handled by auth provider callbacks / session middleware

### Storage connections
- `GET /api/storage/connections`
- `POST /api/storage/connections`
- `POST /api/storage/connections/test`
- `DELETE /api/storage/connections/:id`

### File browsing/actions
- `GET /api/files/list?connectionId=...&prefix=...`
- `POST /api/files/folder`
- `DELETE /api/files/object`
- `GET /api/files/download?connectionId=...&key=...`

### Multipart upload (My Drive)
- `POST /api/uploads/multipart/start`
- `POST /api/uploads/multipart/sign-part`
- `POST /api/uploads/multipart/complete`
- `POST /api/uploads/multipart/abort` (optional)

### Basic upload (external buckets or small uploads)
- `POST /api/uploads/sign-put` or server-side proxy upload

---

## Security Notes
- Never expose app-managed storage root outside allowed user prefix
- Validate every API call against the authenticated user
- Encrypt external bucket credentials at rest
- Prefer direct browser-to-storage upload for managed multipart flow
- Do not trust file paths from the client without prefix checks

---

## UI Screens

## 1. Landing / auth entry
Simple page introducing the product and linking to sign in.

## 2. Dashboard
### Sidebar
- Logo / app name
- My Drive
- External Buckets section
- Add Bucket
- User/account area

### Main panel
- Header with current location
- Breadcrumbs
- Upload / New Folder actions
- File table

## 3. Add Bucket modal/page
Fields:
- name
- bucket name
- region
- endpoint
- access key
- secret key
- root prefix (optional)

## 4. Upload UI
- file picker
- progress bar
- multipart status for large file uploads

## 5. Preview modal
- image preview
- filename / size / close action

---

## Success Criteria
The MVP is successful if a reviewer can:
1. sign in
2. open a dashboard
3. see **My Drive**
4. upload a large file to My Drive using multipart upload
5. browse folders/files
6. connect an external S3-compatible bucket
7. browse and manage files there
8. feel that the UI is polished and intentional

---

## Build Priorities

## P0 — must ship
- Auth
- Dashboard shell
- My Drive connection bootstrap
- File listing for My Drive
- Create folder
- Delete file
- Download file
- Multipart upload for My Drive
- External bucket connection form
- File listing for external buckets

## P1 — important polish
- Progress UI
- Breadcrumbs
- Empty states
- Image preview
- Better file icons

## P2 — only if time remains
- PDF preview
- Parallel multipart upload
- Abort multipart upload
- Drag-and-drop upload
- Rename

---

## Suggested Build Order
1. Set up auth
2. Create managed storage abstraction
3. Create dashboard shell
4. Implement My Drive file listing
5. Implement create folder / delete / download
6. Implement multipart upload for My Drive
7. Add external bucket connection flow
8. Add external bucket browsing
9. Add upload UI and preview polish
10. Deploy and record demo

---

## Demo Pitch
When sharing this project, describe it as:

> A Bucket0-inspired storage dashboard built with Next.js, React, and Tailwind. It includes auth, managed per-user storage, external S3-compatible bucket connections, and direct multipart uploads with presigned URLs for large files.

---

## Explicit MVP Tradeoff
This MVP intentionally prioritizes:
- stronger file workflows
- better upload architecture
- cleaner UX

over:
- broad provider-specific support
- secondary collaboration features
- marketing feature sprawl

That is the right tradeoff for a 12-hour proof of work.
