/**
 * Staged Load Test Orchestrator for CBT SMART EXAM
 * Stage A: /api/health -> live Supabase DB check at 50 / 100 / 250 / 500 concurrent requests
 * Stage B: Full Exam Lifecycle (login + token + start + payload + 4 autosaves + heartbeat)
 *          at staged VUs (25 & 50 concurrent students), with full post-test cleanup.
 *
 * Usage:
 *   node --env-file=.env.local scripts/run-staged-load-test.mjs
 */

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const TARGET_URL = (process.env.LOAD_TEST_TARGET_URL || "http://127.0.0.1:3201").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEPPER = process.env.TOKEN_HASH_PEPPER || SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hashToken(raw) {
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  return crypto.createHmac("sha256", PEPPER).update(`cbt-token:${norm}`).digest("hex");
}

async function runStage(args, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--env-file=.env.local", "scripts/load-test.mjs", ...args],
    { env: { ...process.env, ...extraEnv } }
  );
  if (stderr?.trim()) console.error(stderr.trim());
  console.log(stdout.trimEnd());
}

async function main() {
  console.log("==============================================================");
  console.log("PART A: Staged HTTP + Live Supabase Health Concurrency Probes");
  console.log(`Target: ${TARGET_URL}`);
  console.log("==============================================================");

  for (const users of [50, 100, 250, 500]) {
    await runStage([`--users=${users}`, `--target=${TARGET_URL}`, "--mode=health"]);
  }

  console.log("\n==============================================================");
  console.log("PART B: Full Exam Lifecycle Load Test (25 & 50 Concurrent VUs)");
  console.log("==============================================================");

  const VU_COUNT = 50;
  const studentPassword = `LoadTest#${crypto.randomBytes(4).toString("hex")}`;
  const rawToken = `LT${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const { data: school } = await admin.from("schools").select("id").eq("code", "SMAN1DEMO").single();
  const { data: subj } = await admin.from("subjects").select("id").eq("school_id", school.id).eq("code", "MTK-X").single();
  const { data: cls } = await admin.from("classes").select("id").eq("school_id", school.id).eq("code", "X-IPA-1").single();
  const { data: adminProfile } = await admin.from("profiles").select("id").eq("username", "admin.sman1").single();

  const createdUserIds = [];
  const createdStudentIds = [];
  let createdBankId = null;
  let createdQuestionIds = [];
  let createdExamId = null;

  try {
    const { data: bank } = await admin
      .from("question_banks")
      .insert({
        school_id: school.id,
        subject_id: subj.id,
        class_id: cls.id,
        title: `Bank LoadTest ${Date.now()}`,
        is_shared: true,
        created_by: adminProfile.id,
      })
      .select("id")
      .single();
    createdBankId = bank.id;

    for (let i = 1; i <= 5; i++) {
      const { data: q } = await admin
        .from("questions")
        .insert({
          school_id: school.id,
          bank_id: bank.id,
          subject_id: subj.id,
          class_id: cls.id,
          question_type: "single_choice",
          difficulty: "easy",
          stem_html: `<p>Soal uji beban nomor ${i}: hasil ${i} + ${i}?</p>`,
          stem_plain: `Soal uji beban nomor ${i}`,
          default_weight: 1,
          status: "active",
          created_by: adminProfile.id,
        })
        .select("id")
        .single();
      createdQuestionIds.push(q.id);
      await admin.from("question_options").insert([
        { school_id: school.id, question_id: q.id, option_label: "A", content_html: `<p>${i + i}</p>`, is_correct: true, sort_order: 0, created_by: adminProfile.id },
        { school_id: school.id, question_id: q.id, option_label: "B", content_html: `<p>${i + i + 1}</p>`, is_correct: false, sort_order: 1, created_by: adminProfile.id },
      ]);
    }

    const now = Date.now();
    const startsAt = new Date(now - 5 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 60 * 60 * 1000).toISOString();

    const { data: exam } = await admin
      .from("exams")
      .insert({
        school_id: school.id,
        subject_id: subj.id,
        class_id: cls.id,
        title: `Ujian Uji Beban ${now}`,
        exam_date: new Date().toISOString().slice(0, 10),
        starts_at: startsAt,
        ends_at: endsAt,
        duration_minutes: 60,
        total_questions: 5,
        status: "active",
        shuffle_questions: false,
        shuffle_options: false,
        face_verification_enabled: false,
        created_by: adminProfile.id,
      })
      .select("id")
      .single();
    createdExamId = exam.id;

    await admin.from("exam_questions").insert(
      createdQuestionIds.map((qId, idx) => ({
        school_id: school.id,
        exam_id: exam.id,
        question_id: qId,
        question_order: idx + 1,
        weight: 1,
        created_by: adminProfile.id,
      }))
    );

    const { data: session } = await admin
      .from("exam_sessions")
      .insert({
        school_id: school.id,
        exam_id: exam.id,
        session_number: 1,
        name: "Sesi Load Test",
        max_participants: 500,
        starts_at: startsAt,
        ends_at: endsAt,
        status: "active",
        created_by: adminProfile.id,
      })
      .select("id")
      .single();

    await admin.from("exam_tokens").insert({
      school_id: school.id,
      exam_id: exam.id,
      session_id: session.id,
      token_hash: hashToken(rawToken),
      token_hint: `${rawToken.slice(0, 2)}****${rawToken.slice(-2)}`,
      generation_mode: "auto",
      usage_policy: "session_shared",
      valid_from: startsAt,
      valid_until: endsAt,
      status: "active",
      created_by: adminProfile.id,
    });

    console.log(`Provisioning ${VU_COUNT} temporary loadtest students...`);
    for (let i = 1; i <= VU_COUNT; i++) {
      const username = `loadtest_stu_${i}`;
      const email = `${username}@auth.cbtsmartexam.internal`;
      const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      let uid = existing?.id;
      if (!uid) {
        const { data: created, error: uErr } = await admin.auth.admin.createUser({
          email,
          password: studentPassword,
          email_confirm: true,
          user_metadata: { role: "student", school_id: school.id, username },
        });
        if (uErr) throw uErr;
        uid = created.user.id;
        createdUserIds.push(uid);
        await admin.from("profiles").insert({
          id: uid,
          school_id: school.id,
          role: "student",
          username,
          auth_email: email,
          full_name: `Load Test Student ${i}`,
          status: "active",
          is_active: true,
        });
      } else {
        await admin.auth.admin.updateUserById(uid, { password: studentPassword });
      }

      const { data: stu } = await admin
        .from("students")
        .upsert({ school_id: school.id, profile_id: uid, class_id: cls.id, nis: `LT26${String(i).padStart(4, "0")}` }, { onConflict: "profile_id" })
        .select("id")
        .single();
      createdStudentIds.push(stu.id);
    }

    await admin.from("exam_session_students").upsert(
      createdStudentIds.map((studentId) => ({
        school_id: school.id,
        exam_id: exam.id,
        session_id: session.id,
        student_id: studentId,
        status: "enrolled",
        created_by: adminProfile.id,
      })),
      { onConflict: "exam_id,student_id" }
    );

    const sharedEnv = {
      LOAD_TEST_STUDENT_PASSWORD: studentPassword,
      LOAD_TEST_TOKEN: rawToken,
    };

    await runStage([`--users=25`, `--target=${TARGET_URL}`, "--mode=full-exam"], sharedEnv);
    await runStage([`--users=50`, `--target=${TARGET_URL}`, "--mode=full-exam"], sharedEnv);
  } finally {
    console.log("\nCleaning up temporary load test exam & virtual students...");
    if (createdExamId) await admin.from("exams").delete().eq("id", createdExamId);
    if (createdQuestionIds.length > 0) await admin.from("questions").delete().in("id", createdQuestionIds);
    if (createdBankId) await admin.from("question_banks").delete().eq("id", createdBankId);
    if (createdStudentIds.length > 0) await admin.from("students").delete().in("id", createdStudentIds);
    if (createdUserIds.length > 0) {
      await admin.from("profiles").delete().in("id", createdUserIds);
      for (const uid of createdUserIds) {
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
    await admin.from("auth_rate_limits").delete().neq("key", "");
    console.log("Cleanup completed.");
  }
}

main().catch((err) => {
  console.error("Staged load test failed:", err);
  process.exit(1);
});
