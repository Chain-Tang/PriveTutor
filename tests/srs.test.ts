import { describe, expect, it } from "vitest";
import {
  dueCells,
  initReviewState,
  isDue,
  scheduleNext,
  type ReviewState
} from "../src/srs.js";

const NOW = "2026-06-15T00:00:00.000Z";
const plus = (days: number): string =>
  new Date(Date.parse(NOW) + days * 86_400_000).toISOString();

describe("initReviewState", () => {
  it("starts due now with the default ease", () => {
    const s = initReviewState(NOW);
    expect(s).toEqual({ ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: NOW });
  });
});

describe("scheduleNext (SM-2)", () => {
  it("expands the interval 1 → 6 → 15 on successive 'good' recalls", () => {
    const a = scheduleNext(initReviewState(NOW), "good", NOW);
    expect(a.intervalDays).toBe(1);
    expect(a.reps).toBe(1);
    expect(a.dueAt).toBe(plus(1));
    expect(a.ease).toBe(2.5); // q=4 leaves ease unchanged
    expect(a.lastReviewedAt).toBe(NOW);

    const b = scheduleNext(a, "good", NOW);
    expect(b.intervalDays).toBe(6);
    expect(b.reps).toBe(2);

    const c = scheduleNext(b, "good", NOW);
    expect(c.intervalDays).toBe(15); // round(6 × 2.5)
    expect(c.reps).toBe(3);
    expect(c.dueAt).toBe(plus(15));
  });

  it("raises ease on 'easy' and lowers it on 'hard'", () => {
    expect(scheduleNext(initReviewState(NOW), "easy", NOW).ease).toBe(2.6);
    expect(scheduleNext(initReviewState(NOW), "hard", NOW).ease).toBe(2.36);
  });

  it("resets the streak and counts a lapse on 'again'", () => {
    const studied: ReviewState = {
      ease: 2.5,
      intervalDays: 15,
      reps: 3,
      lapses: 0,
      dueAt: NOW
    };
    const lapsed = scheduleNext(studied, "again", NOW);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueAt).toBe(plus(1));
    expect(lapsed.ease).toBe(2.18); // q=2 → −0.32
  });

  it("never lets ease fall below 1.3", () => {
    let s = initReviewState(NOW);
    for (let i = 0; i < 20; i += 1) s = scheduleNext(s, "again", NOW);
    expect(s.ease).toBe(1.3);
  });
});

describe("isDue / dueCells", () => {
  it("is due when dueAt is at or before now", () => {
    expect(isDue({ ...initReviewState(plus(-1)) }, NOW)).toBe(true);
    expect(isDue({ ...initReviewState(NOW), dueAt: plus(3) }, NOW)).toBe(false);
  });

  it("treats an unscheduled cell as due and filters future ones out", () => {
    const cells = [
      { id: "a" }, // no review → due
      { id: "b", review: { ...initReviewState(NOW), dueAt: plus(-2) } },
      { id: "c", review: { ...initReviewState(NOW), dueAt: plus(5) } }
    ];
    expect(dueCells(cells, NOW).map((c) => c.id)).toEqual(["a", "b"]);
  });
});
