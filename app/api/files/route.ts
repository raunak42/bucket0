import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { createS3Client, ListObjectsV2Command } from "@/utils/s3";
import {
  buildConnectionFolderKey,
  getStorageConnectionWithCredentialsForUser,
  normalizeFolderPath,
  toPublicStorageConnection,
} from "@/utils/storage";

export const runtime = "nodejs";

type FileItem = {
  id: string;
  type: "file";
  name: string;
  key: string;
  path: string;
  fullPath: string;
  mimeType: string | null;
  size: string;
  updatedAt: Date | null;
};

type FolderItem = {
  id: string;
  type: "folder";
  name: string;
  path: string;
  fullPath: string;
  updatedAt: Date | null;
};

type DriveListItem = FileItem | FolderItem;

type FilterType = "all" | "folder" | "image" | "video" | "document" | "audio" | "other";
type SortType =
  | "name_asc"
  | "name_desc"
  | "updated_desc"
  | "updated_asc"
  | "size_desc"
  | "size_asc";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function buildFullPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function buildBreadcrumbs(path: string, rootName: string) {
  const segments = path ? path.split("/") : [];

  return [
    { name: rootName, path: "" },
    ...segments.map((segment, index) => ({
      name: segment,
      path: segments.slice(0, index + 1).join("/"),
    })),
  ];
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function getFileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function guessMimeType(name: string) {
  const extension = getFileExtension(name);

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(extension)) {
    return `image/${extension === "jpg" ? "jpeg" : extension}`;
  }

  if (["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(extension)) {
    return `video/${extension === "m4v" ? "mp4" : extension}`;
  }

  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension)) {
    return `audio/${extension === "m4a" ? "mp4" : extension}`;
  }

  if (extension === "pdf") return "application/pdf";
  if (["txt", "md", "csv", "log"].includes(extension)) return "text/plain";
  if (["json"].includes(extension)) return "application/json";
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx"].includes(extension)) return "text/javascript";
  if (["html", "css", "xml", "yml", "yaml"].includes(extension)) return "text/plain";

  return null;
}

function getItemCategory(item: DriveListItem): FilterType {
  if (item.type === "folder") return "folder";

  const mimeType = item.mimeType?.toLowerCase() ?? "";
  const extension = getFileExtension(item.name);

  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(extension)) {
    return "image";
  }

  if (mimeType.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(extension)) {
    return "video";
  }

  if (mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension)) {
    return "audio";
  }

  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("sheet") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("presentation") ||
    ["pdf", "txt", "md", "csv", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "css", "xml", "yml", "yaml"].includes(extension)
  ) {
    return "document";
  }

  return "other";
}

function getItemTimestamp(item: DriveListItem) {
  return item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
}

function getItemSize(item: DriveListItem) {
  return item.type === "file" ? Number(item.size) : 0;
}

function compareItems(a: DriveListItem, b: DriveListItem, sort: SortType) {
  if (a.type !== b.type) {
    return a.type === "folder" ? -1 : 1;
  }

  if (a.type === "folder" && b.type === "folder") {
    if (sort === "updated_desc") return getItemTimestamp(b) - getItemTimestamp(a) || a.name.localeCompare(b.name);
    if (sort === "updated_asc") return getItemTimestamp(a) - getItemTimestamp(b) || a.name.localeCompare(b.name);
    return sort === "name_desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
  }

  switch (sort) {
    case "name_desc":
      return b.name.localeCompare(a.name);
    case "updated_desc":
      return getItemTimestamp(b) - getItemTimestamp(a) || a.name.localeCompare(b.name);
    case "updated_asc":
      return getItemTimestamp(a) - getItemTimestamp(b) || a.name.localeCompare(b.name);
    case "size_desc":
      return getItemSize(b) - getItemSize(a) || a.name.localeCompare(b.name);
    case "size_asc":
      return getItemSize(a) - getItemSize(b) || a.name.localeCompare(b.name);
    case "name_asc":
    default:
      return a.name.localeCompare(b.name);
  }
}

