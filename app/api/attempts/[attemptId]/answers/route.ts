import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireFastStudentExamSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const singleAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionId: z.string().uuid().nullable().optional(),
  selectedOptionIds: z.array(z.string().uuid()).optional(),
  statementAnswers: z.record(z.boolean()).optional(),
  essayAnswer: z.string().max(25000).nullable().optional(),
  isFlagged: z.boolean().default(false),
  isAnswered: z.boolean().default(false),
  answerVersion: z.number().int().min(1),
  idempotencyKey: z.string().min(4).max(128),
  clientUpdatedAt: z.string().optional(),
});

const batchOrSingleSchema = z.union([
  singleAnswerSchema,
  z.object({
    items: z.array(singleAnswerSchema).min(1).max(200),
  }),
]);

interface BatchSavedRow {
  question_id: string;
  answer_id: string;
  persisted_version: number;
  conflict_detected: boolean;
  saved_at: string;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const auth = await requireFastStudentExamSession(request);
  if (!auth.ok) return auth.response;

  const { attemptId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = batchOrSingleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Format payload jawaban tidak valid." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: student } = await admin
    .from("students")
    .select("id")
    .eq("profile_id", auth.ctx.userId)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  }

  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id, school_id, exam_id, session_id, student_id, status, deadline_at")
    .eq("id", attemptId)
    .eq("student_id", student.id)
    .single();

  if (!attempt) {
    return NextResponse.json({ error: "Attempt tidak ditemukan" }, { status: 404 });
  }

  if (
    ["SUBMITTED", "TERMINATED", "PAUSED", "LOCKED", "PENDING_SUPERVISOR_APPROVAL"].includes(
      attempt.status
    )
  ) {
    return NextResponse.json(
      { error: `Jawaban tidak dapat disimpan saat status ujian "${attempt.status}".` },
      { status: 409 }
    );
  }

  // Enforce server deadline with 25s reconnect grace for pre-deadline/in-flight batch flushes
  const now = new Date();
  if (attempt.deadline_at && now.getTime() > new Date(attempt.deadline_at).getTime() + 25000) {
    return NextResponse.json(
      { error: "Batas waktu ujian telah berakhir di server." },
      { status: 409 }
    );
  }

  const items = "items" in parsed.data ? parsed.data.items : [parsed.data];
  const versionMap = new Map(items.map((item) => [item.questionId, item.answerVersion]));

  const rpcItems = items.map((item) => ({
    question_id: item.questionId,
    selected_option_id: item.selectedOptionId ?? null,
    selected_option_ids: item.selectedOptionIds ?? [],
    statement_answers: item.statementAnswers ?? {},
    essay_answer: item.essayAnswer ?? null,
    is_flagged: item.isFlagged,
    is_answered: item.isAnswered,
    answer_version: item.answerVersion,
    idempotency_key: item.idempotencyKey,
    client_updated_at: item.clientUpdatedAt || now.toISOString(),
  }));

  const { data, error } = await admin.rpc("save_student_answers_batch", {
    p_school_id: attempt.school_id,
    p_exam_id: attempt.exam_id,
    p_session_id: attempt.session_id,
    p_student_id: attempt.student_id,
    p_attempt_id: attempt.id,
    p_items: rpcItems,
    p_actor_id: auth.ctx.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const savedRows = (Array.isArray(data) ? data : data ? [data] : []) as BatchSavedRow[];
  const conflictLogs = savedRows
    .filter((row) => row.conflict_detected)
    .map((row) => ({
      school_id: attempt.school_id,
      exam_id: attempt.exam_id,
      session_id: attempt.session_id,
      attempt_id: attempt.id,
      student_id: attempt.student_id,
      user_id: auth.ctx.userId,
      activity_type: "ANSWER_VERSION_CONFLICT_RESOLVED",
      description: `Versi jawaban klien (${versionMap.get(row.question_id) ?? "?"}) lebih lama dari server (${row.persisted_version}); versi server dipertahankan.`,
      metadata: { question_id: row.question_id },
    }));

  if (conflictLogs.length > 0) {
    await admin.from("exam_activity_logs").insert(conflictLogs);
  }

  return NextResponse.json({
    ok: true,
    serverTimestamp: now.toISOString(),
    results: savedRows.map((row) => ({
      questionId: row.question_id,
      answer_id: row.answer_id,
      persisted_version: row.persisted_version,
      conflict_detected: row.conflict_detected,
      saved_at: row.saved_at,
    })),
  });
}
