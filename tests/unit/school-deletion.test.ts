import { describe, expect, it } from "vitest";
import {
  countRelatedSchoolData,
  evaluateSchoolDeletion,
  type SchoolDeletionSummary,
} from "@/lib/schools/deletion-guard";

const emptySummary: SchoolDeletionSummary = {
  usersCount: 0,
  teachersCount: 0,
  studentsCount: 0,
  banksCount: 0,
  examsCount: 0,
  activeExamsCount: 0,
  activeAttemptsCount: 0,
};

describe("School Deletion Guard", () => {
  it("blocks deleting a school that still has active exams or ongoing student attempts", () => {
    const blocked = evaluateSchoolDeletion({
      schoolCode: "SMAN1DEMO",
      confirmCode: "SMAN1DEMO",
      summary: { ...emptySummary, examsCount: 1, activeAttemptsCount: 3 },
      force: true,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.status).toBe(409);
      expect(blocked.requiresForce).toBe(false);
    }
  });

  it("rejects deletion when confirmation school code does not match", () => {
    const blocked = evaluateSchoolDeletion({
      schoolCode: "SMAN1DEMO",
      confirmCode: "WRONG",
      summary: emptySummary,
      force: false,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.status).toBe(400);
    }
  });

  it("requires explicit force confirmation when school has related data", () => {
    const populated: SchoolDeletionSummary = {
      ...emptySummary,
      usersCount: 5,
      studentsCount: 3,
      banksCount: 1,
    };
    expect(countRelatedSchoolData(populated)).toBe(9);

    const needsForce = evaluateSchoolDeletion({
      schoolCode: "SMAN1DEMO",
      confirmCode: "sman1demo",
      summary: populated,
      force: false,
    });
    expect(needsForce.allowed).toBe(false);
    if (!needsForce.allowed) {
      expect(needsForce.status).toBe(409);
      expect(needsForce.requiresForce).toBe(true);
    }

    const forced = evaluateSchoolDeletion({
      schoolCode: "SMAN1DEMO",
      confirmCode: "sman1demo",
      summary: populated,
      force: true,
    });
    expect(forced).toEqual({ allowed: true });
  });

  it("allows deleting an empty school once code confirmation matches", () => {
    const res = evaluateSchoolDeletion({
      schoolCode: "TMP01",
      confirmCode: " tmp01 ",
      summary: emptySummary,
      force: false,
    });
    expect(res).toEqual({ allowed: true });
  });
});
