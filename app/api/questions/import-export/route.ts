import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  sanitizeRichHtml,
  stripHtmlToPlainText,
} from "@/lib/security/html-sanitizer";
import { recordAuditLog } from "@/lib/security/audit";
import { buildQuestionTemplateDocxBuffer } from "@/lib/questions/docx-template";
import { parseQuestionsFromDocxBuffer } from "@/lib/questions/docx-parser";
import type {
  DifficultyLevel,
  McmaScoringMode,
  QuestionType,
} from "@/types/database";

const MAX_DOCX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface ImportableQuestionItem {
  question_type: QuestionType;
  difficulty: DifficultyLevel;
  topic?: string | null;
  competency?: string | null;
  stem_html: string;
  has_math: boolean;
  default_weight: number;
  mcma_scoring_mode?: McmaScoringMode;
  explanation_html?: string | null;
  essay_rubric?: string | null;
  options?: Array<{
    option_label: string;
    content_html: string;
    is_correct: boolean;
  }>;
  statements?: Array<{
    statement_html: string;
    is_true: boolean;
    weight: number;
  }>;
}

const jsonImportSchema = z.object({
  bank_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  questions: z.array(
    z.object({
      question_type: z.enum(["single_choice", "mcma", "true_false", "essay"]),
      difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      topic: z.string().optional().nullable(),
      competency: z.string().optional().nullable(),
      stem_html: z.string().min(1),
      has_math: z.boolean().default(false),
      default_weight: z.number().positive().max(100).default(1),
      mcma_scoring_mode: z
        .enum(["exact_match", "partial_credit"])
        .default("partial_credit"),
      explanation_html: z.string().optional().nullable(),
      essay_rubric: z.string().optional().nullable(),
      options: z
        .array(
          z.object({
            option_label: z.string(),
            content_html: z.string(),
            is_correct: z.boolean(),
          })
        )
        .optional(),
      statements: z
        .array(
          z.object({
            statement_html: z.string(),
            is_true: z.boolean(),
            weight: z.number().positive().default(1),
          })
        )
        .optional(),
    })
  ),
});

