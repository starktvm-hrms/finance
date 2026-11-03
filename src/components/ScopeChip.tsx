import { go, type PageId } from "../lib/route";

/** "Showing only your work · Show all" bar for lists opened from a dashboard tile. */
export function ScopeChip({ label, page, params }: { label: string; page: PageId; params: URLSearchParams }) {
  const rest = Object.fromEntries([...params].filter(([k]) => k !== "by" && k !== "dept"));
  return (
    <div className="row gap">
      <span className="badge badge-info">Showing only {label}</span>
      <button className="btn ghost" onClick={() => go(page, rest)}>Show all</button>
    </div>
  );
}
