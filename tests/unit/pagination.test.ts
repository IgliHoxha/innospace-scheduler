import { describe, expect, it } from "vitest";
import {
  INITIAL_FILTER,
  PAGE_SIZE,
  pageCount,
  pageList,
} from "@/lib/pagination";

const GAP = "…";

describe("pagination constants", () => {
  it("opens the dashboard on every live row, 25 to a page", () => {
    expect(PAGE_SIZE).toBe(25);
    expect(INITIAL_FILTER).toBe("all");
  });
});

describe("pageCount", () => {
  it("is 1 for an empty list, so there is always a page to stand on", () => {
    expect(pageCount(0, 25)).toBe(1);
  });

  it("is 1 up to and including a full page", () => {
    expect(pageCount(1, 25)).toBe(1);
    expect(pageCount(24, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
  });

  it("adds a page for any remainder", () => {
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(49, 25)).toBe(2);
    expect(pageCount(50, 25)).toBe(2);
    expect(pageCount(51, 25)).toBe(3);
  });

  it("follows the page size it is given", () => {
    expect(pageCount(10, 2)).toBe(5);
    expect(pageCount(11, 2)).toBe(6);
    expect(pageCount(100, 100)).toBe(1);
  });
});

describe("pageList", () => {
  it("is a single page when there is only one", () => {
    expect(pageList(1, 1)).toEqual([1]);
  });

  it("is empty when there are no pages at all", () => {
    expect(pageList(1, 0)).toEqual([]);
  });

  it("lists every page when none is far enough to hide", () => {
    expect(pageList(1, 2)).toEqual([1, 2]);
    expect(pageList(2, 3)).toEqual([1, 2, 3]);
    expect(pageList(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("puts one gap on each side of a page in the middle", () => {
    expect(pageList(6, 20)).toEqual([1, GAP, 5, 6, 7, GAP, 20]);
  });

  it("shows only the far gap on the first page", () => {
    expect(pageList(1, 20)).toEqual([1, 2, GAP, 20]);
  });

  it("shows only the near gap on the last page", () => {
    expect(pageList(20, 20)).toEqual([1, GAP, 19, 20]);
  });

  it("marks a run of one hidden page as a gap too", () => {
    expect(pageList(1, 4)).toEqual([1, 2, GAP, 4]);
    expect(pageList(4, 6)).toEqual([1, GAP, 3, 4, 5, 6]);
  });

  it("drops the gap once the neighbours reach the end", () => {
    expect(pageList(3, 20)).toEqual([1, 2, 3, 4, GAP, 20]);
    expect(pageList(18, 20)).toEqual([1, GAP, 17, 18, 19, 20]);
  });

  it("always keeps the first and last page, and the current one", () => {
    for (let page = 1; page <= 12; page++) {
      const list = pageList(page, 12);
      expect(list[0]).toBe(1);
      expect(list[list.length - 1]).toBe(12);
      expect(list).toContain(page);
    }
  });

  it("never puts two gaps side by side", () => {
    for (let page = 1; page <= 30; page++) {
      const list = pageList(page, 30);
      list.forEach((item, i) => {
        if (item === GAP) expect(list[i + 1]).not.toBe(GAP);
      });
    }
  });

  it("uses the one-character ellipsis the pager compares against", () => {
    const gap = pageList(1, 20)[2];
    expect(gap).toBe("…");
    expect(String(gap)).toHaveLength(1);
  });

  it("still lists the ends when the current page is out of range", () => {
    expect(pageList(99, 5)).toEqual([1, GAP, 5]);
  });
});
