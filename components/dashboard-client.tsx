"use client";

/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  FileText,
  FolderClosed,
  FolderUp,
  HardDrive,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageSquareMore,
  MoreHorizontal,
  Music4,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  Users,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "react-hot-toast";

type Breadcrumb = {
  name: string;
  path: string;
};

type DashboardItem = {
  id: string;
  type: "file" | "folder";
  name: string;
  path: string;
  fullPath: string;
  key?: string;
  mimeType?: string | null;
  size?: string;
  updatedAt: string | null;
};

type DirectoryUploadFile = File & {
  webkitRelativePath?: string;
};

type FilesResponse = {
  ok: boolean;
  connection: {
    id: string;
    name: string;
  };
  path: string;
  breadcrumbs: Breadcrumb[];
  items: DashboardItem[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    from: number;
    to: number;
  };
  summary: {
    totalItems: number;
    fileCount: number;
    folderCount: number;
    totalBytes: string;
  };
  filters: {
    query: string;
    filter: FilterTab;
    sort: string;
  };
};

type InitUploadResponse =
  | {
      ok: true;
      mode: "simple";
      uploadId: string;
      key: string;
      bucketName: string;
      uploadUrl: string;
    }
  | {
      ok: true;
      mode: "multipart";
      uploadId: string;
      key: string;
      bucketName: string;
      partSize: number;
    };

type FilterTab =
  | "all"
  | "folder"
  | "image"
  | "video"
  | "document"
  | "audio"
  | "other";

type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "other";

type PreviewFile = {
  id: string;
  name: string;
  key: string;
  mimeType: string | null;
  size: string;
  updatedAt: string;
  previewUrl: string;
  downloadUrl: string;
  expiresAt: string;
};

type PreviewCacheEntry = {
  file: PreviewFile;
  textPreview?: string;
};

type DeleteItem = DashboardItem | { id: string; type: "file"; name: string };

type DeleteTarget =
  | { mode: "single"; items: [DeleteItem] }
  | { mode: "bulk"; items: DashboardItem[] };

type UploadCandidate = {
  file: File;
  relativePath: string;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

const FILTER_TABS: Array<{ label: string; value: FilterTab }> = [
  { label: "All", value: "all" },
  { label: "Folders", value: "folder" },
  { label: "Images", value: "image" },
  { label: "Videos", value: "video" },
  { label: "Documents", value: "document" },
  { label: "Audio", value: "audio" },
  { label: "Other", value: "other" },
];

const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const PREVIEW_CACHE_GRACE_MS = 30 * 1000;
const PAGE_SIZE = 10;
const DEFAULT_SORT = "name_asc";

function formatBytes(size?: string) {
  if (!size) return "—";

  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");
}

function getItemSubtitle(item: DashboardItem) {
  if (item.type === "folder") return "Folder";
  return item.mimeType || "File";
}

function validateFolderName(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "Folder name is required";
  }

  if (trimmedValue.includes("/") || trimmedValue.includes("\\")) {
    return "Folder name cannot contain slashes";
  }

  if (trimmedValue === "." || trimmedValue === "..") {
    return "Folder name is invalid";
  }

  return null;
}

function joinFolderPath(basePath: string, relativePath: string) {
  const parts = [basePath, relativePath]
    .filter(Boolean)
    .flatMap((segment) => segment.split("/"))
    .map((segment) => segment.trim())
    .filter(Boolean);

  return parts.join("/");
}

function getPreviewKind(file: Pick<PreviewFile, "mimeType" | "name">): PreviewKind {
  const mimeType = file.mimeType?.toLowerCase() ?? "";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("pdf") || extension === "pdf") return "pdf";

  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType.includes("csv") ||
    ["js", "ts", "tsx", "jsx", "json", "md", "txt", "css", "html", "yml", "yaml", "csv"].includes(extension)
  ) {
    return "text";
  }

  return "other";
}

function canReusePreviewCache(cachedFile: PreviewFile, item: DashboardItem) {
  const expiresAt = new Date(cachedFile.expiresAt).getTime();

  return (
    Number.isFinite(expiresAt) &&
    expiresAt - Date.now() > PREVIEW_CACHE_GRACE_MS &&
    cachedFile.updatedAt === item.updatedAt
  );
}

function isTypingElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getDeleteDialogCopy(deleteTarget: DeleteTarget | null) {
  if (!deleteTarget) {
    return {
      title: "Delete item?",
      description: "This action cannot be undone.",
    };
  }

  if (deleteTarget.mode === "single") {
    const item = deleteTarget.items[0];

    return {
      title: `Delete ${item.type === "folder" ? "folder" : "file"}?`,
      description: `This will permanently remove ${item.name}${item.type === "folder" ? " and everything inside it" : ""}.`,
    };
  }

  const folderCount = deleteTarget.items.filter((item) => item.type === "folder").length;
  const fileCount = deleteTarget.items.length - folderCount;
  const parts = [
    fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : null,
    folderCount > 0 ? `${folderCount} folder${folderCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    title: `Delete ${deleteTarget.items.length} selected item${deleteTarget.items.length === 1 ? "" : "s"}?`,
    description: `This will permanently remove ${parts.join(" and ")}${folderCount > 0 ? " and all nested contents" : ""}.`,
  };
}

async function readDirectoryEntries(directory: FileSystemDirectoryEntry) {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (batch.length === 0) {
      break;
    }

    entries.push(...batch);
  }

  return entries;
}

async function readDroppedEntry(
  entry: FileSystemEntry,
  currentPath = "",
): Promise<UploadCandidate[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });

    return [
      {
        file,
        relativePath: joinFolderPath(currentPath, file.name),
      },
    ];
  }

  if (entry.isDirectory) {
    const directoryEntry = entry as FileSystemDirectoryEntry;
    const nextPath = joinFolderPath(currentPath, directoryEntry.name);
    const children = await readDirectoryEntries(directoryEntry);
    const nested = await Promise.all(
      children.map((child) => readDroppedEntry(child, nextPath)),
    );

    return nested.flat();
  }

  return [];
}

function getItemIcon(item: DashboardItem) {
  if (item.type === "folder") {
    return <FolderClosed className="size-4" />;
  }

  const previewKind = getPreviewKind({
    mimeType: item.mimeType ?? null,
    name: item.name,
  });

  switch (previewKind) {
    case "image":
      return <ImageIcon className="size-4" />;
    case "video":
      return <Video className="size-4" />;
    case "audio":
      return <Music4 className="size-4" />;
    case "text":
      return <FileCode2 className="size-4" />;
    case "pdf":
      return <FileText className="size-4" />;
    default:
      return <File className="size-4" />;
  }
}

async function uploadSimpleFile(
  file: File,
  initData: Extract<InitUploadResponse, { mode: "simple" }>,
) {
  const uploadResponse = await fetch(initData.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error("Simple upload to S3 failed");
  }

  const completeResponse = await fetch("/api/uploads/complete-simple", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uploadId: initData.uploadId }),
  });

  if (!completeResponse.ok) {
    const errorData = (await completeResponse.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(errorData?.error || "Could not finalize upload");
  }
}

async function uploadMultipartFile(
  file: File,
  initData: Extract<InitUploadResponse, { mode: "multipart" }>,
) {
  const parts: Array<{ etag: string; partNumber: number }> = [];

  for (
    let partNumber = 1, start = 0;
    start < file.size;
    partNumber += 1, start += initData.partSize
  ) {
    const end = Math.min(start + initData.partSize, file.size);
    const chunk = file.slice(start, end);

    const partUrlResponse = await fetch("/api/uploads/part-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uploadId: initData.uploadId,
        partNumber,
      }),
    });

    if (!partUrlResponse.ok) {
      const errorData = (await partUrlResponse.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(
        errorData?.error || `Could not get URL for part ${partNumber}`,
      );
    }

    const partData = (await partUrlResponse.json()) as { uploadUrl: string };

    const uploadPartResponse = await fetch(partData.uploadUrl, {
      method: "PUT",
      body: chunk,
    });

    if (!uploadPartResponse.ok) {
      throw new Error(`Uploading part ${partNumber} failed`);
    }

    const etag =
      uploadPartResponse.headers.get("etag") ??
      uploadPartResponse.headers.get("ETag");

    if (!etag) {
      throw new Error(`Missing ETag for part ${partNumber}`);
    }

    parts.push({ etag, partNumber });
  }

  const completeResponse = await fetch("/api/uploads/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uploadId: initData.uploadId,
      parts,
    }),
  });

  if (!completeResponse.ok) {
    const errorData = (await completeResponse.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(errorData?.error || "Could not complete multipart upload");
  }
}

export function DashboardClient({ userName }: { userName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<FilesResponse | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderNameError, setFolderNameError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [deletingItemKey, setDeletingItemKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const previewCacheRef = useRef<Map<string, PreviewCacheEntry>>(new Map());
  const previewRequestRef = useRef<Map<string, Promise<PreviewCacheEntry>>>(new Map());
  const dragDepthRef = useRef(0);

  const loadFiles = useCallback(async (
    options?: {
      path?: string;
      pageNumber?: number;
      queryValue?: string;
      filterValue?: FilterTab;
      sortValue?: string;
    },
  ) => {
    setIsLoading(true);

    try {
      const path = options?.path ?? currentPath;
      const pageNumber = options?.pageNumber ?? page;
      const queryValue = options?.queryValue ?? query;
      const filterValue = options?.filterValue ?? filter;
      const sortValue = options?.sortValue ?? DEFAULT_SORT;
      const searchParams = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(pageNumber),
        sort: sortValue,
      });

      if (path) {
        searchParams.set("path", path);
      }

      if (queryValue.trim()) {
        searchParams.set("query", queryValue.trim());
      }

      if (filterValue !== "all") {
        searchParams.set("filter", filterValue);
      }

      const response = await fetch(`/api/files?${searchParams.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || "Could not load files");
      }

      const nextData = (await response.json()) as FilesResponse;
      setData(nextData);
      setCurrentPath(nextData.path);
      setPage(nextData.pagination.page);
      setSelectedIds(new Set());
    } catch (error) {
      console.error("dashboard load error", error);
      toast.error(
        error instanceof Error ? error.message : "Could not load files.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, filter, page, query]);

  const previewKind = previewFile ? getPreviewKind(previewFile) : null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFiles({
        path: "",
        pageNumber: 1,
        queryValue: "",
        filterValue: "all",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadFiles]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const totalMatchingItems = data?.pagination.totalItems ?? 0;
  const currentPage = data?.pagination.page ?? page;
  const totalPages = data?.pagination.totalPages ?? 1;
  const pageStartIndex = data?.pagination.from ? data.pagination.from - 1 : 0;
  const pageEndIndex = data?.pagination.to ?? items.length;
  const paginatedItems = items;

  const totalBytes = Number(data?.summary.totalBytes ?? 0);
  const folderCount = data?.summary.folderCount ?? 0;
  const storageProgress = Math.min((totalBytes / STORAGE_LIMIT_BYTES) * 100, 100);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const selectedFileItems = useMemo(
    () => selectedItems.filter((item) => item.type === "file"),
    [selectedItems],
  );

  const areAllPageItemsSelected =
    paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.has(item.id));
  const areSomePageItemsSelected =
    paginatedItems.some((item) => selectedIds.has(item.id)) && !areAllPageItemsSelected;

  const visiblePreviewCandidates = useMemo(
    () => paginatedItems.filter((item) => item.type === "file"),
    [paginatedItems],
  );

  const fetchTextPreviewForFile = useCallback(async (file: PreviewFile) => {
    const cachedEntry = previewCacheRef.current.get(file.id);

    if (cachedEntry?.textPreview !== undefined) {
      return cachedEntry.textPreview;
    }

    const response = await fetch(file.previewUrl);

    if (!response.ok) {
      throw new Error("Could not load text preview");
    }

    const nextTextPreview = (await response.text()).slice(0, 50000);
    const currentEntry = previewCacheRef.current.get(file.id);

    previewCacheRef.current.set(file.id, {
      file: currentEntry?.file ?? file,
      textPreview: nextTextPreview,
    });

    return nextTextPreview;
  }, []);

  const fetchPreviewEntry = useCallback(
    async (
      item: DashboardItem,
      options?: {
        prefetchText?: boolean;
      },
    ) => {
      if (item.type !== "file") {
        throw new Error("Only files can be previewed");
      }

      const cachedEntry = previewCacheRef.current.get(item.id);

      if (cachedEntry && canReusePreviewCache(cachedEntry.file, item)) {
        if (
          options?.prefetchText &&
          getPreviewKind(cachedEntry.file) === "text" &&
          cachedEntry.textPreview === undefined
        ) {
          const nextTextPreview = await fetchTextPreviewForFile(cachedEntry.file);
          return {
            file: cachedEntry.file,
            textPreview: nextTextPreview,
          } satisfies PreviewCacheEntry;
        }

        return cachedEntry;
      }

      if (cachedEntry) {
        previewCacheRef.current.delete(item.id);
      }

      const existingRequest = previewRequestRef.current.get(item.id);
      if (existingRequest) {
        const pendingEntry = await existingRequest;

        if (
          options?.prefetchText &&
          getPreviewKind(pendingEntry.file) === "text" &&
          pendingEntry.textPreview === undefined
        ) {
          const nextTextPreview = await fetchTextPreviewForFile(pendingEntry.file);
          return {
            file: pendingEntry.file,
            textPreview: nextTextPreview,
          } satisfies PreviewCacheEntry;
        }

        return pendingEntry;
      }

      const request = (async () => {
        const response = await fetch(`/api/files/preview?id=${encodeURIComponent(item.id)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(errorData?.error || "Could not load file preview");
        }

        const result = (await response.json()) as { ok: true; file: PreviewFile };
        const nextEntry: PreviewCacheEntry = {
          file: result.file,
          ...(cachedEntry?.textPreview !== undefined
            ? { textPreview: cachedEntry.textPreview }
            : {}),
        };

        previewCacheRef.current.set(item.id, nextEntry);
        return nextEntry;
      })();

      previewRequestRef.current.set(item.id, request);

      try {
        const nextEntry = await request;

        if (
          options?.prefetchText &&
          getPreviewKind(nextEntry.file) === "text" &&
          nextEntry.textPreview === undefined
        ) {
          const nextTextPreview = await fetchTextPreviewForFile(nextEntry.file);
          return {
            file: nextEntry.file,
            textPreview: nextTextPreview,
          } satisfies PreviewCacheEntry;
        }

        return nextEntry;
      } finally {
        previewRequestRef.current.delete(item.id);
      }
    },
    [fetchTextPreviewForFile],
  );

  useEffect(() => {
    for (const item of visiblePreviewCandidates) {
      void fetchPreviewEntry(item, { prefetchText: true }).catch(() => {
        // Ignore background prefetch failures. We retry on explicit open.
      });
    }
  }, [fetchPreviewEntry, visiblePreviewCandidates]);

  const toggleItemSelection = useCallback((itemId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }

      return next;
    });
  }, []);

  const togglePageSelection = useCallback((checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      for (const item of paginatedItems) {
        if (checked) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      }

      return next;
    });
  }, [paginatedItems]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const onPickFile = () => inputRef.current?.click();
  const onPickFolder = () => directoryInputRef.current?.click();

  const uploadManagedFile = useCallback(
    async (file: File, folderPath: string) => {
      const initResponse = await fetch("/api/uploads/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          folderPath,
        }),
      });

      if (!initResponse.ok) {
        const errorData = (await initResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || `Could not start upload for ${file.name}`);
      }

      const initData = (await initResponse.json()) as InitUploadResponse;

      if (initData.mode === "simple") {
        await uploadSimpleFile(file, initData);
      } else {
        await uploadMultipartFile(file, initData);
      }
    },
    [],
  );

  const uploadCandidates = useCallback(
    async (candidates: UploadCandidate[], label: string) => {
      if (candidates.length === 0) {
        return;
      }

      setIsUploading(true);
      const toastId = toast.loading(label);

      try {
        for (const candidate of candidates) {
          const pathSegments = candidate.relativePath.split("/").filter(Boolean);
          const relativeFolderPath = pathSegments.slice(0, -1).join("/");
          const targetFolderPath = joinFolderPath(currentPath, relativeFolderPath);

          await uploadManagedFile(candidate.file, targetFolderPath);
        }

        toast.success(
          candidates.length === 1
            ? `${candidates[0]?.file.name || "Item"} uploaded`
            : `Uploaded ${candidates.length} items`,
          { id: toastId },
        );
        await loadFiles({ path: currentPath, pageNumber: currentPage });
      } catch (error) {
        console.error("dashboard upload batch error", error);
        toast.error(error instanceof Error ? error.message : "Upload failed.", {
          id: toastId,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [currentPage, currentPath, loadFiles, uploadManagedFile],
  );

  const openFilePreview = useCallback(async (item: DashboardItem) => {
    if (item.type !== "file") {
      return;
    }

    setIsPreviewOpen(true);
    setIsPreviewLoading(true);
    setPreviewError(null);
    setPreviewFile(null);
    setTextPreview(null);

    try {
      const entry = await fetchPreviewEntry(item, { prefetchText: true });
      setPreviewFile(entry.file);
      setTextPreview(entry.textPreview ?? null);
    } catch (error) {
      console.error("file preview error", error);
      setPreviewError(
        error instanceof Error ? error.message : "Could not load file preview.",
      );
    } finally {
      setIsPreviewLoading(false);
    }
  }, [fetchPreviewEntry]);

  const downloadFile = useCallback((fileId: string) => {
    window.open(`/api/files/download?id=${encodeURIComponent(fileId)}`, "_blank", "noopener,noreferrer");
  }, []);

  const requestDeleteItem = useCallback((item: DeleteItem) => {
    setDeleteTarget({ mode: "single", items: [item] });
  }, []);

  const confirmDeleteItem = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }

    const itemsToDelete = deleteTarget.items;
    const itemKey =
      deleteTarget.mode === "single"
        ? `${itemsToDelete[0]?.type ?? "item"}:${itemsToDelete[0]?.id ?? "unknown"}`
        : `bulk:${itemsToDelete.length}`;
    setDeletingItemKey(itemKey);

    try {
      for (const item of itemsToDelete) {
        const response = await fetch("/api/files/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            item.type === "folder"
              ? { type: "folder", fullPath: item.fullPath }
              : { type: "file", id: item.id },
          ),
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(errorData?.error || "Could not delete item");
        }

        if (item.type === "file") {
          previewCacheRef.current.delete(item.id);
          previewRequestRef.current.delete(item.id);

          if (previewFile?.id === item.id) {
            setIsPreviewOpen(false);
            setPreviewFile(null);
            setPreviewError(null);
            setTextPreview(null);
          }
        }
      }

      toast.success(
        deleteTarget.mode === "single"
          ? `${itemsToDelete[0]?.name ?? "Item"} deleted`
          : `Deleted ${itemsToDelete.length} items`,
      );
      clearSelection();
      setDeleteTarget(null);
      await loadFiles({ path: currentPath, pageNumber: currentPage });
    } catch (error) {
      console.error("delete item error", error);
      toast.error(error instanceof Error ? error.message : "Could not delete item.");
    } finally {
      setDeletingItemKey(null);
    }
  }, [clearSelection, currentPage, currentPath, deleteTarget, loadFiles, previewFile]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    await uploadCandidates(
      files.map((file) => ({ file, relativePath: file.name })),
      files.length === 1 ? `Uploading ${files[0]?.name ?? "file"}...` : `Uploading ${files.length} files...`,
    );

    event.target.value = "";
  };

  const onFolderChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as DirectoryUploadFile[];
    if (files.length === 0) return;

    await uploadCandidates(
      files.map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      })),
      `Uploading folder (${files.length} files)...`,
    );

    event.target.value = "";
  };

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  }, [isDragActive]);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragActive(false);

      const dataTransferItems = Array.from(event.dataTransfer.items ?? []) as DataTransferItemWithEntry[];
      let candidates: UploadCandidate[] = [];

      if (dataTransferItems.length > 0 && dataTransferItems.some((item) => item.webkitGetAsEntry)) {
        const nested = await Promise.all(
          dataTransferItems
            .map((item) => item.webkitGetAsEntry?.())
            .filter((entry): entry is FileSystemEntry => entry !== null)
            .map((entry) => readDroppedEntry(entry)),
        );

        candidates = nested.flat();
      } else {
        candidates = Array.from(event.dataTransfer.files ?? []).map((file) => ({
          file,
          relativePath: (file as DirectoryUploadFile).webkitRelativePath || file.name,
        }));
      }

      const uniqueCandidates = candidates.filter(
        (candidate, index, array) =>
          array.findIndex(
            (entry) =>
              entry.relativePath === candidate.relativePath &&
              entry.file.size === candidate.file.size,
          ) === index,
      );

      await uploadCandidates(
        uniqueCandidates,
        uniqueCandidates.length === 1
          ? `Uploading ${uniqueCandidates[0]?.file.name ?? "item"}...`
          : `Uploading ${uniqueCandidates.length} items...`,
      );
    },
    [uploadCandidates],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) {
        return;
      }

      if (event.key === "Escape" && selectedIds.size > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (deleteTarget || isCreateFolderOpen) {
        return;
      }

      if (isPreviewOpen && previewFile) {
        if (event.key.toLowerCase() === "d") {
          event.preventDefault();
          downloadFile(previewFile.id);
          return;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          requestDeleteItem({
            id: previewFile.id,
            type: "file",
            name: previewFile.name,
          });
          return;
        }
      }

      if ((event.key === "Backspace" || event.key === "Delete") && selectedItems.length > 0) {
        event.preventDefault();

        if (selectedItems.length === 1) {
          requestDeleteItem(selectedItems[0]);
        } else {
          setDeleteTarget({ mode: "bulk", items: selectedItems });
        }
        return;
      }

      if (event.key.toLowerCase() === "d" && selectedFileItems.length > 0) {
        event.preventDefault();
        for (const item of selectedFileItems) {
          downloadFile(item.id);
        }
        return;
      }

      if ((event.key.toLowerCase() === "p" || event.key.toLowerCase() === "o") && selectedItems.length === 1) {
        event.preventDefault();
        const [item] = selectedItems;

        if (!item) {
          return;
        }

        if (item.type === "folder") {
          setPage(1);
          void loadFiles({ path: item.fullPath, pageNumber: 1 });
        } else {
          void openFilePreview(item);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clearSelection,
    deleteTarget,
    downloadFile,
    isCreateFolderOpen,
    loadFiles,
    openFilePreview,
    isPreviewOpen,
    previewFile,
    requestDeleteItem,
    selectedFileItems,
    selectedIds,
    selectedItems,
  ]);

  const onCreateFolder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = validateFolderName(folderName);
    if (validationError) {
      setFolderNameError(validationError);
      return;
    }

    setIsCreatingFolder(true);
    setFolderNameError(null);

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: folderName.trim(),
          path: currentPath,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || "Could not create folder");
      }

      toast.success(`Created ${folderName.trim()}`);
      setIsCreateFolderOpen(false);
      setFolderName("");
      await loadFiles({ path: currentPath, pageNumber: 1 });
    } catch (error) {
      console.error("create folder error", error);
      const message = error instanceof Error ? error.message : "Could not create folder.";
      setFolderNameError(message);
      toast.error(message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Toaster position="top-right" />

      <div className="grid min-h-svh lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-background lg:flex lg:flex-col">
          <div className="flex h-16 items-center justify-between border-b border-border px-5">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl border border-border bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
                B
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold tracking-tight">Bucket0</p>
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Storage
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>

          <div className="flex-1 px-3 py-4">
            <div className="space-y-8">
              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-full justify-start rounded-xl border border-border px-3 text-sm font-medium shadow-sm"
                >
                  <HardDrive className="size-4" />
                  My Drive
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <FileText className="size-4" />
                  All Files
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <RefreshCcw className="size-4" />
                  Recent
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  External buckets
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Database className="size-4" />
                  Add Bucket
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <KeyRound className="size-4" />
                  Manage Keys
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Workspace
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Users className="size-4" />
                  Teams
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full justify-start rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <MessageSquareMore className="size-4" />
                  Feedback
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-border px-3 py-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Storage</span>
                <span>{formatBytes(String(totalBytes))} / 5 GB</span>
              </div>
              <div className="mt-2.5 h-2 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${storageProgress}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                {getInitials(userName) || "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="truncate text-xs text-muted-foreground">Authenticated session</p>
              </div>
            </div>
          </div>
        </aside>

        <main
          className="min-w-0 bg-background"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="relative px-4 py-4 sm:px-6 sm:py-6">
            {isDragActive ? (
              <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary/40 bg-background/90 backdrop-blur-sm sm:inset-6">
                <div className="rounded-2xl border border-border bg-card px-6 py-5 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <Upload className="size-5" />
                  </div>
                  <p className="text-base font-medium tracking-tight">Drop files or folders to upload</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We’ll preserve nested folder structure automatically.
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mx-auto max-w-[1440px] space-y-4">
              <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full xl:max-w-[860px] xl:flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(event) => {
                          const nextQuery = event.target.value;
                          setQuery(nextQuery);
                          clearSelection();
                          setPage(1);
                          void loadFiles({
                            path: currentPath,
                            pageNumber: 1,
                            queryValue: nextQuery,
                          });
                        }}
                        placeholder="Search files, folders, and paths..."
                        className="h-11 rounded-xl bg-background pl-10 text-sm shadow-none"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        onChange={onFileChange}
                      />
                      <input
                        ref={directoryInputRef}
                        type="file"
                        className="hidden"
                        multiple
                        onChange={onFolderChange}
                        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                      />

                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-xl px-3 shadow-none"
                        onClick={() =>
                          void loadFiles({
                            path: currentPath,
                            pageNumber: currentPage,
                          })
                        }
                        disabled={isLoading || isUploading || isCreatingFolder}
                      >
                        <RefreshCcw className={cn("size-4", isLoading && "animate-spin")} />
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-xl px-4 shadow-none"
                        onClick={() => setIsCreateFolderOpen(true)}
                        disabled={isUploading || isCreatingFolder}
                      >
                        {isCreatingFolder ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        New folder
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            className="h-10 rounded-xl px-4 shadow-sm hover:bg-primary/90"
                            disabled={isUploading || isCreatingFolder}
                          >
                            {isUploading ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <Upload className="size-4" />
                            )}
                            {isUploading ? "Uploading..." : "Upload"}
                            {!isUploading ? <ChevronDown className="size-4 opacity-70" /> : null}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={onPickFile}>
                            <Upload className="size-4" />
                            Upload files
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={onPickFolder}>
                            <FolderUp className="size-4" />
                            Upload folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <Button
                        asChild
                        type="button"
                        variant="outline"
                        className="h-10 rounded-xl px-3 shadow-none"
                      >
                        <a href="/logout">
                          <LogOut className="size-4" />
                          Log out
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {FILTER_TABS.map((tab) => {
                      const active = filter === tab.value;

                      return (
                        <Button
                          key={tab.value}
                          type="button"
                          variant={active ? "secondary" : "outline"}
                          className={cn(
                            "h-9 rounded-xl px-3.5 text-sm",
                            active
                              ? "border border-border shadow-sm"
                              : "bg-background text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => {
                            setFilter(tab.value);
                            clearSelection();
                            setPage(1);
                            void loadFiles({
                              path: currentPath,
                              pageNumber: 1,
                              filterValue: tab.value,
                            });
                          }}
                        >
                          {tab.label}
                        </Button>
                      );
                    })}
                  </div>

                  {selectedItems.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                        {selectedItems.length} selected
                      </div>
                      {selectedItems.length === 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl shadow-none"
                          onClick={() => {
                            const [item] = selectedItems;
                            if (!item) return;
                            if (item.type === "folder") {
                              clearSelection();
                              setPage(1);
                              void loadFiles({ path: item.fullPath, pageNumber: 1 });
                            } else {
                              void openFilePreview(item);
                            }
                          }}
                        >
                          <Eye className="size-4" />
                          {selectedItems[0]?.type === "folder" ? "Open" : "Preview"}
                        </Button>
                      ) : null}
                      {selectedFileItems.length > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl shadow-none"
                          onClick={() => {
                            for (const item of selectedFileItems) {
                              downloadFile(item.id);
                            }
                          }}
                        >
                          <Download className="size-4" />
                          Download
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget({ mode: "bulk", items: selectedItems })}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-xl"
                        onClick={clearSelection}
                      >
                        Clear
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {totalMatchingItems} items • {folderCount} folders • {formatBytes(String(totalBytes))}
                    </p>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex min-h-12 flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {data?.breadcrumbs?.map((crumb, index) => (
                      <span key={crumb.path || "root"} className="flex items-center gap-2">
                        {index > 0 ? <ChevronRight className="size-3" /> : null}
                        <button
                          type="button"
                          className="rounded-lg px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            clearSelection();
                            setPage(1);
                            void loadFiles({ path: crumb.path, pageNumber: 1 });
                          }}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {totalMatchingItems === 0
                      ? "Showing 0 items"
                      : `Showing ${pageStartIndex + 1}-${pageEndIndex} of ${totalMatchingItems}`}
                  </p>
                </div>

                <div className="grid grid-cols-[28px_minmax(0,1.7fr)_120px_160px_56px] gap-4 border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:px-5">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={areAllPageItemsSelected ? true : areSomePageItemsSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => togglePageSelection(Boolean(checked))}
                      aria-label="Select all items on page"
                    />
                  </div>
                  <div>Name</div>
                  <div>Size</div>
                  <div>Modified</div>
                  <div className="text-right">Actions</div>
                </div>

                {isLoading ? (
                  <div className="flex min-h-64 items-center justify-center px-6 text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading files...
                  </div>
                ) : totalMatchingItems === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
                    <p className="text-base font-medium tracking-tight">No files here yet</p>
                    <p className="text-sm text-muted-foreground">
                      Upload a file to see it appear in this folder.
                    </p>
                  </div>
                ) : (
                  <div>
                    {paginatedItems.map((item) => {
                      const rowAction = () => {
                        if (item.type === "folder") {
                          clearSelection();
                          setPage(1);
                          void loadFiles({ path: item.fullPath, pageNumber: 1 });
                          return;
                        }

                        void openFilePreview(item);
                      };

                      const isDeleting = deletingItemKey === `${item.type}:${item.id}`;

                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            "grid w-full grid-cols-[28px_minmax(0,1.7fr)_120px_160px_56px] gap-4 border-b border-border px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-accent/60 sm:px-5",
                            selectedIds.has(item.id) && "bg-accent/40",
                          )}
                          onClick={rowAction}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              rowAction();
                            }
                          }}
                        >
                          <div
                            className="flex items-center justify-center"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={(checked) =>
                                toggleItemSelection(item.id, Boolean(checked))
                              }
                              aria-label={`Select ${item.name}`}
                            />
                          </div>

                          <div className="flex min-w-0 items-center gap-3.5">
                            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground">
                              {getItemIcon(item)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium tracking-tight">
                                {item.name}
                              </p>
                              <p className="truncate text-sm text-muted-foreground">
                                {getItemSubtitle(item)}
                              </p>
                            </div>
                          </div>

                          <div className="self-center text-sm text-muted-foreground">
                            {item.type === "folder" ? "—" : formatBytes(item.size)}
                          </div>

                          <div className="self-center text-sm text-muted-foreground">
                            {formatUpdatedAt(item.updatedAt)}
                          </div>

                          <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="rounded-xl"
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    <MoreHorizontal className="size-4" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                {item.type === "file" ? (
                                  <>
                                    <DropdownMenuItem onSelect={() => void openFilePreview(item)}>
                                      <Eye className="size-4" />
                                      Preview
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => downloadFile(item.id)}>
                                      <Download className="size-4" />
                                      Download
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => requestDeleteItem(item)}
                                    >
                                      <Trash2 className="size-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onSelect={() => {
                                      clearSelection();
                                      setPage(1);
                                      void loadFiles({ path: item.fullPath, pageNumber: 1 });
                                    }}>
                                      <FolderClosed className="size-4" />
                                      Open
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => requestDeleteItem(item)}
                                    >
                                      <Trash2 className="size-4" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {totalMatchingItems > 0 ? (
                  <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <p className="text-sm text-muted-foreground">
                      Showing {pageStartIndex + 1}-{pageEndIndex} of {totalMatchingItems}
                    </p>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl shadow-none"
                        onClick={() => {
                          const nextPage = currentPage - 1;
                          setPage(nextPage);
                          void loadFiles({ path: currentPath, pageNumber: nextPage });
                        }}
                        disabled={currentPage <= 1}
                      >
                        <ChevronLeft className="size-4" />
                        Previous
                      </Button>
                      <div className="min-w-20 rounded-xl border border-border bg-background px-3 py-2 text-center text-sm text-muted-foreground">
                        {currentPage} / {totalPages}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl shadow-none"
                        onClick={() => {
                          const nextPage = currentPage + 1;
                          setPage(nextPage);
                          void loadFiles({ path: currentPath, pageNumber: nextPage });
                        }}
                        disabled={currentPage >= totalPages}
                      >
                        Next
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </main>
      </div>

      <Dialog
        open={isCreateFolderOpen}
        onOpenChange={(open) => {
          setIsCreateFolderOpen(open);

          if (!open) {
            setFolderName("");
            setFolderNameError(null);
            setIsCreatingFolder(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription>
              Add a new folder in {currentPath || "My Drive"}.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4 px-6 pb-6" onSubmit={onCreateFolder}>
            <div className="space-y-2">
              <label htmlFor="folder-name" className="text-sm font-medium">
                Folder name
              </label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(event) => {
                  setFolderName(event.target.value);
                  if (folderNameError) {
                    setFolderNameError(null);
                  }
                }}
                placeholder="e.g. Invoices"
                autoFocus
                disabled={isCreatingFolder}
              />
              {folderNameError ? (
                <p className="text-sm text-destructive">{folderNameError}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsCreateFolderOpen(false)}
                disabled={isCreatingFolder}
              >
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl" disabled={isCreatingFolder}>
                {isCreatingFolder ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {isCreatingFolder ? "Creating..." : "Create folder"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingItemKey) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{getDeleteDialogCopy(deleteTarget).title}</DialogTitle>
            <DialogDescription>{getDeleteDialogCopy(deleteTarget).description}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 px-6 pb-6">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setDeleteTarget(null)}
              disabled={Boolean(deletingItemKey)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void confirmDeleteItem()}
              disabled={Boolean(deletingItemKey)}
            >
              {deletingItemKey ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isPreviewOpen}
        onOpenChange={(open) => {
          setIsPreviewOpen(open);

          if (!open) {
            setPreviewFile(null);
            setPreviewError(null);
            setTextPreview(null);
            setIsPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-6xl p-0" showCloseButton={false}>
          <DialogHeader className="border-b border-border p-6 pr-24">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-2xl font-semibold tracking-tight">
                    {previewFile?.name ?? "Loading preview..."}
                  </DialogTitle>
                  {previewFile?.mimeType ? (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {(previewFile.mimeType.split("/").pop() || "file").toUpperCase()}
                    </span>
                  ) : null}
                </div>
                <DialogDescription>
                  {previewFile
                    ? `${formatBytes(previewFile.size)} • Updated ${formatUpdatedAt(previewFile.updatedAt)}`
                    : "Preparing secure preview"}
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2">
                {previewFile ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl shadow-none"
                      onClick={() => downloadFile(previewFile.id)}
                    >
                      <Download className="size-4" />
                      Download
                    </Button>
                    <Button asChild variant="outline" className="rounded-xl shadow-none">
                      <a href={previewFile.previewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                        Open
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        requestDeleteItem({
                          id: previewFile.id,
                          type: "file",
                          name: previewFile.name,
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </DialogHeader>

          <div className="bg-muted/35 p-4 sm:p-6">
            <div className="overflow-hidden rounded-2xl border border-border bg-background">
              <div className="flex min-h-[70vh] items-center justify-center p-4 sm:p-6">
                {isPreviewLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Loading preview...
                  </div>
                ) : previewError ? (
                  <div className="max-w-md space-y-3 text-center">
                    <p className="text-lg font-medium tracking-tight">Preview unavailable</p>
                    <p className="text-sm text-muted-foreground">{previewError}</p>
                  </div>
                ) : previewFile && previewKind === "image" ? (
                  <img
                    src={previewFile.previewUrl}
                    alt={previewFile.name}
                    className="max-h-[68vh] max-w-full rounded-xl object-contain"
                  />
                ) : previewFile && previewKind === "video" ? (
                  <video
                    src={previewFile.previewUrl}
                    controls
                    className="max-h-[68vh] w-full rounded-xl bg-black"
                  />
                ) : previewFile && previewKind === "audio" ? (
                  <div className="flex w-full max-w-2xl flex-col items-center gap-6 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                      <Music4 className="size-8" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-medium tracking-tight">{previewFile.name}</p>
                      <p className="text-sm text-muted-foreground">Audio preview</p>
                    </div>
                    <audio src={previewFile.previewUrl} controls className="w-full" />
                  </div>
                ) : previewFile && previewKind === "pdf" ? (
                  <iframe
                    src={previewFile.previewUrl}
                    title={previewFile.name}
                    className="h-[68vh] w-full rounded-xl bg-white"
                  />
                ) : previewFile && previewKind === "text" ? (
                  textPreview !== null ? (
                    <div className="h-[68vh] w-full overflow-auto rounded-xl border border-border bg-muted/30 p-4 text-left">
                      <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        <code>{textPreview}</code>
                      </pre>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" /> Loading text preview...
                    </div>
                  )
                ) : previewFile ? (
                  <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                      {previewKind === "image" ? (
                        <ImageIcon className="size-8" />
                      ) : previewKind === "video" ? (
                        <Video className="size-8" />
                      ) : previewKind === "audio" ? (
                        <Music4 className="size-8" />
                      ) : previewKind === "text" ? (
                        <FileCode2 className="size-8" />
                      ) : previewKind === "pdf" ? (
                        <FileText className="size-8" />
                      ) : (
                        <File className="size-8" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-medium tracking-tight">No inline preview</p>
                      <p className="text-sm text-muted-foreground">
                        This file type can’t be rendered inline yet, but you can open or download it.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ImageIcon className="size-4" /> Waiting for preview...
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