async function verifyImportScope(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  schoolId: string;
  bankId: string;
  subjectId: string;
  role: string;
  userId: string;
}): Promise<NextResponse | null> {
  const { admin, schoolId, bankId, subjectId, role, userId } = params;

  const { data: bank } = await admin
    .from("question_banks")
    .select("id")
    .eq("id", bankId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (!bank) {
    return NextResponse.json(
      { error: "Bank soal tidak ditemukan pada sekolah ini." },
      { status: 404 }
    );
  }

  if (role === "teacher") {
    const { data: teacher } = await admin
      .from("teachers")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();

    if (teacher) {
      const { data: assigned } = await admin
        .from("teacher_subjects")
        .select("id")
        .eq("teacher_id", teacher.id)
        .eq("subject_id", subjectId)
        .eq("status", "active")
        .maybeSingle();

      if (!assigned) {
        return NextResponse.json(
          { error: "Guru tidak memiliki kewenangan pada mata pelajaran ini." },
          { status: 403 }
        );
      }
    }
  }

  return null;
}

async function insertImportedQuestions(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  schoolId: string;
  bankId: string;
  subjectId: string;
  userId: string;
  items: ImportableQuestionItem[];
}): Promise<number> {
  const { admin, schoolId, bankId, subjectId, userId, items } = params;
  let importedCount = 0;

  for (const item of items.slice(0, 200)) {
    const stem = sanitizeRichHtml(item.stem_html);
    const { data: q, error } = await admin
      .from("questions")
      .insert({
        school_id: schoolId,
        bank_id: bankId,
        subject_id: subjectId,
        question_type: item.question_type,
        difficulty: item.difficulty,
        topic: item.topic || null,
        competency: item.competency || null,
        stem_html: stem,
        stem_plain: stripHtmlToPlainText(stem),
        has_math: item.has_math,
        default_weight: item.default_weight,
        mcma_scoring_mode: item.mcma_scoring_mode || "partial_credit",
        explanation_html: item.explanation_html
          ? sanitizeRichHtml(item.explanation_html)
          : null,
        essay_rubric: item.essay_rubric || null,
        status: "active",
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();

    if (error || !q) continue;

    if (
      item.options?.length &&
      ["single_choice", "mcma"].includes(item.question_type)
    ) {
      await admin.from("question_options").insert(
        item.options.map((o, idx) => ({
          school_id: schoolId,
          question_id: q.id,
          option_label: o.option_label.toUpperCase(),
          content_html: sanitizeRichHtml(o.content_html),
          is_correct: o.is_correct,
          sort_order: idx,
          created_by: userId,
        }))
      );
    }

    if (item.statements?.length && item.question_type === "true_false") {
      await admin.from("question_statements").insert(
        item.statements.map((s, idx) => ({
          school_id: schoolId,
          question_id: q.id,
          statement_html: sanitizeRichHtml(s.statement_html),
          is_true: s.is_true,
          weight: s.weight,
          sort_order: idx,
          created_by: userId,
        }))
      );
    }

    importedCount++;
  }

  return importedCount;
}

export async function GET(request: NextRequest) {
  const auth = await requireRoleApi(["teacher", "school_admin", "super_admin"]);
  if (!auth.ok) return auth.response;

  const format = request.nextUrl.searchParams.get("format");
  if (format === "docx-template") {
    const buffer = await buildQuestionTemplateDocxBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition":
          'attachment; filename="template-bank-soal-cbt.docx"',
        "Cache-Control": "no-store",
      },
    });
  }

  const schoolId = auth.ctx.profile.school_id;
  if (!schoolId) {
    return NextResponse.json({ error: "school_id diperlukan" }, { status: 400 });
  }

  const bankId = request.nextUrl.searchParams.get("bankId");
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("questions")
    .select(
      "question_type, difficulty, topic, competency, stem_html, has_math, default_weight, mcma_scoring_mode, explanation_html, question_options(option_label, content_html, is_correct), question_statements(statement_html, is_true, weight)"
    )
    .eq("school_id", schoolId)
    .eq("status", "active");

  if (bankId) query = query.eq("bank_id", bankId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(
    JSON.stringify(
      { exportedAt: new Date().toISOString(), questions: data || [] },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="bank-soal-export.json"',
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireRoleApi(["teacher", "school_admin", "super_admin"]);
  if (!auth.ok) return auth.response;

  const schoolId = auth.ctx.profile.school_id;
  if (!schoolId) {
    return NextResponse.json({ error: "school_id diperlukan" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    const bankIdRaw = formData?.get("bank_id");
    const subjectIdRaw = formData?.get("subject_id");

    const idsSchema = z.object({
      bank_id: z.string().uuid(),
      subject_id: z.string().uuid(),
    });
    const idsParsed = idsSchema.safeParse({
      bank_id: bankIdRaw,
      subject_id: subjectIdRaw,
    });

    if (!idsParsed.success || !(file instanceof File)) {
      return NextResponse.json(
        { error: "File .docx, bank_id, dan subject_id wajib diisi" },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json(
        { error: "Hanya file Microsoft Word (.docx) yang didukung." },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_DOCX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Ukuran file .docx harus antara 1 byte hingga 10 MB." },
        { status: 400 }
      );
    }

    const scopeErr = await verifyImportScope({
      admin,
      schoolId,
      bankId: idsParsed.data.bank_id,
      subjectId: idsParsed.data.subject_id,
      role: auth.ctx.profile.role,
      userId: auth.ctx.userId,
    });
    if (scopeErr) return scopeErr;

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsedDocx = await parseQuestionsFromDocxBuffer(buffer);

    if (parsedDocx.questions.length === 0) {
      return NextResponse.json(
        {
          error:
            parsedDocx.errors[0] ||
            "Tidak ada soal valid yang ditemukan pada file .docx.",
          errors: parsedDocx.errors,
          warnings: parsedDocx.warnings,
        },
        { status: 400 }
      );
    }

    const importedCount = await insertImportedQuestions({
      admin,
      schoolId,
      bankId: idsParsed.data.bank_id,
      subjectId: idsParsed.data.subject_id,
      userId: auth.ctx.userId,
      items: parsedDocx.questions,
    });

    await recordAuditLog({
      schoolId,
      actorId: auth.ctx.userId,
      actorRole: auth.ctx.profile.role,
      action: "QUESTIONS_IMPORTED_DOCX",
      entityType: "question_banks",
      entityId: idsParsed.data.bank_id,
      metadata: {
        fileName: file.name,
        importedCount,
        skippedCount: parsedDocx.errors.length,
      },
    });

    return NextResponse.json({
      ok: true,
      format: "docx",
      importedCount,
      skippedCount: parsedDocx.errors.length,
      errors: parsedDocx.errors,
      warnings: parsedDocx.warnings,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = jsonImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Format JSON import soal tidak valid" },
      { status: 400 }
    );
  }

  const scopeErr = await verifyImportScope({
    admin,
    schoolId,
    bankId: parsed.data.bank_id,
    subjectId: parsed.data.subject_id,
    role: auth.ctx.profile.role,
    userId: auth.ctx.userId,
  });
  if (scopeErr) return scopeErr;

  const importedCount = await insertImportedQuestions({
    admin,
    schoolId,
    bankId: parsed.data.bank_id,
    subjectId: parsed.data.subject_id,
    userId: auth.ctx.userId,
    items: parsed.data.questions,
  });

  await recordAuditLog({
    schoolId,
    actorId: auth.ctx.userId,
    actorRole: auth.ctx.profile.role,
    action: "QUESTIONS_IMPORTED_JSON",
    entityType: "question_banks",
    entityId: parsed.data.bank_id,
    metadata: { importedCount },
  });

  return NextResponse.json({ ok: true, format: "json", importedCount });
}
