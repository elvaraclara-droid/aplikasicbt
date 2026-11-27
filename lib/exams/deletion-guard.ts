export interface ExamDeletionGuardInput {
  status: string;
  attemptsCount: number;
  force: boolean;
}

export type ExamDeletionGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 409;
      requiresForce: boolean;
      attemptsCount: number;
      error: string;
    };

/**
 * Evaluates whether an exam can be safely deleted or requires explicit force confirmation.
 */
export function evaluateExamDeletion(
  input: ExamDeletionGuardInput
): ExamDeletionGuardResult {
  if (input.status === "active") {
    return {
      allowed: false,
      status: 409,
      requiresForce: false,
      attemptsCount: input.attemptsCount,
      error:
        "Ujian berstatus active tidak dapat dihapus. Jeda, tutup, atau batalkan ujian terlebih dahulu.",
    };
  }

  if (input.attemptsCount > 0 && !input.force) {
    return {
      allowed: false,
      status: 409,
      requiresForce: true,
      attemptsCount: input.attemptsCount,
      error: `Ujian ini sudah memiliki ${input.attemptsCount} riwayat pengerjaan siswa. Centang konfirmasi hapus permanen jika ingin menghapus seluruh data ujian beserta nilainya.`,
    };
  }

  return { allowed: true };
}
