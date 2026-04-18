"use client";

import { X } from "lucide-react";
import { toast, ToastBar, Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          maxWidth: 420,
        },
      }}
    >
      {(toastItem) => (
        <ToastBar toast={toastItem}>
          {({ icon, message }) => (
            <div className="flex min-w-0 items-start gap-3 overflow-hidden">
              {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
              <div className="min-w-0 flex-1 overflow-hidden [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:[overflow-wrap:anywhere]">
                {message}
              </div>
              <button
                type="button"
                onClick={() => toast.dismiss(toastItem.id)}
                className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
