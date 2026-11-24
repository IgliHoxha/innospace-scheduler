import { pageList } from "@/lib/pagination";

/** The page controls under a paged list: the dashboard's and a member's own bookings. */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  shown,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  shown: number;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = (page - 1) * pageSize + shown;
  return (
    <div className="pagination">
      <span className="pagination-info">
        {first}-{lastRow} of {total}
        {loading ? " · loading…" : ""}
      </span>
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="page-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`page-btn ${p === page ? "active" : ""}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ),
          )}
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
