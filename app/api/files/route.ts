import { auth } from "@/utils/auth";
import { prisma } from "@/utils/prisma";
import { getOrCreateManagedConnection, normalizeFolderPath } from "@/utils/storage";

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
  updatedAt: Date;
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

function buildBreadcrumbs(path: string) {
  const segments = path ? path.split("/") : [];

  return [
    { name: "My Drive", path: "" },
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

function getItemCategory(item: DriveListItem): FilterType {
  if (item.type === "folder") return "folder";

  const mimeType = item.mimeType?.toLowerCase() ?? "";

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("sheet") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("presentation")
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
    const needle = query.toLowerCase();

    const managedConnection = await getOrCreateManagedConnection(session.user.id);

    const objects = await prisma.driveObject.findMany({
      where: {
        ownerId: session.user.id,
        connectionId: managedConnection.id,
        ...(currentPath
          ? {
              OR: [
                { path: currentPath },
                { path: { startsWith: `${currentPath}/` } },
              ],
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
          id: `folder:${folderFullPath}`,
          type: "folder",
          name: directFolderName,
          path: currentPath,
          fullPath: folderFullPath,
          updatedAt: null,
        });
      }
    }

    const allItems = [...folders.values(), ...files];
    const filteredItems = allItems
      .filter((item) => {
        if (filter !== "all" && getItemCategory(item) !== filter) {
          return false;
        }

        if (!needle) {
          return true;
        }

        return [item.name, item.fullPath, item.type, item.type === "file" ? item.mimeType ?? "" : ""]
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
      connection: {
        id: managedConnection.id,
        name: managedConnection.name,
      },
      path: currentPath,
      breadcrumbs: buildBreadcrumbs(currentPath),
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
