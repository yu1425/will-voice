"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type PageKey = "home" | "flow" | "chat" | "settings" | "guide";
type Props = {
  current: PageKey;
  onNavigate?: () => void;
  onSettings?: () => void;
};
/** Site navigation for the parent WILL character site. */
export default function PageNavigation({
  current,
  onNavigate,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverOpened = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const close = () => {
    clear();
    setOpen(false);
    hoverOpened.current = false;
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const visit = (page: PageKey, event: React.MouseEvent<HTMLAnchorElement>) => {
    close();
    if (page === current) event.preventDefault();
    else onNavigate?.();
  };
  return (
    <nav
      className="page-menu"
      aria-label="うぃるサイトメニュー"
      ref={root}
      onPointerEnter={(event) => {
        clear();
        if (
          event.pointerType === "mouse" &&
          window.matchMedia("(hover: hover)").matches &&
          !open
        ) {
          hoverOpened.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={() => {
        clear();
        if (hoverOpened.current)
          timer.current = setTimeout(() => {
            setOpen(false);
            hoverOpened.current = false;
          }, 220);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="page-menu-trigger"
        aria-label="メニューを開く"
        aria-expanded={open}
        aria-controls="app-page-menu"
        onClick={() => {
          clear();
          if (hoverOpened.current) {
            hoverOpened.current = false;
            setOpen(true);
          } else setOpen((value) => !value);
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span>メニュー</span>
      </button>
      {open && (
        <div className="page-menu-panel" id="app-page-menu">
          <p className="page-menu-title">うぃる</p>
          <Link
            href="/"
            aria-current={current === "home" ? "page" : undefined}
            onClick={(event) => visit("home", event)}
          >
            <span aria-hidden="true">⌂</span>ホーム
          </Link>
          <Link
            href="/flow"
            aria-current={current === "flow" ? "page" : undefined}
            onClick={(event) => visit("flow", event)}
          >
            <span aria-hidden="true">▷</span>進行
          </Link>
          <Link
            href="/chat"
            aria-current={current === "chat" ? "page" : undefined}
            onClick={(event) => visit("chat", event)}
          >
            <span aria-hidden="true">◇</span>うぃるに聞く
          </Link>
          <div className="page-menu-divider" />
          {onSettings ? (
            <button
              type="button"
              onClick={() => {
                close();
                onSettings();
              }}
            >
              <span aria-hidden="true">⚙</span>この機能の設定
            </button>
          ) : (
            <Link
              href="/settings"
              aria-current={current === "settings" ? "page" : undefined}
              onClick={(event) => visit("settings", event)}
            >
              <span aria-hidden="true">⚙</span>設定
            </Link>
          )}
          <Link
            href="/guide"
            aria-current={current === "guide" ? "page" : undefined}
            onClick={(event) => visit("guide", event)}
          >
            <span aria-hidden="true">?</span>使い方
          </Link>
        </div>
      )}
    </nav>
  );
}
