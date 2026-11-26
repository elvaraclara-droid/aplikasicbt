import { describe, expect, it } from "vitest";
import {
  buildDeletionConflictMessage,
  deleteAcademicEntity,
  type AcademicQueryClient,
  type QueryError,
} from "@/lib/academic/deletion-guard";

interface MockTableData {
  existing?: Record<string, unknown> | null;
  rows?: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
  errorTables?: Record<string, QueryError>;
}

function createMockClient(config: MockTableData) {
  const deletedCalls: Array<{
    table: string;
    filters: Array<{ op: string; col: string; val: unknown }>;
  }> = [];

  const client: AcademicQueryClient = {
    from(table: string) {
      return {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          const filters: Array<{ op: string; col: string; val: unknown }> = [];

          const executeCount = async () => {
            if (config.errorTables?.[table]) {
              return { count: null, error: config.errorTables[table] };
            }
            return { count: config.counts?.[table] ?? 0, error: null };
          };

          const executeRows = async () => {
            if (config.errorTables?.[table]) {
              return { data: null, error: config.errorTables[table] };
            }
            return { data: config.rows ?? [], error: null };
          };

          const chain = {
            eq(column: string, value: string) {
              filters.push({ op: "eq", col: column, val: value });
              return chain;
            },
            in(column: string, values: string[]) {
              filters.push({ op: "in", col: column, val: values });
              return {
                eq(c: string, v: string) {
                  filters.push({ op: "eq", col: c, val: v });
                  return executeCount();
                },
                then<TResult1 = unknown, TResult2 = never>(
                  onfulfilled?:
                    | ((value: {
                        count: number | null;
                        error: QueryError | null;
                      }) => TResult1 | PromiseLike<TResult1>)
                    | null,
                  onrejected?:
                    | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                    | null
                ) {
                  return executeCount().then(onfulfilled, onrejected);
                },
              };
            },
            maybeSingle() {
              const hasSchoolMatch =
                config.existing &&
                filters.every(
                  (f) =>
                    f.op !== "eq" ||
                    !(f.col in config.existing!) ||
                    config.existing![f.col] === f.val
                );
              const payload =
                config.errorTables?.[table]
                  ? { data: null, error: config.errorTables[table] }
                  : {
                      data: hasSchoolMatch ? config.existing! : null,
                      error: null,
                    };
              return Promise.resolve(payload);
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null
            ) {
              const runner = options?.head ? executeCount() : executeRows();
              return runner.then(onfulfilled, onrejected);
            },
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return chain as any;
        },
        delete() {
          const filters: Array<{ op: string; col: string; val: unknown }> = [];
          const deleteChain = {
            eq(column: string, value: string) {
              filters.push({ op: "eq", col: column, val: value });
              return deleteChain;
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?:
                | ((value: { error: QueryError | null }) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null
            ) {
              deletedCalls.push({ table, filters });
              const res = {
                error: config.errorTables?.[`delete:${table}`] ?? null,
              };
              return Promise.resolve(res).then(onfulfilled, onrejected);
            },
          };
          return deleteChain;
        },
      };
    },
  };

  return { client, deletedCalls };
}

describe("Academic Entity Deletion Guard", () => {
  it("formats Indonesian conflict messages cleanly", () => {
    expect(buildDeletionConflictMessage("Mata pelajaran", [])).toBe(
      "Mata pelajaran tidak dapat dihapus karena masih digunakan."
    );
    expect(
      buildDeletionConflictMessage("Kelas", [
        { table: "students", label: "siswa", count: 12 },
      ])
    ).toBe("Kelas tidak dapat dihapus karena masih digunakan oleh 12 siswa.");
    expect(
      buildDeletionConflictMessage("Mata pelajaran", [
        { table: "question_banks", label: "bank soal", count: 2 },
        { table: "questions", label: "soal", count: 15 },
        { table: "exams", label: "jadwal ujian", count: 1 },
      ])
    ).toBe(
      "Mata pelajaran tidak dapat dihapus karena masih digunakan oleh 2 bank soal, 15 soal dan 1 jadwal ujian."
    );
  });

  it("returns 404 when entity belongs to a different school or does not exist", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "11111111-1111-4111-8111-111111111111",
        school_id: "school-b",
        code: "BIO-X",
        name: "Biologi",
      },
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "subject",
      id: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    expect(deletedCalls).toHaveLength(0);
  });

  it("blocks deleting a subject that is still used by question banks or exams", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "11111111-1111-4111-8111-111111111111",
        school_id: "school-a",
        code: "MTK-X",
        name: "Matematika Wajib",
      },
      counts: {
        question_banks: 1,
        questions: 5,
      },
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "subject",
      id: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("1 bank soal dan 5 soal");
    }
    expect(deletedCalls).toHaveLength(0);
  });

  it("blocks deleting a class with enrolled students", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "22222222-2222-4222-8222-222222222222",
        school_id: "school-a",
        code: "X-IPA-1",
        name: "X IPA 1",
      },
      counts: {
        students: 30,
      },
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "class",
      id: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("30 siswa");
    }
    expect(deletedCalls).toHaveLength(0);
  });

  it("blocks deleting an academic year when one of its semesters is used by an exam", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "33333333-3333-4333-8333-333333333333",
        school_id: "school-a",
        name: "2026/2027",
      },
      rows: [{ id: "44444444-4444-4444-8444-444444444444" }],
      counts: {
        exams: 2,
      },
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "academic_year",
      id: "33333333-3333-4333-8333-333333333333",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("jadwal ujian");
    }
    expect(deletedCalls).toHaveLength(0);
  });

  it("fails closed when a dependency query errors", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "22222222-2222-4222-8222-222222222222",
        school_id: "school-a",
        code: "X-IPA-1",
        name: "X IPA 1",
      },
      errorTables: {
        students: { message: "connection timeout" },
      },
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "class",
      id: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
    expect(deletedCalls).toHaveLength(0);
  });

  it("deletes an unused academic entity with tenant filter and reports cascaded semesters", async () => {
    const { client, deletedCalls } = createMockClient({
      existing: {
        id: "33333333-3333-4333-8333-333333333333",
        school_id: "school-a",
        name: "2027/2028",
      },
      rows: [{ id: "44444444-4444-4444-8444-444444444444" }],
      counts: {},
    });

    const result = await deleteAcademicEntity(client, {
      schoolId: "school-a",
      entity: "academic_year",
      id: "33333333-3333-4333-8333-333333333333",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditAction).toBe("ACADEMIC_YEAR_DELETED");
      expect(result.deletedLabel).toBe("2027/2028");
      expect(result.deletedSemestersCount).toBe(1);
    }
    expect(deletedCalls).toEqual([
      {
        table: "academic_years",
        filters: [
          { op: "eq", col: "id", val: "33333333-3333-4333-8333-333333333333" },
          { op: "eq", col: "school_id", val: "school-a" },
        ],
      },
    ]);
  });
});
