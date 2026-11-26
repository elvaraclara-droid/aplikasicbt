export type DeletableAcademicEntity =
  | "academic_year"
  | "semester"
  | "class"
  | "subject";

export interface DependencyCheckSpec {
  table: string;
  column: string;
  label: string;
}

export interface AcademicEntitySpec {
  table: string;
  label: string;
  auditAction: string;
  selectColumns: string;
  dependencies: DependencyCheckSpec[];
}

export interface DependencyUsage {
  table: string;
  label: string;
  count: number;
}

export const ACADEMIC_ENTITY_SPECS: Record<
  DeletableAcademicEntity,
  AcademicEntitySpec
> = {
  academic_year: {
    table: "academic_years",
    label: "Tahun pelajaran",
    auditAction: "ACADEMIC_YEAR_DELETED",
    selectColumns: "id, name",
    dependencies: [
      { table: "classes", column: "academic_year_id", label: "kelas" },
      {
        table: "teacher_subjects",
        column: "academic_year_id",
        label: "penugasan guru",
      },
      { table: "exams", column: "academic_year_id", label: "jadwal ujian" },
    ],
  },
  semester: {
    table: "semesters",
    label: "Semester",
    auditAction: "ACADEMIC_SEMESTER_DELETED",
    selectColumns: "id, name",
    dependencies: [
      {
        table: "teacher_subjects",
        column: "semester_id",
        label: "penugasan guru",
      },
      { table: "exams", column: "semester_id", label: "jadwal ujian" },
    ],
  },
  class: {
    table: "classes",
    label: "Kelas",
    auditAction: "ACADEMIC_CLASS_DELETED",
    selectColumns: "id, code, name",
    dependencies: [
      { table: "students", column: "class_id", label: "siswa" },
      {
        table: "teacher_subjects",
        column: "class_id",
        label: "penugasan guru",
      },
      { table: "question_banks", column: "class_id", label: "bank soal" },
      { table: "questions", column: "class_id", label: "soal" },
      { table: "exams", column: "class_id", label: "jadwal ujian" },
    ],
  },
  subject: {
    table: "subjects",
    label: "Mata pelajaran",
    auditAction: "ACADEMIC_SUBJECT_DELETED",
    selectColumns: "id, code, name",
    dependencies: [
      {
        table: "teacher_subjects",
        column: "subject_id",
        label: "penugasan guru",
      },
      {
        table: "question_categories",
        column: "subject_id",
        label: "kategori soal",
      },
      { table: "question_banks", column: "subject_id", label: "bank soal" },
      { table: "questions", column: "subject_id", label: "soal" },
      { table: "exams", column: "subject_id", label: "jadwal ujian" },
    ],
  },
};

export interface QueryError {
  message: string;
}

export interface CountResult {
  count: number | null;
  error: QueryError | null;
}

export interface RowsResult {
  data: Array<Record<string, unknown>> | null;
  error: QueryError | null;
}

export interface SingleResult {
  data: Record<string, unknown> | null;
  error: QueryError | null;
}

export interface MutationResult {
  error: QueryError | null;
}

export interface SelectFilterChain extends PromiseLike<RowsResult> {
  eq(column: string, value: string): SelectFilterChain;
  in(column: string, values: string[]): PromiseLike<CountResult> & {
    eq(column: string, value: string): PromiseLike<CountResult>;
  };
  maybeSingle(): PromiseLike<SingleResult>;
}

export interface CountFilterChain extends PromiseLike<CountResult> {
  eq(column: string, value: string): CountFilterChain;
  in(column: string, values: string[]): CountFilterChain;
}

export interface DeleteFilterChain extends PromiseLike<MutationResult> {
  eq(column: string, value: string): DeleteFilterChain;
}

export interface TableQueryBuilder {
  select(
    columns: string,
    options: { count: "exact" | "planned" | "estimated"; head: true }
  ): CountFilterChain;
  select(columns: string): SelectFilterChain;
  delete(): DeleteFilterChain;
}

export interface AcademicQueryClient {
  from(table: string): TableQueryBuilder;
}

export type DeleteAcademicResult =
  | {
      ok: true;
      entity: DeletableAcademicEntity;
      entityType: string;
      auditAction: string;
      deletedId: string;
      deletedLabel: string;
      deletedCode: string | null;
      deletedSemestersCount: number;
    }
  | {
      ok: false;
      status: 404 | 409 | 500;
      error: string;
      usages?: DependencyUsage[];
    };

/**
 * Format a clear Indonesian 409 conflict message listing all blocking usages.
 */
