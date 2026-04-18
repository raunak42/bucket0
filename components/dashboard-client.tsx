"use client";

/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
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
import { Progress } from "@/components/ui/progress";
import { authClient } from "@/utils/auth-client";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Database,
  Download,
  File,
  FileCode2,
  FileText,
  FileUp,
  FolderClosed,
  FolderUp,
  Grid2x2,
  HardDrive,
  ExternalLink,
  Eye,
  ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  Music4,
  PanelLeft,
  Plus,
  RefreshCcw,
  Rows3,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

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

type DashboardConnection = {
  id: string;
  name: string;
  type: "managed" | "external";
  provider: "internal" | "s3" | "r2" | "wasabi";
  bucketName: string;
  region: string | null;
  endpoint: string | null;
  rootPrefix: string;
  isDefault: boolean;
  reconnectRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

type FilesResponse = {
  ok: boolean;
  connection: DashboardConnection;
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

type ConnectionsResponse = {
  ok: boolean;
  connections: DashboardConnection[];
};

type InitUploadResponse =
  | {
      ok: true;
      mode: "simple";
      transport: "direct" | "proxy";
      uploadId: string;
      key: string;
      bucketName: string;
      uploadUrl?: string;
      fileName?: string;
    }
  | {
      ok: true;
      mode: "multipart";
      transport: "direct" | "proxy";
      uploadId: string;
      key: string;
      bucketName: string;
      partSize: number;
      fileName?: string;
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

type DeleteItem = DashboardItem | { id: string; type: "file"; name: string; key?: string };

type DeleteTarget =
  | { mode: "single"; items: [DeleteItem] }
  | { mode: "bulk"; items: DashboardItem[] };

type UploadCandidate = {
  file: File;
  relativePath: string;
};

type UploadPanelItemStatus = "queued" | "uploading" | "success" | "error" | "canceled";

type UploadPanelItem = {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadPanelItemStatus;
  message?: string;
};

type UploadPanelState = {
  title: string;
  items: UploadPanelItem[];
  isActive: boolean;
  isCancelling: boolean;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

type ConnectionProvider = "s3" | "r2" | "wasabi";

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
const DEFAULT_SORT: "name_asc" | "name_desc" | "updated_desc" | "updated_asc" | "size_desc" | "size_asc" = "name_asc";
const CLIENT_SIMPLE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PARALLEL_SIMPLE_UPLOADS = 20;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "bucket0-sidebar-collapsed";

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, value));
}

function createAbortError(message = "Operation canceled") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isUploadItemFinished(status: UploadPanelItemStatus) {
  return status === "success" || status === "error" || status === "canceled";
}

function getUploadItemProgress(item: UploadPanelItem) {
  if (item.size <= 0) {
    return item.status === "success" ? 100 : 0;
  }

  return clampProgress((item.loaded / item.size) * 100);
}

function getUploadItemStatusCopy(item: UploadPanelItem) {
  switch (item.status) {
    case "queued":
      return {
        label: "Queued",
        meta: formatBytes(String(item.size)),
        icon: <FileUp className="size-4" />,
        iconClassName: "text-muted-foreground",
      };
    case "uploading":
      return {
        label: "Uploading",
        meta: `${formatBytes(String(item.loaded))} of ${formatBytes(String(item.size))}`,
        icon: <LoaderCircle className="size-4 animate-spin" />,
        iconClassName: "text-foreground",
      };
    case "success":
      return {
        label: "Complete",
        meta: `${formatBytes(String(item.size))} uploaded`,
        icon: <CheckCircle2 className="size-4" />,
        iconClassName: "text-foreground",
      };
    case "error":
      return {
        label: "Failed",
        meta: item.message || "Upload failed",
        icon: <AlertCircle className="size-4" />,
        iconClassName: "text-destructive",
      };
    case "canceled":
    default:
      return {
        label: "Canceled",
        meta: item.message || "Upload stopped",
        icon: <CircleSlash className="size-4" />,
        iconClassName: "text-muted-foreground",
      };
  }
}

function UploadQueuePanel({
  state,
  onCancelAll,
  onClose,
}: {
  state: UploadPanelState;
  onCancelAll: () => void;
  onClose: () => void;
}) {
  const finishedCount = state.items.filter((item) => isUploadItemFinished(item.status)).length;
  const successCount = state.items.filter((item) => item.status === "success").length;
  const errorCount = state.items.filter((item) => item.status === "error").length;
  const canceledCount = state.items.filter((item) => item.status === "canceled").length;
  const totalBytes = state.items.reduce((sum, item) => sum + item.size, 0);
  const loadedBytes = state.items.reduce(
    (sum, item) => sum + Math.min(item.loaded, item.size),
    0,
  );
  const overallProgress = totalBytes > 0
    ? clampProgress((loadedBytes / totalBytes) * 100)
    : state.items.length > 0
      ? clampProgress((finishedCount / state.items.length) * 100)
      : 0;
  const heading = state.isActive
    ? `Uploading ${finishedCount}/${state.items.length} ${state.items.length === 1 ? "item" : "items"}`
    : errorCount > 0 || canceledCount > 0
      ? `Finished ${finishedCount}/${state.items.length} ${state.items.length === 1 ? "item" : "items"}`
      : `Uploaded ${successCount} ${successCount === 1 ? "item" : "items"}`;
  const subheading = state.isActive
    ? state.isCancelling
      ? "Stopping active uploads..."
      : state.title
    : errorCount > 0
      ? `${errorCount} failed${canceledCount > 0 ? ` • ${canceledCount} canceled` : ""}`
      : canceledCount > 0
        ? `${canceledCount} canceled`
        : "Upload complete";

  return (
    <div className="fixed inset-x-2 bottom-2 z-40 w-auto overflow-hidden rounded-2xl border border-border bg-background shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(420px,calc(100vw-1rem))]">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium tracking-tight text-foreground">{heading}</p>
            <p className="truncate text-xs text-muted-foreground">{subheading}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {state.isActive ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onCancelAll}
                disabled={state.isCancelling}
              >
                {state.isCancelling ? "Stopping..." : "Cancel all"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close upload queue"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          <Progress value={overallProgress} />
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>
              {formatBytes(String(Math.min(loadedBytes, totalBytes)))} of {formatBytes(String(totalBytes))}
            </span>
            <span>{Math.round(overallProgress)}%</span>
          </div>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {state.items.map((item) => {
          const statusCopy = getUploadItemStatusCopy(item);

          return (
            <div key={item.id} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 shrink-0", statusCopy.iconClassName)}>{statusCopy.icon}</div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{statusCopy.meta}</span>
                      <span className="shrink-0">{statusCopy.label}</span>
                    </div>
                  </div>
                  <Progress value={getUploadItemProgress(item)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SUCCESS_TOAST_DURATION_MS = 2500;
const INFO_TOAST_DURATION_MS = 2500;
const ERROR_TOAST_DURATION_MS = 4000;
const SIMPLE_UPLOAD_RETRY_COUNT = 2;
const CONNECTIONS_LOAD_TOAST_ID = "connections-load-toast";
const FILES_LOAD_TOAST_ID = "files-load-toast";
const DOWNLOAD_TOAST_ID = "download-toast";
const DELETE_TOAST_ID = "delete-toast";
const CREATE_FOLDER_TOAST_ID = "create-folder-toast";
const CREATE_CONNECTION_TOAST_ID = "create-connection-toast";
const UPLOAD_RESULT_TOAST_ID = "upload-result-toast";
const DELETE_ACCOUNT_TOAST_ID = "delete-account-toast";

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

function getConnectionLabel(connection: DashboardConnection) {
  if (connection.type === "managed") {
    return "My Drive";
  }

  if (connection.provider === "r2") {
    return "Cloudflare R2";
  }

  if (connection.provider === "wasabi") {
    return "Wasabi";
  }

  return "Amazon S3";
}

function getConnectionDescription(provider: ConnectionProvider) {
  if (provider === "r2") {
    return "Use your R2 bucket name, access keys, and account endpoint like https://<account-id>.r2.cloudflarestorage.com.";
  }

  if (provider === "wasabi") {
    return "Wasabi needs a region. The endpoint can be left blank and we’ll use the standard Wasabi S3 endpoint.";
  }

  return "Use standard AWS S3 bucket credentials. Endpoint is optional unless you use a custom S3-compatible endpoint.";
}

function getProviderName(provider: ConnectionProvider) {
  if (provider === "r2") {
    return "R2";
  }

  if (provider === "wasabi") {
    return "Wasabi";
  }

  return "S3";
}

function Bucket0BrandMark({
  className,
}: {
  className?: string;
}) {
  return (
    <img
      src="/empty-bucket-svgrepo-com.svg"
      alt=""
      aria-hidden="true"
      className={cn("size-9 shrink-0 select-none object-contain dark:invert", className)}
      draggable={false}
    />
  );
}

function ProviderLogo({
  provider,
  className,
  active = false,
}: {
  provider: ConnectionProvider;
  className?: string;
  active?: boolean;
}) {
  if (provider === "s3") {
    return (
      <svg viewBox="0 0 304 182" aria-hidden="true" className={cn("h-4 w-auto shrink-0", className)}>
        <path
          fill={active ? "#FFFFFF" : "#252F3E"}
          d="M86.4 66.4c0 3.7.4 6.7 1.1 8.9.8 2.2 1.8 4.6 3.2 7.2.5.8.7 1.6.7 2.3 0 1-.6 2-1.9 3l-6.3 4.2c-.9.6-1.8.9-2.6.9-1 0-2-.5-3-1.4-1.4-1.5-2.6-3.1-3.6-4.7-1-1.7-2-3.6-3.1-5.9-7.8 9.2-17.6 13.8-29.4 13.8-8.4 0-15.1-2.4-20-7.2-4.9-4.8-7.4-11.2-7.4-19.2 0-8.5 3-15.4 9.1-20.6 6.1-5.2 14.2-7.8 24.5-7.8 3.4 0 6.9.3 10.6.8 3.7.5 7.5 1.3 11.5 2.2v-7.3c0-7.6-1.6-12.9-4.7-16-3.2-3.1-8.6-4.6-16.3-4.6-3.5 0-7.1.4-10.8 1.3-3.7.9-7.3 2-10.8 3.4-1.6.7-2.8 1.1-3.5 1.3-.7.2-1.2.3-1.6.3-1.4 0-2.1-1-2.1-3.1v-4.9c0-1.6.2-2.8.7-3.5.5-.7 1.4-1.4 2.8-2.1 3.5-1.8 7.7-3.3 12.6-4.5 4.9-1.3 10.1-1.9 15.6-1.9 11.9 0 20.6 2.7 26.2 8.1 5.5 5.4 8.3 13.6 8.3 24.6V66.4zM45.8 81.6c3.3 0 6.7-.6 10.3-1.8 3.6-1.2 6.8-3.4 9.5-6.4 1.6-1.9 2.8-4 3.4-6.4.6-2.4 1-5.3 1-8.7v-4.2c-2.9-.7-6-1.3-9.2-1.7-3.2-.4-6.3-.6-9.4-.6-6.7 0-11.6 1.3-14.9 4-3.3 2.7-4.9 6.5-4.9 11.5 0 4.7 1.2 8.2 3.7 10.6 2.4 2.5 5.9 3.7 10.5 3.7zm80.3 10.8c-1.8 0-3-.3-3.8-1-.8-.6-1.5-2-2.1-3.9L96.7 10.2c-.6-2-.9-3.3-.9-4 0-1.6.8-2.5 2.4-2.5h9.8c1.9 0 3.2.3 3.9 1 .8.6 1.4 2 2 3.9l16.8 66.2 15.6-66.2c.5-2 1.1-3.3 1.9-3.9.8-.6 2.2-1 4-1h8c1.9 0 3.2.3 4 1 .8.6 1.5 2 1.9 3.9l15.8 67 17.3-67c.6-2 1.3-3.3 2-3.9.8-.6 2.1-1 3.9-1h9.3c1.6 0 2.5.8 2.5 2.5 0 .5-.1 1-.2 1.6-.1.6-.3 1.4-.7 2.5l-24.1 77.3c-.6 2-1.3 3.3-2.1 3.9-.8.6-2.1 1-3.8 1h-8.6c-1.9 0-3.2-.3-4-1-.8-.7-1.5-2-1.9-4L156 23l-15.4 64.4c-.5 2-1.1 3.3-1.9 4-.8.7-2.2 1-4 1h-8.6zm128.5 2.7c-5.2 0-10.4-.6-15.4-1.8-5-1.2-8.9-2.5-11.5-4-1.6-.9-2.7-1.9-3.1-2.8-.4-.9-.6-1.9-.6-2.8v-5.1c0-2.1.8-3.1 2.3-3.1.6 0 1.2.1 1.8.3.6.2 1.5.6 2.5 1 3.4 1.5 7.1 2.7 11 3.5 4 .8 7.9 1.2 11.9 1.2 6.3 0 11.2-1.1 14.6-3.3 3.4-2.2 5.2-5.4 5.2-9.5 0-2.8-.9-5.1-2.7-7-1.8-1.9-5.2-3.6-10.1-5.2L246 52c-7.3-2.3-12.7-5.7-16-10.2-3.3-4.4-5-9.3-5-14.5 0-4.2.9-7.9 2.7-11.1 1.8-3.2 4.2-6 7.2-8.2 3-2.3 6.4-4 10.4-5.2 4-1.2 8.2-1.7 12.6-1.7 2.2 0 4.5.1 6.7.4 2.3.3 4.4.7 6.5 1.1 2 .5 3.9 1 5.7 1.6 1.8.6 3.2 1.2 4.2 1.8 1.4.8 2.4 1.6 3 2.5.6.8.9 1.9.9 3.3v4.7c0 2.1-.8 3.2-2.3 3.2-.8 0-2.1-.4-3.8-1.2-5.7-2.6-12.1-3.9-19.2-3.9-5.7 0-10.2.9-13.3 2.8-3.1 1.9-4.7 4.8-4.7 8.9 0 2.8 1 5.2 3 7.1 2 1.9 5.7 3.8 11 5.5l14.2 4.5c7.2 2.3 12.4 5.5 15.5 9.6 3.1 4.1 4.6 8.8 4.6 14 0 4.3-.9 8.2-2.6 11.6-1.8 3.4-4.2 6.4-7.3 8.8-3.1 2.5-6.8 4.3-11.1 5.6-4.2 1.1-8.9 1.8-14 1.8z"
        />
        <path
          fill="#FF9900"
          d="M273.5 143.7c-32.9 24.3-80.7 37.2-121.8 37.2-57.6 0-109.5-21.3-148.7-56.7-3.1-2.8-.3-6.6 3.4-4.4 42.4 24.6 94.7 39.5 148.8 39.5 36.5 0 76.6-7.6 113.5-23.2 5.5-2.5 10.2 3.6 4.8 7.6z"
          fillRule="evenodd"
          clipRule="evenodd"
        />
        <path
          fill="#FF9900"
          d="M287.2 128.1c-4.2-5.4-27.8-2.6-38.5-1.3-3.2.4-3.7-2.4-.8-4.5 18.8-13.2 49.7-9.4 53.3-5 3.6 4.5-1 35.4-18.6 50.2-2.7 2.3-5.3 1.1-4.1-1.9 4-9.9 12.9-32.2 8.7-37.5z"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (provider === "r2") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5 shrink-0", className)}>
        <path
          fill="#F38020"
          d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5 shrink-0", className)}>
      <path
        fill="#17D24F"
        d="M20.483 3.517A11.91 11.91 0 0 0 12 0a11.91 11.91 0 0 0-8.483 3.517A11.91 11.91 0 0 0 0 12a11.91 11.91 0 0 0 3.517 8.483A11.91 11.91 0 0 0 12 24a11.91 11.91 0 0 0 8.483-3.517A11.91 11.91 0 0 0 24 12a11.91 11.91 0 0 0-3.517-8.483Zm1.29 7.387-5.16-4.683-5.285 4.984-2.774 2.615V9.932l4.206-3.994 3.146-2.969c3.163 1.379 5.478 4.365 5.867 7.935zm-.088 2.828a10.632 10.632 0 0 1-1.025 2.951l-2.952-2.668v-3.87Zm-8.183-11.47-2.227 2.103-2.739 2.598v-4.17A9.798 9.798 0 0 1 12 2.155c.513 0 1.007.035 1.502.106zM6.398 13.891l-4.083-3.658a9.744 9.744 0 0 1 1.078-2.987L6.398 9.95zm0-9.968v3.129l-1.75-1.573a8.623 8.623 0 0 1 1.75-1.556Zm-4.189 9.102 5.284 4.736 5.302-4.983 2.74-2.598v3.817l-7.423 7.016a9.823 9.823 0 0 1-5.903-7.988Zm8.306 8.695 5.02-4.754v4.206a9.833 9.833 0 0 1-3.553.654c-.495 0-.99-.035-1.467-.106zm7.176-1.714v-3.11l1.714 1.555a9.604 9.604 0 0 1-1.714 1.555z"
      />
    </svg>
  );
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

function ItemVisualPreview({
  item,
  previewFile,
  variant,
}: {
  item: DashboardItem;
  previewFile: PreviewFile | null;
  variant: "list" | "grid";
}) {
  const previewKind = previewFile ? getPreviewKind(previewFile) : null;

  if (previewKind === "image" && previewFile) {
    return (
      <img
        src={previewFile.previewUrl}
        alt=""
        className="pointer-events-none size-full select-none object-cover"
        draggable={false}
        loading="lazy"
      />
    );
  }

  if (previewKind === "video" && previewFile) {
    return (
      <video
        src={previewFile.previewUrl}
        muted
        playsInline
        preload="metadata"
        className="pointer-events-none size-full object-cover"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={cn(
        "flex size-full items-center justify-center text-muted-foreground",
        variant === "grid" && "text-muted-foreground",
      )}
    >
      {getItemIcon(item)}
    </div>
  );
}

async function abortUploadSession(uploadId: string) {
  await fetch("/api/uploads/abort", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uploadId }),
    keepalive: true,
  });
}

async function uploadBlobWithProgress({
  url,
  file,
  contentType,
  onProgress,
  signal,
  method = "PUT",
  expectJson = false,
}: {
  url: string;
  file: Blob;
  contentType?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  method?: "PUT" | "POST";
  expectJson?: boolean;
}) {
  return new Promise<{ etag: string | null; data: Record<string, unknown> | null }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const request = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      request.abort();
    };

    request.open(method, url);

    if (contentType) {
      request.setRequestHeader("Content-Type", contentType);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };

    request.onload = () => {
      finish(() => {
        if (request.status >= 200 && request.status < 300) {
          onProgress?.(file.size, file.size);

          let data: Record<string, unknown> | null = null;
          if (expectJson && request.responseText) {
            try {
              data = JSON.parse(request.responseText) as Record<string, unknown>;
            } catch {
              data = null;
            }
          }

          resolve({
            etag:
              (typeof data?.etag === "string" ? data.etag : null) ??
              request.getResponseHeader("etag") ??
              request.getResponseHeader("ETag"),
            data,
          });
          return;
        }

        let errorMessage = "Upload request failed";

        if (request.responseText) {
          try {
            const parsed = JSON.parse(request.responseText) as { error?: string };
            if (parsed?.error) {
              errorMessage = parsed.error;
            }
          } catch {
            if (request.responseText.trim()) {
              errorMessage = request.responseText.trim();
            }
          }
        }

        reject(new Error(errorMessage));
      });
    };

    request.onerror = () => finish(() => reject(new Error("Upload request failed")));
    request.onabort = () => finish(() => reject(createAbortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    request.send(file);
  });
}

async function uploadSimpleFile(
  file: File,
  initData: Extract<InitUploadResponse, { mode: "simple" }>,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= SIMPLE_UPLOAD_RETRY_COUNT; attempt += 1) {
    try {
      await uploadBlobWithProgress({
        url:
          initData.transport === "direct"
            ? initData.uploadUrl ?? ""
            : `/api/uploads/proxy-simple?${new URLSearchParams({ uploadId: initData.uploadId }).toString()}`,
        file,
        contentType: file.type || "application/octet-stream",
        onProgress,
        signal,
        method: initData.transport === "direct" ? "PUT" : "POST",
        expectJson: initData.transport === "proxy",
      });
      lastError = null;
      break;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      lastError = error;
      if (attempt === SIMPLE_UPLOAD_RETRY_COUNT) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  if (lastError) {
    throw lastError;
  }

  const completeResponse = await fetch("/api/uploads/complete-simple", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uploadId: initData.uploadId }),
    signal,
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
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) {
  const parts: Array<{ etag: string; partNumber: number }> = [];
  let uploadedBytes = 0;

  for (
    let partNumber = 1, start = 0;
    start < file.size;
    partNumber += 1, start += initData.partSize
  ) {
    const end = Math.min(start + initData.partSize, file.size);
    const chunk = file.slice(start, end);

    let uploadResult: { etag: string | null; data: Record<string, unknown> | null };

    if (initData.transport === "direct") {
      const partUrlResponse = await fetch("/api/uploads/part-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploadId: initData.uploadId,
          partNumber,
        }),
        signal,
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

      uploadResult = await uploadBlobWithProgress({
        url: partData.uploadUrl,
        file: chunk,
        onProgress: (loaded) => {
          onProgress?.(uploadedBytes + loaded, file.size);
        },
        signal,
      });
    } else {
      uploadResult = await uploadBlobWithProgress({
        url: `/api/uploads/proxy-part?${new URLSearchParams({
          uploadId: initData.uploadId,
          partNumber: String(partNumber),
        }).toString()}`,
        method: "POST",
        expectJson: true,
        file: chunk,
        contentType: "application/octet-stream",
        onProgress: (loaded) => {
          onProgress?.(uploadedBytes + loaded, file.size);
        },
        signal,
      });
    }

    if (!uploadResult.etag) {
      throw new Error(`Missing ETag for part ${partNumber}`);
    }

    uploadedBytes += chunk.size;
    onProgress?.(uploadedBytes, file.size);
    parts.push({ etag: uploadResult.etag, partNumber });
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
    signal,
  });

  if (!completeResponse.ok) {
    const errorData = (await completeResponse.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(errorData?.error || "Could not complete multipart upload");
  }

  onProgress?.(file.size, file.size);
}

export function DashboardClient({
  userName,
  userEmail,
  userImage,
}: {
  userName: string;
  userEmail: string;
  userImage: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<FilesResponse | null>(null);
  const [connections, setConnections] = useState<DashboardConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isConnectionsLoading, setIsConnectionsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isAddBucketOpen, setIsAddBucketOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [connectionProgress, setConnectionProgress] = useState<{
    value: number;
    label: string;
    indeterminate?: boolean;
  } | null>(null);
  const [connectionForm, setConnectionForm] = useState({
    name: "",
    provider: "s3" as ConnectionProvider,
    bucketName: "",
    region: "",
    endpoint: "",
    rootPrefix: "",
    accessKeyId: "",
    secretAccessKey: "",
  });
  const [folderName, setFolderName] = useState("");
  const [folderNameError, setFolderNameError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [deletingItemKey, setDeletingItemKey] = useState<string | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<{
    completed: number;
    total: number;
    label: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [visualPreviewFiles, setVisualPreviewFiles] = useState<Record<string, PreviewFile>>({});
  const [uploadPanel, setUploadPanel] = useState<UploadPanelState | null>(null);
  const [isUploadPanelVisible, setIsUploadPanelVisible] = useState(false);
  const previewCacheRef = useRef<Map<string, PreviewCacheEntry>>(new Map());
  const previewRequestRef = useRef<Map<string, Promise<PreviewCacheEntry>>>(new Map());
  const dragDepthRef = useRef(0);
  const didInitialLoadRef = useRef(false);
  const didHydrateSidebarPreferenceRef = useRef(false);
  const activeUploadControllerRef = useRef<AbortController | null>(null);
  const activeUploadCanceledByUserRef = useRef(false);
  const loadConnectionsControllerRef = useRef<AbortController | null>(null);
  const loadFilesControllerRef = useRef<AbortController | null>(null);
  const loadFilesRequestIdRef = useRef(0);
  const activeConnectionRequestControllerRef = useRef<AbortController | null>(null);
  const [isStoppingConnection, setIsStoppingConnection] = useState(false);

  useEffect(() => {
    return () => {
      activeConnectionRequestControllerRef.current?.abort();
      activeConnectionRequestControllerRef.current = null;

      loadConnectionsControllerRef.current?.abort();
      loadConnectionsControllerRef.current = null;

      loadFilesControllerRef.current?.abort();
      loadFilesControllerRef.current = null;

      activeUploadControllerRef.current?.abort();
      activeUploadControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      setIsSidebarCollapsed(
        window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1",
      );
    } catch {
      // Ignore storage read errors.
    } finally {
      didHydrateSidebarPreferenceRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!didHydrateSidebarPreferenceRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        isSidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage write errors.
    }
  }, [isSidebarCollapsed]);

  const getConnectionById = useCallback(
    (connectionId?: string | null) =>
      connectionId ? connections.find((connection) => connection.id === connectionId) ?? null : null,
    [connections],
  );

  const loadConnections = useCallback(async () => {
    loadConnectionsControllerRef.current?.abort();

    const controller = new AbortController();
    loadConnectionsControllerRef.current = controller;
    toast.dismiss(CONNECTIONS_LOAD_TOAST_ID);
    setIsConnectionsLoading(true);

    try {
      const response = await fetch("/api/connections", {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || "Could not load connections");
      }

      const result = (await response.json()) as ConnectionsResponse;
      if (loadConnectionsControllerRef.current !== controller) {
        return;
      }

      toast.dismiss(CONNECTIONS_LOAD_TOAST_ID);
      setConnections(result.connections);
      setSelectedConnectionId((current) => current ?? result.connections[0]?.id ?? null);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error("connections load error", error);
      toast.error(
        error instanceof Error ? error.message : "Could not load connections.",
        { id: CONNECTIONS_LOAD_TOAST_ID, duration: ERROR_TOAST_DURATION_MS },
      );
    } finally {
      if (loadConnectionsControllerRef.current === controller) {
        loadConnectionsControllerRef.current = null;
        setIsConnectionsLoading(false);
      }
    }
  }, []);

  const loadFiles = useCallback(async ({
    path,
    pageNumber,
    queryValue,
    filterValue,
    sortValue = DEFAULT_SORT,
    connectionId,
  }: {
    path: string;
    pageNumber: number;
    queryValue: string;
    filterValue: FilterTab;
    sortValue?: "name_asc" | "name_desc" | "updated_desc" | "updated_asc" | "size_desc" | "size_asc";
    connectionId?: string | null;
  }) => {
    loadFilesControllerRef.current?.abort();

    const controller = new AbortController();
    loadFilesControllerRef.current = controller;
    const requestId = loadFilesRequestIdRef.current + 1;
    loadFilesRequestIdRef.current = requestId;
    toast.dismiss(FILES_LOAD_TOAST_ID);
    setIsLoading(true);

    try {
      const activeConnectionId = connectionId ?? selectedConnectionId;
      const targetConnection = getConnectionById(activeConnectionId);

      if (targetConnection?.type === "external" && targetConnection.reconnectRequired) {
        throw new Error("Reconnect this bucket to switch it back to the server-backed flow.");
      }

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

      if (activeConnectionId) {
        searchParams.set("connectionId", activeConnectionId);
      }

      const response = await fetch(`/api/files?${searchParams.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || "Could not load files");
      }

      const nextData = (await response.json()) as FilesResponse;
      if (loadFilesControllerRef.current !== controller || loadFilesRequestIdRef.current !== requestId) {
        return;
      }

      toast.dismiss(FILES_LOAD_TOAST_ID);
      setData(nextData);
      setSelectedConnectionId(nextData.connection.id);
      setCurrentPath(nextData.path);
      setPage(nextData.pagination.page);
      setSelectedIds(new Set());
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error("dashboard load error", error);
      toast.error(
        error instanceof Error ? error.message : "Could not load files.",
        { id: FILES_LOAD_TOAST_ID, duration: ERROR_TOAST_DURATION_MS },
      );
    } finally {
      if (loadFilesControllerRef.current === controller) {
        loadFilesControllerRef.current = null;
      }

      if (loadFilesRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [getConnectionById, selectedConnectionId]);

  const previewKind = previewFile ? getPreviewKind(previewFile) : null;

  useEffect(() => {
    if (didInitialLoadRef.current) {
      return;
    }

    didInitialLoadRef.current = true;

    const timer = window.setTimeout(() => {
      void loadConnections();
      void loadFiles({
        path: "",
        pageNumber: 1,
        queryValue: "",
        filterValue: "all",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadConnections, loadFiles]);

  const activeConnection = useMemo(() => {
    if (selectedConnectionId) {
      return connections.find((connection) => connection.id === selectedConnectionId)
        ?? data?.connection
        ?? null;
    }

    return data?.connection ?? null;
  }, [connections, data, selectedConnectionId]);

  const highlightedConnectionId = selectedConnectionId ?? activeConnection?.id ?? null;

  const items = useMemo(() => data?.items ?? [], [data]);
  const totalMatchingItems = data?.pagination.totalItems ?? 0;
  const isFilteredEmptyState = query.trim().length > 0 || filter !== "all";
  const currentPage = data?.pagination.page ?? page;
  const totalPages = data?.pagination.totalPages ?? 1;
  const pageStartIndex = data?.pagination.from ? data.pagination.from - 1 : 0;
  const pageEndIndex = data?.pagination.to ?? items.length;
  const paginatedItems = items;

  const totalBytes = Number(data?.summary.totalBytes ?? 0);
  const storageProgress = Math.min((totalBytes / STORAGE_LIMIT_BYTES) * 100, 100);
  const isManagedConnection = activeConnection?.type === "managed";
  const managedConnectionEntry = useMemo(
    () => connections.find((connection) => connection.type === "managed") ?? null,
    [connections],
  );
  const externalConnectionEntries = useMemo(
    () => connections.filter((connection) => connection.type === "external"),
    [connections],
  );
  const currentLocationName = useMemo(() => {
    const breadcrumbs = data?.breadcrumbs ?? [];
    const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];

    return lastBreadcrumb?.name ?? activeConnection?.name ?? "My Drive";
  }, [activeConnection?.name, data?.breadcrumbs]);
  const currentLocationCaption = currentPath
    ? activeConnection?.name ?? "My Drive"
    : activeConnection
      ? activeConnection.type === "external"
        ? `${getConnectionLabel(activeConnection)} bucket`
        : "Personal storage"
      : isConnectionsLoading
        ? "Loading workspace..."
        : "Personal storage";

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

  const getCachedVisualPreviewFile = useCallback((item: DashboardItem) => {
    if (item.type !== "file") {
      return null;
    }

    const previewFile = visualPreviewFiles[`${selectedConnectionId ?? "none"}:${item.id}`] ?? null;
    if (!previewFile || !canReusePreviewCache(previewFile, item)) {
      return null;
    }

    const previewKind = getPreviewKind(previewFile);
    if (previewKind !== "image" && previewKind !== "video") {
      return null;
    }

    return previewFile;
  }, [selectedConnectionId, visualPreviewFiles]);

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
        const searchParams = new URLSearchParams(
          isManagedConnection
            ? {
                id: item.id,
              }
            : {
                connectionId: selectedConnectionId ?? "",
                key: item.key ?? "",
                name: item.name,
              },
        );

        if (!isManagedConnection && (!selectedConnectionId || !item.key)) {
          throw new Error("Missing storage connection for preview");
        }

        const response = await fetch(`/api/files/preview?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(errorData?.error || "Could not load file preview");
        }

        const result = (await response.json()) as { ok: true; file: PreviewFile };
        const file = result.file;

        const nextEntry: PreviewCacheEntry = {
          file,
          ...(cachedEntry?.textPreview !== undefined
            ? { textPreview: cachedEntry.textPreview }
            : {}),
        };

        previewCacheRef.current.set(item.id, nextEntry);
        const previewKind = getPreviewKind(nextEntry.file);
        if (previewKind === "image" || previewKind === "video") {
          const visualPreviewKey = `${selectedConnectionId ?? "none"}:${item.id}`;
          setVisualPreviewFiles((current) => {
            const existing = current[visualPreviewKey];
            if (
              existing &&
              existing.previewUrl === nextEntry.file.previewUrl &&
              existing.updatedAt === nextEntry.file.updatedAt
            ) {
              return current;
            }

            return {
              ...current,
              [visualPreviewKey]: nextEntry.file,
            };
          });
        }
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
    [
      fetchTextPreviewForFile,
      isManagedConnection,
      selectedConnectionId,
    ],
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

  const resetConnectionForm = useCallback(() => {
    setConnectionForm({
      name: "",
      provider: "s3",
      bucketName: "",
      region: "",
      endpoint: "",
      rootPrefix: "",
      accessKeyId: "",
      secretAccessKey: "",
    });
  }, []);

  const cancelCreateConnection = useCallback(() => {
    const controller = activeConnectionRequestControllerRef.current;

    if (!controller || controller.signal.aborted) {
      return;
    }

    setIsStoppingConnection(true);
    setConnectionProgress({
      value: 45,
      label: "Stopping bucket connection...",
      indeterminate: true,
    });
    controller.abort();
  }, []);

  const handleSelectConnection = useCallback(async (connectionId: string) => {
    const nextConnection = getConnectionById(connectionId);

    if (nextConnection?.type === "external" && nextConnection.reconnectRequired) {
      toast.error(
        "This bucket still uses the local-keys flow. Reconnect it to switch back to the server-backed flow.",
        { duration: ERROR_TOAST_DURATION_MS },
      );
      setIsMobileNavOpen(false);
      return;
    }

    clearSelection();
    setSelectedConnectionId(connectionId);
    setIsMobileNavOpen(false);
    setQuery("");
    setFilter("all");
    setPage(1);
    setCurrentPath("");
    setIsPreviewOpen(false);
    setPreviewFile(null);
    setPreviewError(null);
    setTextPreview(null);

    await loadFiles({
      path: "",
      pageNumber: 1,
      queryValue: "",
      filterValue: "all",
      connectionId,
    });
  }, [clearSelection, getConnectionById, loadFiles]);

  const onPickFile = () => inputRef.current?.click();
  const onPickFolder = () => directoryInputRef.current?.click();

  const handleLogout = useCallback(async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          setIsAccountOpen(false);
          setIsSigningOut(false);
          router.push("/login");
          router.refresh();
        },
        onError: (context) => {
          setIsSigningOut(false);
          console.error("logout error", context.error);
          toast.error(context.error.message || "Could not log out.", {
            duration: ERROR_TOAST_DURATION_MS,
          });
        },
      },
    });
  }, [isSigningOut, router]);

  const handleDeleteAccount = useCallback(async () => {
    if (isDeletingAccount) {
      return;
    }

    setIsDeletingAccount(true);
    toast.dismiss(DELETE_ACCOUNT_TOAST_ID);

    activeConnectionRequestControllerRef.current?.abort();
    activeConnectionRequestControllerRef.current = null;
    loadConnectionsControllerRef.current?.abort();
    loadConnectionsControllerRef.current = null;
    loadFilesControllerRef.current?.abort();
    loadFilesControllerRef.current = null;

    const activeUploadController = activeUploadControllerRef.current;
    if (activeUploadController && !activeUploadController.signal.aborted) {
      activeUploadCanceledByUserRef.current = true;
      activeUploadController.abort();
      activeUploadControllerRef.current = null;
    }

    setUploadPanel((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        isActive: false,
        isCancelling: false,
        items: current.items.map((item) =>
          isUploadItemFinished(item.status)
            ? item
            : {
                ...item,
                status: "canceled",
                message: "Account deletion started",
              },
        ),
      };
    });

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || "Could not delete account");
      }

      setIsDeleteAccountOpen(false);
      setIsAccountOpen(false);

      try {
        await authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              window.location.replace("/signup");
            },
            onError: (context) => {
              console.error("post-delete logout error", context.error);
              window.location.replace("/signup");
            },
          },
        });
      } catch (error) {
        console.error("post-delete logout error", error);
        window.location.replace("/signup");
      }
    } catch (error) {
      console.error("delete account error", error);
      toast.error(error instanceof Error ? error.message : "Could not delete account.", {
        id: DELETE_ACCOUNT_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
      setIsDeletingAccount(false);
    }
  }, [isDeletingAccount]);

  const cancelActiveUploads = useCallback(() => {
    const controller = activeUploadControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

    activeUploadCanceledByUserRef.current = true;
    setUploadPanel((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        isCancelling: true,
      };
    });
    controller.abort();
  }, []);

  const uploadFileToCurrentConnection = useCallback(
    async (
      file: File,
      folderPath: string,
      onProgress?: (loaded: number, total: number) => void,
      signal?: AbortSignal,
    ) => {
      if (!activeConnection) {
        throw new Error("No storage connection selected");
      }

      const initResponse = await fetch("/api/uploads/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connectionId: selectedConnectionId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          folderPath,
        }),
        signal,
      });

      if (!initResponse.ok) {
        const errorData = (await initResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorData?.error || `Could not start upload for ${file.name}`);
      }

      const initData = (await initResponse.json()) as InitUploadResponse;

      try {
        if (initData.mode === "simple") {
          await uploadSimpleFile(file, initData, onProgress, signal);
        } else {
          await uploadMultipartFile(file, initData, onProgress, signal);
        }
      } catch (error) {
        if (isAbortError(error)) {
          await abortUploadSession(initData.uploadId).catch((abortError) => {
            console.error("upload abort cleanup error", abortError);
          });
        }

        throw error;
      }
    },
    [activeConnection, selectedConnectionId],
  );

  const uploadCandidates = useCallback(
    async (candidates: UploadCandidate[], label: string) => {
      if (candidates.length === 0) {
        return;
      }

      const shouldParallelizeSimpleBatch =
        candidates.length > 1 &&
        candidates.every((candidate) => candidate.file.size <= CLIENT_SIMPLE_UPLOAD_MAX_BYTES);
      const concurrency = shouldParallelizeSimpleBatch
        ? Math.min(MAX_PARALLEL_SIMPLE_UPLOADS, candidates.length)
        : 1;
      const controller = new AbortController();
      let nextIndex = 0;
      let successCount = 0;
      let failureCount = 0;
      let firstFailureMessage: string | null = null;
      const panelItems = candidates.map((candidate) => ({
        id: crypto.randomUUID(),
        name: candidate.file.name,
        size: candidate.file.size,
        loaded: 0,
        status: "queued" as UploadPanelItemStatus,
      }));

      setIsUploading(true);
      setIsUploadPanelVisible(true);
      setUploadPanel({
        title: shouldParallelizeSimpleBatch
          ? `Uploading up to ${concurrency} files at a time`
          : label,
        items: panelItems,
        isActive: true,
        isCancelling: false,
      });
      toast.dismiss(UPLOAD_RESULT_TOAST_ID);
      activeUploadCanceledByUserRef.current = false;
      activeUploadControllerRef.current = controller;

      const updateUploadPanelItem = (
        itemId: string,
        updater: (item: UploadPanelItem) => UploadPanelItem,
      ) => {
        setUploadPanel((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            items: current.items.map((item) => (item.id === itemId ? updater(item) : item)),
          };
        });
      };

      const cancelOutstandingItems = (message: string) => {
        setUploadPanel((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            isActive: false,
            isCancelling: false,
            items: current.items.map((item) =>
              isUploadItemFinished(item.status)
                ? item
                : {
                    ...item,
                    status: "canceled",
                    message,
                  },
            ),
          };
        });
      };

      const finishPanel = () => {
        setUploadPanel((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            isActive: false,
            isCancelling: false,
          };
        });
      };

      const runCandidateUpload = async (candidate: UploadCandidate, panelItem: UploadPanelItem) => {
        if (controller.signal.aborted) {
          return;
        }

        const pathSegments = candidate.relativePath.split("/").filter(Boolean);
        const relativeFolderPath = pathSegments.slice(0, -1).join("/");
        const targetFolderPath = joinFolderPath(currentPath, relativeFolderPath);

        updateUploadPanelItem(panelItem.id, (item) => ({
          ...item,
          status: "uploading",
          message: undefined,
        }));

        try {
          await uploadFileToCurrentConnection(
            candidate.file,
            targetFolderPath,
            (loaded) => {
              updateUploadPanelItem(panelItem.id, (item) => ({
                ...item,
                loaded,
                status: "uploading",
              }));
            },
            controller.signal,
          );

          successCount += 1;
          updateUploadPanelItem(panelItem.id, (item) => ({
            ...item,
            loaded: item.size,
            status: "success",
            message: undefined,
          }));
        } catch (error) {
          if (isAbortError(error)) {
            updateUploadPanelItem(panelItem.id, (item) =>
              isUploadItemFinished(item.status)
                ? item
                : {
                    ...item,
                    status: "canceled",
                    message: activeUploadCanceledByUserRef.current ? "Upload canceled" : "Stopped",
                  },
            );
            return;
          }

          failureCount += 1;
          if (!firstFailureMessage) {
            firstFailureMessage = error instanceof Error ? error.message : "Upload failed";
          }

          updateUploadPanelItem(panelItem.id, (item) => ({
            ...item,
            status: "error",
            message: error instanceof Error ? error.message : "Upload failed",
          }));
        }
      };

      const worker = async () => {
        while (true) {
          if (controller.signal.aborted) {
            return;
          }

          const index = nextIndex;
          nextIndex += 1;

          if (index >= candidates.length) {
            return;
          }

          await runCandidateUpload(candidates[index]!, panelItems[index]!);
        }
      };

      try {
        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        if (controller.signal.aborted) {
          cancelOutstandingItems(activeUploadCanceledByUserRef.current ? "Upload canceled" : "Stopped");
          throw createAbortError();
        }

        finishPanel();

        if (successCount > 0) {
          await loadFiles({
            path: currentPath,
            pageNumber: currentPage,
            queryValue: query,
            filterValue: filter,
          });
        }

        if (failureCount === 0) {
          toast.success(
            candidates.length === 1
              ? `${candidates[0]?.file.name || "Item"} uploaded`
              : `Uploaded ${candidates.length} items`,
            {
              id: UPLOAD_RESULT_TOAST_ID,
              duration: SUCCESS_TOAST_DURATION_MS,
            },
          );
          return;
        }

        toast.error(
          successCount > 0
            ? `Uploaded ${successCount} ${successCount === 1 ? "item" : "items"}, ${failureCount} failed`
            : (firstFailureMessage ?? `${failureCount} uploads failed`),
          {
            id: UPLOAD_RESULT_TOAST_ID,
            duration: ERROR_TOAST_DURATION_MS,
          },
        );
        return;
      } catch (error) {
        if (isAbortError(error)) {
          toast(
            candidates.length === 1
              ? `${candidates[0]?.file.name || "Upload"} canceled`
              : "Upload canceled",
            {
              id: UPLOAD_RESULT_TOAST_ID,
              duration: INFO_TOAST_DURATION_MS,
            },
          );
        } else {
          console.error("dashboard upload batch error", error);
          finishPanel();
          toast.error(error instanceof Error ? error.message : "Upload failed.", {
            id: UPLOAD_RESULT_TOAST_ID,
            duration: ERROR_TOAST_DURATION_MS,
          });
        }
      } finally {
        if (activeUploadControllerRef.current === controller) {
          activeUploadControllerRef.current = null;
        }

        activeUploadCanceledByUserRef.current = false;
        setIsUploading(false);
      }
    },
    [currentPage, currentPath, filter, loadFiles, query, uploadFileToCurrentConnection],
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

  const downloadFile = useCallback(async (file: Pick<PreviewFile, "key" | "name"> | Pick<DashboardItem, "key" | "name">) => {
    if (!selectedConnectionId || !file.key) {
      toast.error("Missing storage connection for download.", {
        id: DOWNLOAD_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
      return;
    }

    try {
      const searchParams = new URLSearchParams({
        connectionId: selectedConnectionId,
        key: file.key,
        name: file.name,
      });

      window.open(
        `/api/files/download?${searchParams.toString()}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      console.error("download error", error);
      toast.error(error instanceof Error ? error.message : "Could not download file.", {
        id: DOWNLOAD_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
    }
  }, [selectedConnectionId]);

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
    toast.dismiss(DELETE_TOAST_ID);
    setDeletingItemKey(itemKey);
    setDeleteProgress({
      completed: 0,
      total: itemsToDelete.length,
      label:
        itemsToDelete.length === 1
          ? `Deleting ${itemsToDelete[0]?.name ?? "item"}`
          : `Deleting 0 of ${itemsToDelete.length} items`,
    });

    try {
      if (!activeConnection) {
        throw new Error("No storage connection selected");
      }

      for (let index = 0; index < itemsToDelete.length; index += 1) {
        const item = itemsToDelete[index];
        const response = await fetch("/api/files/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            item.type === "folder"
              ? {
                  type: "folder",
                  fullPath: item.fullPath,
                  connectionId: selectedConnectionId,
                }
              : item.key && activeConnection.type === "external"
                ? {
                    type: "file",
                    connectionId: selectedConnectionId,
                    key: item.key,
                  }
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

        setDeleteProgress({
          completed: index + 1,
          total: itemsToDelete.length,
          label:
            itemsToDelete.length === 1
              ? `${item.name} deleted`
              : `Deleting ${index + 1} of ${itemsToDelete.length} items`,
        });
      }

      toast.dismiss(DELETE_TOAST_ID);
      toast.success(
        deleteTarget.mode === "single"
          ? `${itemsToDelete[0]?.name ?? "Item"} deleted`
          : `Deleted ${itemsToDelete.length} items`,
      );
      clearSelection();
      setDeleteTarget(null);
      await loadFiles({
        path: currentPath,
        pageNumber: currentPage,
        queryValue: query,
        filterValue: filter,
      });
    } catch (error) {
      console.error("delete item error", error);
      toast.error(error instanceof Error ? error.message : "Could not delete item.", {
        id: DELETE_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
    } finally {
      setDeletingItemKey(null);
      setDeleteProgress(null);
    }
  }, [
    activeConnection,
    clearSelection,
    currentPage,
    currentPath,
    deleteTarget,
    filter,
    loadFiles,
    previewFile,
    query,
    selectedConnectionId,
  ]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    await uploadCandidates(
      files.map((file) => ({ file, relativePath: file.name })),
      files.length === 1 ? "Uploading file" : `Uploading ${files.length} files`,
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
      `Uploading ${files.length} items`,
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
          ? "Uploading item"
          : `Uploading ${uniqueCandidates.length} items`,
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
          downloadFile(previewFile);
          return;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          requestDeleteItem({
            id: previewFile.id,
            type: "file",
            name: previewFile.name,
            key: previewFile.key,
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
          downloadFile(item);
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
          void loadFiles({
            path: item.fullPath,
            pageNumber: 1,
            queryValue: query,
            filterValue: filter,
          });
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
    filter,
    query,
  ]);

  const onCreateFolder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = validateFolderName(folderName);
    if (validationError) {
      setFolderNameError(validationError);
      return;
    }

    toast.dismiss(CREATE_FOLDER_TOAST_ID);
    setIsCreatingFolder(true);
    setFolderNameError(null);

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connectionId: selectedConnectionId,
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

      toast.dismiss(CREATE_FOLDER_TOAST_ID);
      toast.success(`Created ${folderName.trim()}`);
      setIsCreateFolderOpen(false);
      setFolderName("");
      await loadFiles({
        path: currentPath,
        pageNumber: 1,
        queryValue: query,
        filterValue: filter,
      });
    } catch (error) {
      console.error("create folder error", error);
      const message = error instanceof Error ? error.message : "Could not create folder.";
      setFolderNameError(message);
      toast.error(message, {
        id: CREATE_FOLDER_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const onCreateConnection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const controller = new AbortController();
    activeConnectionRequestControllerRef.current = controller;
    toast.dismiss(CREATE_CONNECTION_TOAST_ID);
    setIsStoppingConnection(false);
    setIsSavingConnection(true);
    setConnectionProgress({
      value: 15,
      label: "Preparing bucket connection...",
    });

    try {
      const accessKeyId = connectionForm.accessKeyId.trim();
      const secretAccessKey = connectionForm.secretAccessKey.trim();
      const bucketName = connectionForm.bucketName.trim();
      const connectionName = connectionForm.name.trim();

      if (!connectionName) {
        throw new Error("Connection name is required");
      }

      if (!bucketName) {
        throw new Error("Bucket name is required");
      }

      if (!accessKeyId) {
        throw new Error("Access key is required");
      }

      if (!secretAccessKey) {
        throw new Error("Secret key is required");
      }

      setConnectionProgress({
        value: 48,
        label: "Validating bucket access...",
        indeterminate: true,
      });

      const response = await fetch("/api/connections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: connectionName,
          provider: connectionForm.provider,
          bucketName,
          region: connectionForm.region,
          endpoint: connectionForm.endpoint,
          rootPrefix: connectionForm.rootPrefix,
          accessKeyId,
          secretAccessKey,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | {
              error?: string;
              debug?: {
                name?: string;
                message?: string;
                code?: string;
                errno?: number | null;
                syscall?: string;
                hostname?: string;
                fault?: string;
                httpStatusCode?: number | null;
                requestId?: string | null;
                extendedRequestId?: string | null;
                attempts?: number | null;
                totalRetryDelay?: number | null;
              };
            }
          | null;

        console.error("create connection response error", {
          status: response.status,
          provider: connectionForm.provider,
          bucketName,
          region: connectionForm.region,
          endpoint: connectionForm.endpoint,
          error: errorData?.error,
          debug: errorData?.debug,
        });

        throw new Error(errorData?.error || "Could not add bucket");
      }

      const result = (await response.json()) as {
        ok: true;
        connection: DashboardConnection;
      };

      setConnectionProgress({
        value: 90,
        label: "Refreshing your workspace...",
      });

      toast.dismiss(CREATE_CONNECTION_TOAST_ID);
      toast.success(`Connected ${result.connection.name}`);
      setIsAddBucketOpen(false);
      resetConnectionForm();
      await loadConnections();
      setConnectionProgress({
        value: 96,
        label: "Opening connected bucket...",
      });
      await handleSelectConnection(result.connection.id);
      setConnectionProgress({
        value: 100,
        label: "Bucket connected.",
      });
    } catch (error) {
      if (isAbortError(error)) {
        toast("Bucket connection canceled.", {
          id: CREATE_CONNECTION_TOAST_ID,
          duration: INFO_TOAST_DURATION_MS,
        });
      } else {
        console.error("create connection error", error);
        toast.error(error instanceof Error ? error.message : "Could not add bucket.", {
          id: CREATE_CONNECTION_TOAST_ID,
          duration: ERROR_TOAST_DURATION_MS,
        });
      }
    } finally {
      if (activeConnectionRequestControllerRef.current === controller) {
        activeConnectionRequestControllerRef.current = null;
      }

      setIsStoppingConnection(false);
      setIsSavingConnection(false);
      window.setTimeout(() => {
        setConnectionProgress(null);
      }, 300);
    }
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <div className="border-b border-border bg-background lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setIsMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <PanelLeft className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">{currentLocationName}</p>
            <p className="truncate text-xs text-muted-foreground">{currentLocationCaption}</p>
          </div>

          <button
            type="button"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => setIsAccountOpen(true)}
            aria-label="Open account"
          >
            {userImage ? (
              <img
                src={userImage}
                alt={userName}
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              getInitials(userName) || "U"
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 motion-safe:transition-[grid-template-columns] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isSidebarCollapsed
            ? "lg:grid-cols-[76px_minmax(0,1fr)]"
            : "lg:grid-cols-[280px_minmax(0,1fr)]",
        )}
      >
        <aside className="hidden min-h-0 overflow-hidden border-r border-border bg-background lg:flex lg:flex-col">
          {isSidebarCollapsed ? (
            <>
              <div className="flex h-12 items-center justify-center border-b border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 rounded-md text-muted-foreground"
                  onClick={() => setIsSidebarCollapsed(false)}
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                >
                  <ChevronLeft className="size-4 rotate-180" />
                </Button>
              </div>

              <div className="min-h-0 flex flex-1 flex-col px-2 py-3">
                <div className="flex flex-col items-center gap-2">
                  {managedConnectionEntry ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(
                        "size-11 rounded-lg justify-center px-0",
                        highlightedConnectionId === managedConnectionEntry.id
                          ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      onClick={() => void handleSelectConnection(managedConnectionEntry.id)}
                      aria-label="Open My Drive"
                      title="My Drive"
                    >
                      <HardDrive className="size-4 shrink-0" />
                    </Button>
                  ) : isConnectionsLoading ? (
                    <div className="flex h-11 items-center justify-center text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="size-11 rounded-lg justify-center border-dashed px-0"
                    onClick={() => setIsAddBucketOpen(true)}
                    aria-label="Add bucket"
                    title="Add bucket"
                  >
                    <Plus className="size-4 shrink-0" />
                  </Button>
                </div>

                <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="flex flex-col items-center gap-2 pb-2">
                    {externalConnectionEntries.map((connection) => {
                      const active = highlightedConnectionId === connection.id;
                      const connectionTitle =
                        connection.reconnectRequired
                          ? `${connection.name} • ${connection.bucketName} • Reconnect required`
                          : `${connection.name} • ${connection.bucketName} • ${getConnectionLabel(connection)}`;

                      return (
                        <Button
                          key={connection.id}
                          type="button"
                          variant="ghost"
                          className={cn(
                            "size-11 rounded-lg justify-center px-0",
                            active
                              ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => void handleSelectConnection(connection.id)}
                          aria-label={connectionTitle}
                          title={connectionTitle}
                        >
                          <Database className="size-4 shrink-0" />
                        </Button>
                      );
                    })}

                    {isConnectionsLoading && connections.length > 0 ? (
                      <div className="flex justify-center py-1 text-muted-foreground">
                        <LoaderCircle className="size-3.5 animate-spin" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="border-t border-border px-2 py-3">
                <button
                  type="button"
                  className="flex w-full cursor-pointer justify-center rounded-lg px-0 py-1 transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  title={`${userName} • ${userEmail}`}
                  aria-label="Open account"
                  onClick={() => setIsAccountOpen(true)}
                >
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {userImage ? (
                      <img
                        src={userImage}
                        alt={userName}
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      getInitials(userName) || "U"
                    )}
                  </div>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-16 items-center justify-between border-b border-border px-5">
                <div className="grid min-w-0 flex-1 grid-cols-[40px_minmax(0,1fr)] items-center gap-3">
                  <Bucket0BrandMark />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold tracking-tight">Bucket0</p>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Storage
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={() => setIsSidebarCollapsed(true)}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </div>

              <div className="min-h-0 flex-1 px-3 py-4">
                <div className="flex h-full min-h-0 flex-col gap-6">
                  <div className="space-y-1.5 px-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      My Drive
                    </p>
                    {managedConnectionEntry ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(
                          "h-auto w-full justify-start rounded-lg px-3 py-2 text-left",
                          highlightedConnectionId === managedConnectionEntry.id
                            ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                        onClick={() => void handleSelectConnection(managedConnectionEntry.id)}
                      >
                        <HardDrive className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">My Drive</div>
                        </div>
                      </Button>
                    ) : isConnectionsLoading ? (
                      <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />
                        <span>Loading drive...</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 flex-col gap-2 px-3 lg:flex">
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        External buckets
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-start border-dashed"
                        onClick={() => setIsAddBucketOpen(true)}
                      >
                        <Plus className="size-4" />
                        Add bucket
                      </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
                      <div className="space-y-1.5">
                        {externalConnectionEntries.map((connection) => {
                          const active = highlightedConnectionId === connection.id;

                          return (
                            <Button
                              key={connection.id}
                              type="button"
                              variant="ghost"
                              className={cn(
                                "h-auto w-full justify-start rounded-lg px-3 py-2 text-left",
                                active
                                  ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )}
                              onClick={() => void handleSelectConnection(connection.id)}
                            >
                              <Database className="mt-0.5 size-4 shrink-0" />
                              <div className="min-w-0 space-y-0.5">
                                <div className="truncate text-sm font-medium">{connection.name}</div>
                                <div
                                  className={cn(
                                    "truncate text-xs",
                                    active ? "text-background/70" : "text-muted-foreground",
                                  )}
                                >
                                  {connection.bucketName} • {connection.reconnectRequired ? "Reconnect required" : getConnectionLabel(connection)}
                                </div>
                              </div>
                            </Button>
                          );
                        })}

                        {isConnectionsLoading && connections.length > 0 ? (
                          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                            <LoaderCircle className="size-3.5 animate-spin" />
                            <span>Refreshing connections...</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border">
                {isManagedConnection ? (
                  <div className="border-b border-border px-5 py-4">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Storage</span>
                      <span>{isLoading ? "Loading..." : `${formatBytes(String(totalBytes))} / 5 GB`}</span>
                    </div>

                    <div className="mt-1 min-h-12">
                      {isLoading ? (
                        <div className="flex h-12 items-center gap-2 text-sm text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" />
                          <span>Fetching connection info...</span>
                        </div>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-foreground">My Drive</p>
                          <div className="mt-2.5 h-2 rounded-full bg-muted/60">
                            <div
                              className="h-full rounded-full bg-foreground transition-[width] duration-300"
                              style={{ width: `${storageProgress}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)] items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => setIsAccountOpen(true)}
                  aria-label="Open account"
                >
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {userImage ? (
                      <img
                        src={userImage}
                        alt={userName}
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      getInitials(userName) || "U"
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{userName}</p>
                    <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                  </div>
                </button>
              </div>
            </>
          )}
        </aside>

        <main
          className="min-h-0 min-w-0 overflow-y-auto bg-background"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="relative h-full">
            {isDragActive ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary/40 bg-background/90">
                <div className="rounded-xl border border-border bg-background px-5 py-4 text-center">
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
            <div className="flex h-full flex-col">
              <section className="border-b border-border bg-background">
                <div className="px-4 py-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="relative w-full min-w-0 xl:flex-1">
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
                            filterValue: filter,
                          });
                        }}
                        placeholder="Search files, folders, and paths..."
                        className="rounded-lg bg-background pl-10 text-sm shadow-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center xl:shrink-0">
                      <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        multiple
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
                        className="w-full sm:w-auto"
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
                            className="w-full justify-center sm:w-auto"
                            disabled={isUploading || isCreatingFolder}
                          >
                            {isUploading ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <Upload className="size-4" />
                            )}
                            {isUploading ? "Uploading..." : "Upload"}
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
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 border-t border-border px-4 py-2.5 xl:flex-row xl:items-center xl:gap-4">
                  <div className="hidden gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex md:flex-wrap md:overflow-visible md:pb-0 xl:min-w-0 xl:flex-1">
                    {FILTER_TABS.map((tab) => {
                      const active = filter === tab.value;

                      return (
                        <Button
                          key={tab.value}
                          type="button"
                          variant="outline"
                          className={cn(
                            "shrink-0",
                            active &&
                              "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background",
                          )}
                          onClick={() => {
                            setFilter(tab.value);
                            clearSelection();
                            setPage(1);
                            void loadFiles({
                              path: currentPath,
                              pageNumber: 1,
                              queryValue: query,
                              filterValue: tab.value,
                            });
                          }}
                        >
                          {tab.label}
                        </Button>
                      );
                    })}
                  </div>

                  <div className="relative min-h-8 self-start xl:self-auto">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none invisible hidden xl:flex xl:min-h-8 xl:items-center xl:justify-end xl:gap-2"
                    >
                      <div className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
                        999 selected
                      </div>
                      <Button type="button" variant="outline" disabled tabIndex={-1}>
                        <Eye className="size-4" />
                        Preview
                      </Button>
                      <Button type="button" variant="outline" disabled tabIndex={-1}>
                        <Download className="size-4" />
                        Download
                      </Button>
                      <Button type="button" variant="destructive" disabled tabIndex={-1}>
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                      <Button type="button" variant="ghost" disabled tabIndex={-1}>
                        Clear
                      </Button>
                    </div>

                    {selectedItems.length > 0 ? (
                      <div className="flex min-h-8 items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:absolute xl:inset-0 xl:flex-nowrap xl:items-center xl:justify-end xl:overflow-visible xl:pb-0">
                        <div className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
                          {selectedItems.length} selected
                        </div>
                        {selectedItems.length === 1 ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const [item] = selectedItems;
                              if (!item) return;
                              if (item.type === "folder") {
                                clearSelection();
                                setPage(1);
                                void loadFiles({
                                  path: item.fullPath,
                                  pageNumber: 1,
                                  queryValue: query,
                                  filterValue: filter,
                                });
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
                            onClick={() => {
                              for (const item of selectedFileItems) {
                                downloadFile(item);
                              }
                            }}
                          >
                            <Download className="size-4" />
                            Download
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setDeleteTarget({ mode: "bulk", items: selectedItems })}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={clearSelection}
                        >
                          Clear
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-h-8 items-center justify-end gap-2 xl:absolute xl:inset-0 xl:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            void loadFiles({
                              path: currentPath,
                              pageNumber: currentPage,
                              queryValue: query,
                              filterValue: filter,
                            })
                          }
                          disabled={isLoading || isUploading || isCreatingFolder}
                          aria-label="Refresh files"
                        >
                          <RefreshCcw className={cn("size-4", isLoading && "animate-spin")} />
                        </Button>

                        <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                              "rounded-lg",
                              viewMode === "list" &&
                                "bg-foreground text-background hover:bg-foreground hover:text-background",
                            )}
                            onClick={() => setViewMode("list")}
                            aria-label="List view"
                          >
                            <Rows3 className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                              "rounded-lg",
                              viewMode === "grid" &&
                                "bg-foreground text-background hover:bg-foreground hover:text-background",
                            )}
                            onClick={() => setViewMode("grid")}
                            aria-label="Grid view"
                          >
                            <Grid2x2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
                <div className="flex min-h-11 flex-col gap-2 border-b border-border px-4 py-2.5 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 text-sm text-muted-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:pb-0">
                    {data?.breadcrumbs?.map((crumb, index) => (
                      <span key={crumb.path || "root"} className="flex shrink-0 items-center gap-2">
                        {index > 0 ? <ChevronRight className="size-3" /> : null}
                        <button
                          type="button"
                          className="rounded-lg px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            clearSelection();
                            setPage(1);
                            void loadFiles({
                              path: crumb.path,
                              pageNumber: 1,
                              queryValue: query,
                              filterValue: filter,
                            });
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

                {viewMode === "list" ? (
                  <div className="hidden grid-cols-[28px_minmax(0,1.7fr)_120px_160px_56px] gap-4 border-b border-border bg-muted/20 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground md:grid">
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
                ) : null}

                {isLoading ? (
                  <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading files...
                  </div>
                ) : totalMatchingItems === 0 ? (
                  isFilteredEmptyState ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                      <p className="text-base font-medium tracking-tight">No matching items</p>
                      <p className="text-sm text-muted-foreground">
                        Try a different search or clear the current filters.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
                      <div className="w-full max-w-3xl">
                        <div className="mx-auto max-w-xl text-center">
                          <div className="mx-auto flex size-20 items-center justify-center rounded-[22px] border border-dashed border-border bg-muted/20 text-muted-foreground sm:size-24">
                            <Upload className="size-8 sm:size-9" />
                          </div>

                          <div className="mt-6 space-y-2.5">
                            <p className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                              {currentPath
                                ? "This folder is empty"
                                : activeConnection?.type === "external"
                                  ? "This bucket is empty"
                                  : "Your storage is empty"}
                            </p>
                            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                              Upload files to get started, or drag them anywhere in this view.
                            </p>
                          </div>

                          <div className="mt-6">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="lg" disabled={isUploading || isCreatingFolder}>
                                  {isUploading ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    <Upload className="size-4" />
                                  )}
                                  {isUploading ? "Uploading..." : "Upload"}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="w-48">
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
                          </div>
                        </div>

                        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-background">
                          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                            <div className="px-4 py-4 text-left sm:px-5">
                              <p className="text-sm font-medium tracking-tight text-foreground">Drag & drop</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Drop files anywhere in this view to upload instantly.
                              </p>
                            </div>
                            <div className="px-4 py-4 text-left sm:px-5">
                              <p className="text-sm font-medium tracking-tight text-foreground">Folders</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Upload full folders and keep their nested structure.
                              </p>
                            </div>
                            <div className="px-4 py-4 text-left sm:px-5">
                              <p className="text-sm font-medium tracking-tight text-foreground">Preview</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Open images, video, audio, PDFs, and text files after upload.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ) : viewMode === "list" ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {paginatedItems.map((item) => {
                      const rowAction = () => {
                        if (item.type === "folder") {
                          clearSelection();
                          setPage(1);
                          void loadFiles({
                            path: item.fullPath,
                            pageNumber: 1,
                            queryValue: query,
                            filterValue: filter,
                          });
                          return;
                        }

                        void openFilePreview(item);
                      };

                      const isDeleting = deletingItemKey === `${item.type}:${item.id}`;
                      const cachedPreviewFile = getCachedVisualPreviewFile(item);

                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            "grid w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_40px] gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/50 md:grid-cols-[28px_minmax(0,1.7fr)_120px_160px_56px] md:gap-4",
                            selectedIds.has(item.id) && "bg-accent/35",
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
                            <div className="flex size-10 overflow-hidden rounded-lg border border-border bg-muted/20 md:size-9">
                              <ItemVisualPreview item={item} previewFile={cachedPreviewFile} variant="list" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium tracking-tight">
                                {item.name}
                              </p>
                              <p className="hidden truncate text-sm text-muted-foreground md:block">
                                {getItemSubtitle(item)}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground md:hidden">
                                <span>{item.type === "folder" ? "Folder" : formatBytes(item.size)}</span>
                                <span>•</span>
                                <span>{formatUpdatedAt(item.updatedAt)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="hidden self-center text-sm text-muted-foreground md:block">
                            {item.type === "folder" ? "—" : formatBytes(item.size)}
                          </div>

                          <div className="hidden self-center text-sm text-muted-foreground md:block">
                            {formatUpdatedAt(item.updatedAt)}
                          </div>

                          <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
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
                                    <DropdownMenuItem onSelect={() => downloadFile(item)}>
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
                                      void loadFiles({
                                        path: item.fullPath,
                                        pageNumber: 1,
                                        queryValue: query,
                                        filterValue: filter,
                                      });
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
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid content-start gap-2.5 [grid-template-columns:repeat(2,minmax(0,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
                      {paginatedItems.map((item) => {
                        const cardAction = () => {
                          if (item.type === "folder") {
                            clearSelection();
                            setPage(1);
                            void loadFiles({
                              path: item.fullPath,
                              pageNumber: 1,
                              queryValue: query,
                              filterValue: filter,
                            });
                            return;
                          }

                          void openFilePreview(item);
                        };

                        const isDeleting = deletingItemKey === `${item.type}:${item.id}`;
                        const cachedPreviewFile = getCachedVisualPreviewFile(item);

                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "group relative flex min-h-24 cursor-pointer flex-col rounded-lg border border-border bg-background p-2.5 text-left transition-colors hover:border-foreground/20",
                              selectedIds.has(item.id) && "border-foreground/25 bg-accent/10",
                            )}
                            onClick={cardAction}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                cardAction();
                              }
                            }}
                          >
                            <div className="absolute inset-x-2 top-2 flex items-start justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <div onClick={(event) => event.stopPropagation()}>
                                <Checkbox
                                  checked={selectedIds.has(item.id)}
                                  onCheckedChange={(checked) =>
                                    toggleItemSelection(item.id, Boolean(checked))
                                  }
                                  aria-label={`Select ${item.name}`}
                                  className={cn(selectedIds.has(item.id) && "opacity-100")}
                                />
                              </div>

                              <div onClick={(event) => event.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
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
                                        <DropdownMenuItem onSelect={() => downloadFile(item)}>
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
                                          void loadFiles({
                                            path: item.fullPath,
                                            pageNumber: 1,
                                            queryValue: query,
                                            filterValue: filter,
                                          });
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

                            <div className="mb-2 flex aspect-square w-full overflow-hidden rounded-md bg-muted/45">
                              <ItemVisualPreview item={item} previewFile={cachedPreviewFile} variant="grid" />
                            </div>

                            <div className="min-w-0 text-center">
                              <p className="truncate text-sm font-medium tracking-tight">{item.name}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {item.type === "folder" ? "—" : formatBytes(item.size)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {totalMatchingItems > 0 ? (
                  <div className="flex flex-col gap-3 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing {pageStartIndex + 1}-{pageEndIndex} of {totalMatchingItems}
                    </p>

                    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto sm:items-center">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-center sm:w-auto"
                        onClick={() => {
                          const nextPage = currentPage - 1;
                          setPage(nextPage);
                          void loadFiles({
                            path: currentPath,
                            pageNumber: nextPage,
                            queryValue: query,
                            filterValue: filter,
                          });
                        }}
                        disabled={currentPage <= 1}
                      >
                        <ChevronLeft className="size-4" />
                        Previous
                      </Button>
                      <div className="min-w-20 rounded-lg border border-border bg-background px-3 py-1.5 text-center text-sm text-muted-foreground">
                        {currentPage} / {totalPages}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-center sm:w-auto"
                        onClick={() => {
                          const nextPage = currentPage + 1;
                          setPage(nextPage);
                          void loadFiles({
                            path: currentPath,
                            pageNumber: nextPage,
                            queryValue: query,
                            filterValue: filter,
                          });
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

      <Dialog open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <DialogContent
          className="p-0 lg:hidden max-sm:origin-left max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none max-sm:!overflow-hidden max-sm:!rounded-none max-sm:!border-0 max-sm:!shadow-none max-sm:data-[state=closed]:slide-out-to-left max-sm:data-[state=open]:slide-in-from-left max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Navigation</DialogTitle>
            <DialogDescription>
              Browse My Drive, switch buckets, and open account settings.
            </DialogDescription>
          </DialogHeader>

          <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="grid min-w-0 flex-1 grid-cols-[32px_minmax(0,1fr)] items-center gap-3">
                <Bucket0BrandMark className="size-8" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight">Bucket0</p>
                  <p className="truncate text-xs text-muted-foreground">Storage</p>
                </div>
              </div>

              <DialogClose asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <X className="size-4" />
                </Button>
              </DialogClose>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-border px-4 py-4">
                <button
                  type="button"
                  className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)] items-center gap-3 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setIsAccountOpen(true);
                  }}
                >
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {userImage ? (
                      <img
                        src={userImage}
                        alt={userName}
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      getInitials(userName) || "U"
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{userName}</p>
                    <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                  </div>
                </button>
              </div>

              <div className="border-b border-border px-4 py-4">
                <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  My Drive
                </p>
                {managedConnectionEntry ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto w-full justify-start rounded-lg px-3 py-2 text-left",
                      highlightedConnectionId === managedConnectionEntry.id
                        ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    onClick={() => void handleSelectConnection(managedConnectionEntry.id)}
                  >
                    <HardDrive className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">My Drive</div>
                    </div>
                  </Button>
                ) : (
                  <div className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    <span>Loading drive...</span>
                  </div>
                )}
              </div>

              <div className="px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    External buckets
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-dashed"
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      setIsAddBucketOpen(true);
                    }}
                  >
                    <Plus className="size-4" />
                    Add bucket
                  </Button>
                </div>

                <div className="mt-3 space-y-1.5">
                  {externalConnectionEntries.map((connection) => {
                    const active = highlightedConnectionId === connection.id;

                    return (
                      <Button
                        key={connection.id}
                        type="button"
                        variant="ghost"
                        className={cn(
                          "h-auto w-full justify-start rounded-lg px-3 py-2 text-left",
                          active
                            ? "border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                        onClick={() => void handleSelectConnection(connection.id)}
                      >
                        <Database className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0 space-y-0.5">
                          <div className="truncate text-sm font-medium">{connection.name}</div>
                          <div
                            className={cn(
                              "truncate text-xs",
                              active ? "text-background/70" : "text-muted-foreground",
                            )}
                          >
                            {connection.bucketName} • {getConnectionLabel(connection)}
                          </div>
                        </div>
                      </Button>
                    );
                  })}

                  {!isConnectionsLoading && externalConnectionEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No external buckets connected yet.</p>
                  ) : null}

                  {isConnectionsLoading && connections.length > 0 ? (
                    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      <span>Refreshing connections...</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {uploadPanel && isUploadPanelVisible ? (
        <UploadQueuePanel
          state={uploadPanel}
          onCancelAll={cancelActiveUploads}
          onClose={() => setIsUploadPanelVisible(false)}
        />
      ) : null}

      <Dialog
        open={isAddBucketOpen}
        onOpenChange={(open) => {
          if (!open && isSavingConnection) {
            return;
          }

          setIsAddBucketOpen(open);

          if (!open && !isSavingConnection) {
            resetConnectionForm();
            setConnectionProgress(null);
          }
        }}
      >
        <DialogContent className="max-w-lg overflow-hidden p-0 sm:max-h-[92vh] sm:grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader className="border-b border-border pr-14">
            <DialogTitle>Connect a bucket</DialogTitle>
            <DialogDescription>
              Add your own Amazon S3, Cloudflare R2, or Wasabi bucket with encrypted server-side storage.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto">
            <form className="space-y-4 px-6 py-6" onSubmit={onCreateConnection}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {(["s3", "r2", "wasabi"] as ConnectionProvider[]).map((provider) => {
                  const active = connectionForm.provider === provider;

                  return (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 justify-center bg-background",
                        active
                          ? "border-foreground bg-foreground font-medium text-background hover:border-foreground hover:bg-foreground hover:text-background"
                          : "text-muted-foreground hover:border-foreground/15 hover:bg-muted/60 hover:text-foreground",
                      )}
                      onClick={() =>
                        setConnectionForm((current) => ({
                          ...current,
                          provider,
                        }))
                      }
                      disabled={isSavingConnection}
                    >
                      <span className="inline-flex items-center justify-center gap-2.5">
                        <span className={cn("flex shrink-0 items-center justify-center", provider === "s3" ? "w-7" : "w-8")}>
                          <ProviderLogo
                            provider={provider}
                            active={active}
                            className={provider === "s3" ? "!h-3.5 !w-auto" : "size-5"}
                          />
                        </span>
                        <span className="leading-none">{getProviderName(provider)}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                {getConnectionDescription(connectionForm.provider)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="connection-name" className="text-sm font-medium">
                  Connection name
                </label>
                <Input
                  id="connection-name"
                  value={connectionForm.name}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Production assets"
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="bucket-name" className="text-sm font-medium">
                  Bucket name
                </label>
                <Input
                  id="bucket-name"
                  value={connectionForm.bucketName}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      bucketName: event.target.value,
                    }))
                  }
                  placeholder="my-bucket"
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="bucket-region" className="text-sm font-medium">
                  Region {connectionForm.provider === "r2" ? <span className="text-muted-foreground">(optional)</span> : null}
                </label>
                <Input
                  id="bucket-region"
                  value={connectionForm.region}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      region: event.target.value,
                    }))
                  }
                  placeholder={connectionForm.provider === "r2" ? "auto" : "us-east-1"}
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="bucket-endpoint" className="text-sm font-medium">
                  Endpoint {connectionForm.provider === "r2" ? null : <span className="text-muted-foreground">(optional)</span>}
                </label>
                <Input
                  id="bucket-endpoint"
                  value={connectionForm.endpoint}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      endpoint: event.target.value,
                    }))
                  }
                  placeholder={
                    connectionForm.provider === "r2"
                      ? "https://<account-id>.r2.cloudflarestorage.com"
                      : connectionForm.provider === "wasabi"
                        ? "https://s3.us-east-1.wasabisys.com"
                        : "https://s3.us-east-1.amazonaws.com"
                  }
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="bucket-prefix" className="text-sm font-medium">
                  Root prefix <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="bucket-prefix"
                  value={connectionForm.rootPrefix}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      rootPrefix: event.target.value,
                    }))
                  }
                  placeholder="client-a/uploads"
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="bucket-access-key" className="text-sm font-medium">
                  Access key
                </label>
                <Input
                  id="bucket-access-key"
                  value={connectionForm.accessKeyId}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      accessKeyId: event.target.value,
                    }))
                  }
                  placeholder="Access key"
                  disabled={isSavingConnection}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="bucket-secret-key" className="text-sm font-medium">
                  Secret key
                </label>
                <Input
                  id="bucket-secret-key"
                  type="password"
                  value={connectionForm.secretAccessKey}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      secretAccessKey: event.target.value,
                    }))
                  }
                  placeholder="Secret key"
                  disabled={isSavingConnection}
                />
              </div>

              <div className="sm:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-emerald-950">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-emerald-600">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-900">Your keys stay protected</p>
                    <p className="mt-1 text-sm text-emerald-800/90">
                      Your access and secret keys are encrypted before storage and only used server-side to validate and access your bucket.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {connectionProgress ? (
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground">{connectionProgress.label}</span>
                    {!connectionProgress.indeterminate ? (
                      <div className="font-medium text-foreground">
                        {Math.round(clampProgress(connectionProgress.value))}%
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={cancelCreateConnection}
                    disabled={isStoppingConnection}
                  >
                    {isStoppingConnection ? "Stopping..." : "Stop"}
                  </Button>
                </div>
                <Progress
                  value={connectionProgress.value}
                  indeterminate={connectionProgress.indeterminate}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddBucketOpen(false)}
                disabled={isSavingConnection}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingConnection}>
                {isSavingConnection ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Database className="size-4" />
                )}
                {isSavingConnection ? "Connecting..." : "Connect bucket"}
              </Button>
            </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAccountOpen}
        onOpenChange={(open) => {
          if (!open && isDeletingAccount) {
            return;
          }

          setIsAccountOpen(open);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
          <DialogHeader className="border-b border-border pr-14">
            <DialogTitle>Account</DialogTitle>
            <DialogDescription>
              Profile and workspace settings.
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-border px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-primary text-base font-semibold text-primary-foreground">
                {userImage ? (
                  <img
                    src={userImage}
                    alt={userName}
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  getInitials(userName) || "U"
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold tracking-tight text-foreground">
                  {userName}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {userEmail}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6">
            <section className="border-b border-border py-5">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Profile information
              </p>
              <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Full name</p>
                  <p className="mt-1 text-sm text-muted-foreground">{userName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Email address</p>
                  <p className="mt-1 text-sm text-muted-foreground">{userEmail}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">My Drive</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {managedConnectionEntry ? "Available" : "Setting up..."}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">External buckets</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {externalConnectionEntries.length} connected
                  </p>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <p className="text-sm font-medium text-foreground">Current workspace</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeConnection?.name ?? "My Drive"}
                  </p>
                </div>
              </div>
            </section>

            <section className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="py-5 md:pr-8">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Session
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Log out</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      End your current session on this device.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleLogout()}
                    disabled={isSigningOut || isDeletingAccount}
                  >
                    {isSigningOut ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {isSigningOut ? "Logging out..." : "Log out"}
                  </Button>
                </div>
              </div>

              <div className="py-5 md:pl-8">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Danger zone
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Delete account</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Delete your account, My Drive data, sessions, and saved bucket connections.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setIsDeleteAccountOpen(true)}
                    disabled={isSigningOut || isDeletingAccount}
                  >
                    Delete account
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDeleteAccountOpen}
        onOpenChange={(open) => {
          if (!open && isDeletingAccount) {
            return;
          }

          setIsDeleteAccountOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your Bucket0 account and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-6">
            <div className="rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-3">
              <p className="text-sm font-medium text-foreground">This will permanently remove:</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>• all files and folders in My Drive</li>
                <li>• upload sessions, previews, and app metadata</li>
                <li>• saved external bucket connections and encrypted keys</li>
                <li>• your Bucket0 account, sessions, and linked auth records</li>
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                External bucket contents in your own Amazon S3, Cloudflare R2, or Wasabi accounts will not be deleted.
              </p>
            </div>

            {isDeletingAccount ? (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                Deleting your account, managed files, sessions, and connection records...
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteAccountOpen(false)}
                disabled={isDeletingAccount}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteAccount()}
                disabled={isDeletingAccount}
              >
                {isDeletingAccount ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {isDeletingAccount ? "Deleting account..." : "Delete account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              Add a new folder in {currentPath || activeConnection?.name || "My Drive"}.
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
                onClick={() => setIsCreateFolderOpen(false)}
                disabled={isCreatingFolder}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingFolder}>
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
            setDeleteProgress(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{getDeleteDialogCopy(deleteTarget).title}</DialogTitle>
            <DialogDescription>{getDeleteDialogCopy(deleteTarget).description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-6">
            {deleteProgress ? (
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{deleteProgress.label}</span>
                  <span className="font-medium text-foreground">
                    {Math.round((deleteProgress.completed / Math.max(deleteProgress.total, 1)) * 100)}%
                  </span>
                </div>
                <Progress
                  value={(deleteProgress.completed / Math.max(deleteProgress.total, 1)) * 100}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingItemKey)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
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
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="absolute right-5 top-5 z-10 rounded-full border-border/80 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 hover:bg-muted"
              aria-label="Close preview"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>

          <DialogHeader className="border-b border-border p-6 pr-20">
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

              <div className="flex items-center gap-2 pr-10">
                {previewFile ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => downloadFile(previewFile)}
                    >
                      <Download className="size-4" />
                      Download
                    </Button>
                    <Button asChild variant="outline">
                      <a href={previewFile.previewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                        Open
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() =>
                        requestDeleteItem({
                          id: previewFile.id,
                          type: "file",
                          name: previewFile.name,
                          key: previewFile.key,
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
                  <div className="flex w-full max-w-2xl flex-col items-center gap-6 rounded-xl border border-border bg-background px-6 py-10 text-center">
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
                  <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-xl border border-border bg-background px-6 py-10 text-center">
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
