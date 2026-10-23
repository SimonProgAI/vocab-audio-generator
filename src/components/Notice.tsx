import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warning" | "error";

export interface NoticeContent {
  tone: NoticeTone;
  title?: string;
  messages: string[];
}

interface NoticeProps extends NoticeContent {
  action?: ReactNode;
  onDismiss?: () => void;
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

export function Notice({ tone, title, messages, action, onDismiss }: NoticeProps) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {messages.length === 1 ? (
          <p>{messages[0]}</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-m-1 rounded p-1 leading-none opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}