export function buildDeletionConflictMessage(
  entityLabel: string,
  usages: DependencyUsage[]
): string {
  const parts = usages
    .filter((u) => u.count > 0)
    .map((u) => `${u.count} ${u.label}`);

  if (parts.length === 0) {
    return `${entityLabel} tidak dapat dihapus karena masih digunakan.`;
  }

  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} dan ${parts[parts.length - 1]}`;

  return `${entityLabel} tidak dapat dihapus karena masih digunakan oleh ${joined}.`;
}

async function countDependency(
  client: AcademicQueryClient,
  schoolId: string,
  dep: DependencyCheckSpec,
  targetIds: string[]
): Promise<{ usage: DependencyUsage | null; error: QueryError | null }> {
  const baseQuery = client
    .from(dep.table)
    .select("id", { head: true, count: "exact" })
    .eq("school_id", schoolId);

  const filtered =
    targetIds.length === 1
      ? baseQuery.eq(dep.column, targetIds[0])
      : baseQuery.in(dep.column, targetIds);

  const { count, error } = await filtered;
  if (error) {
    return { usage: null, error };
  }

  if ((count ?? 0) > 0) {
    return {
      usage: { table: dep.table, label: dep.label, count: count ?? 0 },
      error: null,
    };
  }

  return { usage: null, error: null };
}

async function collectAcademicYearSemesterUsages(
  client: AcademicQueryClient,
  schoolId: string,
  academicYearId: string
): Promise<{
  semestersCount: number;
  usages: DependencyUsage[];
  error: QueryError | null;
}> {
  const { data: semesters, error: semErr } = await client
    .from("semesters")
    .select("id")
    .eq("school_id", schoolId)
    .eq("academic_year_id", academicYearId);

  if (semErr) {
    return { semestersCount: 0, usages: [], error: semErr };
  }

  const semesterIds = (semesters || [])
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);

  if (semesterIds.length === 0) {
    return { semestersCount: 0, usages: [], error: null };
  }

  // Child semesters cascade-delete with academic_year; ensure none are referenced by exams or teacher assignments.
  const semesterDeps = ACADEMIC_ENTITY_SPECS.semester.dependencies;
  const checks = await Promise.all(
    semesterDeps.map((dep) =>
      countDependency(client, schoolId, dep, semesterIds)
    )
  );

  const firstError = checks.find((c) => c.error)?.error ?? null;
  if (firstError) {
    return { semestersCount: semesterIds.length, usages: [], error: firstError };
  }

  const usages = checks
    .map((c) => c.usage)
    .filter((u): u is DependencyUsage => u !== null)
    .map((u) => ({
      ...u,
      label: `${u.label} (pada semester terkait)`,
    }));

  return { semestersCount: semesterIds.length, usages, error: null };
}

/**
 * Safely deletes an academic entity within a tenant after verifying ownership and dependency links.
 */
export async function deleteAcademicEntity(
  client: AcademicQueryClient,
  params: {
    schoolId: string;
    entity: DeletableAcademicEntity;
    id: string;
  }
): Promise<DeleteAcademicResult> {
  const { schoolId, entity, id } = params;
  const spec = ACADEMIC_ENTITY_SPECS[entity];

  const { data: existing, error: fetchErr } = await client
    .from(spec.table)
    .select(spec.selectColumns)
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (fetchErr) {
    return {
      ok: false,
      status: 500,
      error: `Gagal memeriksa data ${spec.label.toLowerCase()}.`,
    };
  }

  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: `${spec.label} tidak ditemukan pada sekolah ini.`,
    };
  }

  const directChecks = await Promise.all(
    spec.dependencies.map((dep) => countDependency(client, schoolId, dep, [id]))
  );

  const directError = directChecks.find((c) => c.error)?.error;
  if (directError) {
    return {
      ok: false,
      status: 500,
      error: "Gagal memeriksa relasi data sebelum menghapus.",
    };
  }

  const usages: DependencyUsage[] = directChecks
    .map((c) => c.usage)
    .filter((u): u is DependencyUsage => u !== null);

  let deletedSemestersCount = 0;
  if (entity === "academic_year") {
    const semCheck = await collectAcademicYearSemesterUsages(
      client,
      schoolId,
      id
    );
    if (semCheck.error) {
      return {
        ok: false,
        status: 500,
        error: "Gagal memeriksa relasi semester pada tahun pelajaran.",
      };
    }
    deletedSemestersCount = semCheck.semestersCount;
    usages.push(...semCheck.usages);
  }

  if (usages.length > 0) {
    return {
      ok: false,
      status: 409,
      error: buildDeletionConflictMessage(spec.label, usages),
      usages,
    };
  }

  const { error: deleteErr } = await client
    .from(spec.table)
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);

  if (deleteErr) {
    return {
      ok: false,
      status: 409,
      error: `${spec.label} gagal dihapus karena masih terkait dengan data lain.`,
    };
  }

  const deletedLabel =
    typeof existing.name === "string" && existing.name.trim()
      ? existing.name
      : id;
  const deletedCode =
    typeof existing.code === "string" ? existing.code : null;

  return {
    ok: true,
    entity,
    entityType: spec.table,
    auditAction: spec.auditAction,
    deletedId: id,
    deletedLabel,
    deletedCode,
    deletedSemestersCount,
  };
}
