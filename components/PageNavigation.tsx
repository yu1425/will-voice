import Link from "next/link";
const pages = [
  {
    href: "/flow",
    label: "進行",
    path: "M5 5h14M5 12h14M5 19h14M8 3v4M16 10v4M10 17v4",
  },
  {
    href: "/guide",
    label: "使い方",
    path: "M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4ZM12 6v15",
  },
  {
    href: "/chat",
    label: "うぃるに聞く",
    path: "M4 4h16v13H9l-5 4V4ZM8 8h8M8 12h5",
  },
];
export default function PageNavigation({
  current,
  onNavigate,
}: {
  current: "flow" | "guide" | "chat";
  onNavigate?: () => void;
}) {
  return (
    <nav className="page-navigation" aria-label="ページ移動">
      {pages.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={p.href === `/${current}` ? "page" : undefined}
          onClick={onNavigate}
        >
          <svg
            viewBox="0 0 24 24"
            width="21"
            height="21"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={p.path} />
          </svg>
          <span>{p.label}</span>
        </Link>
      ))}
    </nav>
  );
}
