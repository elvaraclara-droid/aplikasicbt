export interface SchoolDeletionSummary {
  usersCount: number;
  teachersCount: number;
  studentsCount: number;
  banksCount: number;
  examsCount: number;
  activeExamsCount: number;
  activeAttemptsCount: number;
}

export interface SchoolDeletionGuardInput {
  schoolCode: string;
  confirmCode: string;
  summary: SchoolDeletionSummary;
  force: boolean;
}

export type SchoolDeletionGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 400 | 409;
      requiresForce: boolean;
      summary: SchoolDeletionSummary;
      error: string;
    };

/**
 * Computes total tenant-owned entities across users, banks, and exams for deletion confirmation.
 */
export function countRelatedSchoolData(summary: SchoolDeletionSummary): number {
  return (
    summary.usersCount +
    summary.teachersCount +
    summary.studentsCount +
    summary.banksCount +
    summary.examsCount
  );
}

/**
 * Evaluates whether a school tenant can be permanently deleted without risking live exam data
 * or accidental unconfirmed wipes.
 */
export function evaluateSchoolDeletion(
  input: SchoolDeletionGuardInput
): SchoolDeletionGuardResult {
  if (
    input.summary.activeExamsCount > 0 ||
    input.summary.activeAttemptsCount > 0
  ) {
    return {
      allowed: false,
      status: 409,
      requiresForce: false,
      summary: input.summary,
      error:
        "Sekolah ini masih memiliki ujian aktif atau peserta yang sedang mengerjakan ujian. Tutup atau hentikan ujian aktif terlebih dahulu.",
    };
  }

  const normalizedExpected = input.schoolCode.trim().toUpperCase();
  const normalizedProvided = input.confirmCode.trim().toUpperCase();
  if (!normalizedExpected || normalizedProvided !== normalizedExpected) {
    return {
      allowed: false,
      status: 400,
      requiresForce: false,
      summary: input.summary,
      error: `Ketik kode sekolah "${normalizedExpected}" secara tepat untuk konfirmasi penghapusan.`,
    };
  }

  const relatedCount = countRelatedSchoolData(input.summary);
  if (relatedCount > 0 && !input.force) {
    return {
      allowed: false,
      status: 409,
      requiresForce: true,
      summary: input.summary,
      error:
        "Sekolah masih memiliki data pengguna, bank soal, atau ujian terkait. Centang konfirmasi hapus permanen untuk melanjutkan.",
    };
  }

  return { allowed: true };
}
