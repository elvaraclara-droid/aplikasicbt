import { describe, expect, it } from "vitest";
import { evaluateExamDeletion } from "@/lib/exams/deletion-guard";

describe("Exam Deletion Guard", () => {
  it("blocks deleting an active exam even when force is true", () => {
    const res = evaluateExamDeletion({
      status: "active",
      attemptsCount: 0,
      force: true,
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.status).toBe(409);
      expect(res.requiresForce).toBe(false);
      expect(res.error).toContain("active");
    }
  });

  it("allows deleting non-active exam with zero attempts without force", () => {
    const res = evaluateExamDeletion({
      status: "scheduled",
      attemptsCount: 0,
      force: false,
    });
    expect(res).toEqual({ allowed: true });
  });

  it("requires explicit force confirmation when exam already has student attempts", () => {
    const blocked = evaluateExamDeletion({
      status: "completed",
      attemptsCount: 15,
      force: false,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.status).toBe(409);
      expect(blocked.requiresForce).toBe(true);
      expect(blocked.attemptsCount).toBe(15);
    }

    const forced = evaluateExamDeletion({
      status: "completed",
      attemptsCount: 15,
      force: true,
    });
    expect(forced).toEqual({ allowed: true });
  });
});