async function listManagedItems({
  ownerId,
  connectionId,
  currentPath,
}: {
  ownerId: string;
  connectionId: string;
  currentPath: string;
}) {
  const objects = await prisma.driveObject.findMany({
    where: {
      ownerId,
      connectionId,
      ...(currentPath
        ? {
            OR: [{ path: currentPath }, { path: { startsWith: `${currentPath}/` } }],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  const folders = new Map<string, FolderItem>();
  const files: FileItem[] = [];
  const nestedPrefix = currentPath ? `${currentPath}/` : "";

  for (const object of objects) {
    if (object.type === "folder" && object.path === currentPath) {
      const folderFullPath = buildFullPath(currentPath, object.name);
      if (!folders.has(folderFullPath)) {
        folders.set(folderFullPath, {
          id: object.id,
          type: "folder",
          name: object.name,
          path: currentPath,
          fullPath: folderFullPath,
          updatedAt: object.updatedAt,
        });
      }
      continue;
    }

    if (object.path === currentPath && object.type === "file") {
      files.push({
        id: object.id,
        type: "file",
        name: object.name,
        key: object.key,
        path: object.path,
        fullPath: buildFullPath(object.path, object.name),
        mimeType: object.mimeType,
        size: object.size.toString(),
        updatedAt: object.updatedAt,
      });
    }

    if (!object.path) {
      continue;
    }

    if (currentPath && !object.path.startsWith(nestedPrefix)) {
      continue;
    }

    const remainingPath = currentPath
      ? object.path.slice(nestedPrefix.length)
      : object.path;

    if (!remainingPath) {
      continue;
    }

    const directFolderName = remainingPath.split("/")[0];
    const folderFullPath = buildFullPath(currentPath, directFolderName);

    if (!folders.has(folderFullPath)) {
      folders.set(folderFullPath, {
        id: `folder:${connectionId}:${folderFullPath}`,
        type: "folder",
        name: directFolderName,
        path: currentPath,
        fullPath: folderFullPath,
        updatedAt: null,
      });
    }
  }

  return [...folders.values(), ...files];
}

async function listExternalItems({
  ownerId,
  connection,
  currentPath,
}: {
  ownerId: string;
  connection: Awaited<ReturnType<typeof getStorageConnectionWithCredentialsForUser>>;
  currentPath: string;
}) {
  const client = createS3Client({
    provider: connection.provider,
    region: connection.region,
    endpoint: connection.endpoint,
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
  });

  const folderKey = buildConnectionFolderKey({
    connection,
    ownerId,
    folderPath: currentPath,
  });
  const prefix = folderKey ? `${folderKey}/` : undefined;
  const folders = new Map<string, FolderItem>();
  const files: FileItem[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: connection.bucketName,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      }),
    );

    for (const commonPrefix of page.CommonPrefixes ?? []) {
      const nextPrefix = commonPrefix.Prefix;

      if (!nextPrefix) {
        continue;
      }

      const relativePrefix = prefix ? nextPrefix.slice(prefix.length) : nextPrefix;
      const folderName = relativePrefix.replace(/\/+$/g, "").split("/")[0];

      if (!folderName) {
        continue;
      }

      const folderFullPath = buildFullPath(currentPath, folderName);

      if (!folders.has(folderFullPath)) {
        folders.set(folderFullPath, {
          id: `folder:${connection.id}:${folderFullPath}`,
          type: "folder",
          name: folderName,
          path: currentPath,
          fullPath: folderFullPath,
          updatedAt: null,
        });
      }
    }

    for (const object of page.Contents ?? []) {
      if (!object.Key) {
        continue;
      }

      const relativeKey = prefix ? object.Key.slice(prefix.length) : object.Key;

      if (!relativeKey) {
        continue;
      }

      if (relativeKey.endsWith("/")) {
        const folderName = relativeKey.replace(/\/+$/g, "").split("/")[0];

        if (!folderName) {
          continue;
        }

        const folderFullPath = buildFullPath(currentPath, folderName);

        if (!folders.has(folderFullPath)) {
          folders.set(folderFullPath, {
            id: `folder:${connection.id}:${folderFullPath}`,
            type: "folder",
            name: folderName,
            path: currentPath,
            fullPath: folderFullPath,
            updatedAt: object.LastModified ?? null,
          });
        }

        continue;
      }

      if (relativeKey.includes("/")) {
        continue;
      }

      const name = relativeKey;
      files.push({
        id: `file:${connection.id}:${object.Key}`,
        type: "file",
        name,
        key: object.Key,
        path: currentPath,
        fullPath: buildFullPath(currentPath, name),
        mimeType: guessMimeType(name),
        size: String(object.Size ?? 0),
        updatedAt: object.LastModified ?? null,
      });
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return [...folders.values(), ...files];
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const currentPath = normalizeFolderPath(searchParams.get("path"));
    const query = searchParams.get("query")?.trim() ?? "";
    const filter = (searchParams.get("filter") as FilterType | null) ?? "all";
    const sort = (searchParams.get("sort") as SortType | null) ?? "name_asc";
    const page = parsePositiveInteger(searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInteger(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const connectionId = searchParams.get("connectionId");
    const needle = query.toLowerCase();

    const connection = await getStorageConnectionWithCredentialsForUser(
      session.user.id,
      connectionId,
    );

    const allItems = connection.type === "managed"
      ? await listManagedItems({
          ownerId: session.user.id,
          connectionId: connection.id,
          currentPath,
        })
      : await listExternalItems({
          ownerId: session.user.id,
          connection,
          currentPath,
        });

    const filteredItems = allItems
      .filter((item) => {
        if (filter !== "all" && getItemCategory(item) !== filter) {
          return false;
        }

        if (!needle) {
          return true;
        }

        return [
          item.name,
          item.fullPath,
          item.type,
          item.type === "file" ? item.mimeType ?? "" : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => compareItems(a, b, sort));

    const totalItems = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(page, totalPages);
    const offset = totalItems === 0 ? 0 : (currentPage - 1) * limit;
    const paginatedItems = filteredItems.slice(offset, offset + limit);
    const fileCount = filteredItems.filter((item) => item.type === "file").length;
    const folderCount = filteredItems.filter((item) => item.type === "folder").length;
    const totalBytes = filteredItems.reduce(
      (sum, item) => sum + (item.type === "file" ? Number(item.size) : 0),
      0,
    );

    return Response.json({
      ok: true,
      connection: toPublicStorageConnection(connection),
      path: currentPath,
      breadcrumbs: buildBreadcrumbs(currentPath, connection.name),
      items: paginatedItems,
      pagination: {
        page: currentPage,
        limit,
        totalItems,
        totalPages,
        from: totalItems === 0 ? 0 : offset + 1,
        to: Math.min(offset + limit, totalItems),
      },
      summary: {
        totalItems,
        fileCount,
        folderCount,
        totalBytes: totalBytes.toString(),
      },
      filters: {
        query,
        filter,
        sort,
      },
    });
  } catch (error) {
    console.error("files route error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list files" },
      { status: 500 },
    );
  }
}
