import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLog } from "@/lib/security/audit";
import {
  evaluateSchoolDeletion,
  type SchoolDeletionSummary,
} from "@/lib/schools/deletion-guard";

const uuidParamSchema = z.string().uuid();

const deleteSchoolBodySchema = z.object({
  confirmCode: z.string().min(1).max(64),
  force: z.boolean().optional().default(false),
});

async function loadSchoolSummary(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  schoolId: string
): Promise<{
  summary: SchoolDeletionSummary;
  userIdsToDelete: string[];
}> {
  const [
    { data: nonSuperProfiles, error: profErr },
    { count: teachersCount, error: tErr },
    { count: studentsCount, error: sErr },
    { count: banksCount, error: bErr },
    { count: examsCount, error: eErr },
    { count: activeExamsCount, error: aeErr },
    { count: activeAttemptsCount, error: aaErr },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id")
      .eq("school_id", schoolId)
      .neq("role", "super_admin"),
    admin
      .from("teachers")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId),
    admin
      .from("students")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId),
    admin
      .from("question_banks")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId),
    admin
      .from("exams")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId),
    admin
      .from("exams")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId)
      .eq("status", "active"),
    admin
      .from("exam_attempts")
      .select("id", { head: true, count: "exact" })
      .eq("school_id", schoolId)
      .in("status", ["NORMAL", "WARNING", "NEEDS_REVIEW", "RESUMED"]),
  ]);

  if (profErr || tErr || sErr || bErr || eErr || aeErr || aaErr) {
    throw new Error("Gagal memeriksa ringkasan data sekolah.");
  }

  const userIdsToDelete = (nonSuperProfiles || []).map((p) => p.id);

  return {
    summary: {
      usersCount: userIdsToDelete.length,
      teachersCount: teachersCount ?? 0,
      studentsCount: studentsCount ?? 0,
      banksCount: banksCount ?? 0,
      examsCount: examsCount ?? 0,
      activeExamsCount: activeExamsCount ?? 0,
      activeAttemptsCount: activeAttemptsCount ?? 0,
    },
    userIdsToDelete,
  };
}

/**
 * Returns deletion impact statistics for a specific school (Super Admin only).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoleApi(["super_admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!uuidParamSchema.safeParse(id).success) {
    return NextResponse.json({ error: "ID sekolah tidak valid" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: school } = await admin
    .from("schools")
    .select("id, code, name, education_level, city, status")
    .eq("id", id)
    .maybeSingle();

  if (!school) {
    return NextResponse.json({ error: "Sekolah tidak ditemukan" }, { status: 404 });
  }

  try {
    const { summary } = await loadSchoolSummary(admin, id);
    return NextResponse.json({ school, summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal memuat data sekolah" },
      { status: 500 }
    );
  }
}

/**
 * Permanently deletes a school tenant, its cascading database records, tenant storage assets,
 * and associated non-super-admin Auth user accounts.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoleApi(["super_admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!uuidParamSchema.safeParse(id).success) {
    return NextResponse.json({ error: "ID sekolah tidak valid" }, { status: 400 });
  }

  if (auth.ctx.profile.school_id === id) {
    return NextResponse.json(
      { error: "Akun Super Admin yang sedang masuk terikat ke sekolah ini." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = deleteSchoolBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Konfirmasi kode sekolah wajib dikirim." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: school } = await admin
    .from("schools")
    .select("id, code, name, logo_path")
    .eq("id", id)
    .maybeSingle();

  if (!school) {
    return NextResponse.json({ error: "Sekolah tidak ditemukan" }, { status: 404 });
  }

  let summary: SchoolDeletionSummary;
  let userIdsToDelete: string[];
  try {
    const loaded = await loadSchoolSummary(admin, id);
    summary = loaded.summary;
    userIdsToDelete = loaded.userIdsToDelete.filter(
      (uid) => uid !== auth.ctx.userId
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal memeriksa data sekolah" },
      { status: 500 }
    );
  }

  const guard = evaluateSchoolDeletion({
    schoolCode: school.code,
    confirmCode: parsedBody.data.confirmCode,
    summary,
    force: parsedBody.data.force,
  });

  if (!guard.allowed) {
    return NextResponse.json(
      {
        error: guard.error,
        requiresForce: guard.requiresForce,
        summary: guard.summary,
      },
      { status: guard.status }
    );
  }

  // Snapshot storage object paths before cascade delete removes DB rows.
  const [
    { data: mediaRows },
    { data: faceRows },
    { data: reportRows },
  ] = await Promise.all([
    admin
      .from("question_media")
      .select("bucket_name, storage_path")
      .eq("school_id", id),
    admin
      .from("face_verification_records")
      .select("snapshot_storage_path")
      .eq("school_id", id)
      .not("snapshot_storage_path", "is", null),
    admin
      .from("report_exports")
      .select("storage_path")
      .eq("school_id", id)
      .not("storage_path", "is", null),
  ]);

  // Delete the school first so all ON DELETE CASCADE child rows (including tables referencing profiles with ON DELETE RESTRICT)
  // are cleared before we remove the tenant's auth.users accounts.
  const { error: deleteErr } = await admin.from("schools").delete().eq("id", id);
  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message || "Gagal menghapus sekolah." },
      { status: 400 }
    );
  }

  // Best-effort cleanup of tenant storage objects grouped by bucket.
  const pathsByBucket = new Map<string, string[]>();
  const addPath = (bucket: string | null | undefined, storagePath: string | null | undefined) => {
    if (!bucket || !storagePath) return;
    const list = pathsByBucket.get(bucket) || [];
    list.push(storagePath);
    pathsByBucket.set(bucket, list);
  };

  if (school.logo_path) addPath("school-assets", school.logo_path);
  for (const m of mediaRows || []) addPath(m.bucket_name, m.storage_path);
  for (const f of faceRows || []) addPath("student-uploads", f.snapshot_storage_path);
  for (const r of reportRows || []) addPath("report-exports", r.storage_path);

  for (const [bucket, paths] of pathsByBucket.entries()) {
    for (let i = 0; i < paths.length; i += 100) {
      await admin.storage
        .from(bucket)
        .remove(paths.slice(i, i + 100))
        .catch(() => null);
    }
  }

  // Clean up Auth accounts (which cascades remaining profile rows cleanly without leaving orphaned logins).
  let deletedAuthUsersCount = 0;
  let failedAuthUsersCount = 0;
  for (let i = 0; i < userIdsToDelete.length; i += 10) {
    const chunk = userIdsToDelete.slice(i, i + 10);
    const results = await Promise.allSettled(
      chunk.map((uid) => admin.auth.admin.deleteUser(uid))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && !r.value.error) {
        deletedAuthUsersCount += 1;
      } else {
        failedAuthUsersCount += 1;
      }
    }
  }

  await recordAuditLog({
    schoolId: null,
    actorId: auth.ctx.userId,
    actorRole: "super_admin",
    action: "SCHOOL_DELETED",
    entityType: "schools",
    entityId: id,
    metadata: {
      code: school.code,
      name: school.name,
      summary,
      deletedAuthUsersCount,
      failedAuthUsersCount,
    },
  });

  return NextResponse.json({
    deletedSchoolId: id,
    deletedCode: school.code,
    deletedName: school.name,
    deletedAuthUsersCount,
    failedAuthUsersCount,
  });
}
