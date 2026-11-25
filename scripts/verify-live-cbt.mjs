/**
 * Live Integration, RBAC/RLS Isolation, Anti-Cheating & Grading E2E Verifier
 * Usage:
 *   node --env-file=.env.local scripts/verify-live-cbt.mjs
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TARGET_URL = (process.env.VERIFY_TARGET_URL || "http://127.0.0.1:3201").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "CbtVerify#2026!";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createCookieSession() {
  const jar = new Map();

  function mergeCookies(headers) {
    const rawCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const raw of rawCookies) {
      const pair = raw.split(";")[0];
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const k = pair.slice(0, eqIdx).trim();
        const v = pair.slice(eqIdx + 1).trim();
        if (!v) jar.delete(k);
        else jar.set(k, v);
      }
    }
  }

  async function req(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.size > 0) {
      headers["Cookie"] = Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    const res = await fetch(`${TARGET_URL}${path}`, { ...options, headers });
    mergeCookies(res.headers);
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");
    return { status: res.status, ok: res.ok, headers: res.headers, data };
  }

  return { req };
}

async function ensureKnownPasswords() {
  const usernames = ["superadmin", "admin.sman1", "guru.matematika", "pengawas.ruang1", "202601001"];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username")
    .in("username", usernames);

  assert.equal((profiles || []).length, usernames.length, "All 5 seeded roles must exist before verification");
  for (const p of profiles || []) {
    const { error } = await admin.auth.admin.updateUserById(p.id, { password: TEST_PASSWORD });
    assert.ifError(error);
  }
  await admin.from("auth_rate_limits").delete().neq("key", "");
}

async function runRlsIsolationChecks() {
  console.log("[1/5] Verifying live PostgreSQL RLS & Cross-Tenant Isolation (anon key)...");

  // 1a. Anon client blocked from private operational tables
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const tbl of ["profiles", "questions", "question_options", "question_statements", "exam_tokens", "audit_logs"]) {
    const { data } = await anonClient.from(tbl).select("id").limit(5);
    assert.equal((data || []).length, 0, `Anon should see 0 rows in ${tbl}`);
  }

  // 1b. Student client isolated from answer keys, tokens, audit_logs
  const studentClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: stuSignInErr } = await studentClient.auth.signInWithPassword({
    email: "202601001@auth.cbtsmartexam.internal",
    password: TEST_PASSWORD,
  });
  assert.ifError(stuSignInErr);

  for (const restrictedTbl of ["question_options", "question_statements", "exam_tokens", "audit_logs"]) {
    const { data } = await studentClient.from(restrictedTbl).select("id").limit(5);
    assert.equal((data || []).length, 0, `Student must see 0 rows in ${restrictedTbl}`);
  }

  // 1c. Supervisor client isolated from answer keys & tokens
  const supClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: supSignInErr } = await supClient.auth.signInWithPassword({
    email: "pengawas.ruang1@auth.cbtsmartexam.internal",
    password: TEST_PASSWORD,
  });
  assert.ifError(supSignInErr);

  for (const restrictedTbl of ["question_options", "question_statements", "exam_tokens"]) {
    const { data } = await supClient.from(restrictedTbl).select("id").limit(5);
    assert.equal((data || []).length, 0, `Supervisor must see 0 rows in ${restrictedTbl}`);
  }

  // 1d. Cross-school isolation: School B admin cannot read School A (SMAN1DEMO) students/classes
  const isoCode = `ISO_${Date.now().toString().slice(-6)}`;
  const isoUserEmail = `${isoCode.toLowerCase()}@auth.cbtsmartexam.internal`;
  let schoolBId = null;
  let adminBUserId = null;
  try {
    const { data: schoolB, error: sbErr } = await admin
      .from("schools")
      .insert({ code: isoCode, name: "Sekolah Isolasi B", education_level: "SMA", status: "active" })
      .select("id")
      .single();
    assert.ifError(sbErr);
    schoolBId = schoolB.id;

    const { data: createdB, error: uErr } = await admin.auth.admin.createUser({
      email: isoUserEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "school_admin", school_id: schoolBId },
    });
    assert.ifError(uErr);
    adminBUserId = createdB.user.id;

    await admin.from("profiles").insert({
      id: adminBUserId,
      school_id: schoolBId,
      role: "school_admin",
      username: isoCode.toLowerCase(),
      auth_email: isoUserEmail,
      full_name: "Admin Isolasi B",
      status: "active",
      is_active: true,
    });

    const schoolBClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: bLoginErr } = await schoolBClient.auth.signInWithPassword({
      email: isoUserEmail,
      password: TEST_PASSWORD,
    });
    assert.ifError(bLoginErr);

    const { data: visibleSchools } = await schoolBClient.from("schools").select("id, code");
    assert.equal((visibleSchools || []).length, 1);
    assert.equal(visibleSchools[0].id, schoolBId, "School B admin should only see own school");

    const { data: crossStudents } = await schoolBClient.from("students").select("id");
    assert.equal((crossStudents || []).length, 0, "School B admin must see 0 School A students");
  } finally {
    if (adminBUserId) {
      await admin.from("profiles").delete().eq("id", adminBUserId);
      await admin.auth.admin.deleteUser(adminBUserId);
    }
    if (schoolBId) {
      await admin.from("schools").delete().eq("id", schoolBId);
    }
  }
  console.log("      PASSED: Anon, Student, Supervisor, and Cross-School RLS isolation verified.");
}

async function runFullExamLifecycleChecks() {
  let createdBankId = null;
  let createdExamId = null;
  const createdQuestionIds = [];

  try {
    console.log("[2/5] Verifying /api/health & Staff Authoring + XSS Sanitization...");
    const healthRes = await fetch(`${TARGET_URL}/api/health`).then((r) => r.json());
    assert.equal(healthRes.supabase.publicConfigured, true);
    assert.equal(healthRes.supabase.adminConfigured, true);
    assert.equal(healthRes.supabase.dbConnected, true, `DB health check failed: ${healthRes.supabase.dbError}`);

    const { data: school } = await admin.from("schools").select("id").eq("code", "SMAN1DEMO").single();
    const { data: subj } = await admin.from("subjects").select("id").eq("school_id", school.id).eq("code", "MTK-X").single();
    const { data: cls } = await admin.from("classes").select("id").eq("school_id", school.id).eq("code", "X-IPA-1").single();
    const { data: stuProfile } = await admin.from("profiles").select("id").eq("username", "202601001").single();
    const { data: stuRow } = await admin.from("students").select("id").eq("profile_id", stuProfile.id).single();
    const { data: supProfile } = await admin.from("profiles").select("id").eq("username", "pengawas.ruang1").single();

    const teacherHttp = createCookieSession();
    const tLogin = await teacherHttp.req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "guru.matematika", password: TEST_PASSWORD }),
    });
    assert.equal(tLogin.status, 200, "Teacher login must succeed");

    // Create question bank
    const bankRes = await teacherHttp.req("/api/questions/banks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "bank",
        subject_id: subj.id,
        class_id: cls.id,
        title: `Bank E2E ${Date.now()}`,
        is_shared: true,
      }),
    });
    assert.equal(bankRes.status, 201);
    createdBankId = bankRes.data.bank.id;

    // Q1: Single choice + KaTeX + XSS test payload
    const q1Res = await teacherHttp.req("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: createdBankId,
        subject_id: subj.id,
        class_id: cls.id,
        question_type: "single_choice",
        difficulty: "easy",
        has_math: true,
        default_weight: 2,
        stem_html: `<p>Hitung nilai $x^2 + 1$ jika $x = 3$.</p><script>alert("xss")</script><img src="x" onerror="alert(1)">`,
        explanation_html: "<p>Pembahasan rahasia guru.</p>",
        options: [
          { option_label: "A", content_html: "<p>10</p>", is_correct: true },
          { option_label: "B", content_html: "<p>9</p>", is_correct: false },
        ],
      }),
    });
    assert.equal(q1Res.status, 201);
    assert.equal(q1Res.data.question.stem_html.includes("<script"), false, "Script tag must be sanitized");
    assert.equal(q1Res.data.question.stem_html.includes("onerror"), false, "Inline event handler must be stripped");
    createdQuestionIds.push(q1Res.data.question.id);

    // Q2: MCMA partial credit (non-negative)
    const q2Res = await teacherHttp.req("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: createdBankId,
        subject_id: subj.id,
        class_id: cls.id,
        question_type: "mcma",
        default_weight: 2,
        mcma_scoring_mode: "partial_credit",
        allow_negative_score: false,
        stem_html: "<p>Pilih bilangan prima di bawah ini:</p>",
        options: [
          { option_label: "A", content_html: "<p>2</p>", is_correct: true },
          { option_label: "B", content_html: "<p>3</p>", is_correct: true },
          { option_label: "C", content_html: "<p>4</p>", is_correct: false },
        ],
      }),
    });
    assert.equal(q2Res.status, 201);
    createdQuestionIds.push(q2Res.data.question.id);

    // Q3: True/False multi-statement
    const q3Res = await teacherHttp.req("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: createdBankId,
        subject_id: subj.id,
        class_id: cls.id,
        question_type: "true_false",
        default_weight: 2,
        stem_html: "<p>Tentukan benar atau salah pernyataan berikut:</p>",
        statements: [
          { statement_html: "<p>2 + 2 = 4</p>", is_true: true, weight: 1 },
          { statement_html: "<p>5 adalah bilangan genap</p>", is_true: false, weight: 1 },
        ],
      }),
    });
    assert.equal(q3Res.status, 201);
    createdQuestionIds.push(q3Res.data.question.id);

    // Q4: Essay
    const q4Res = await teacherHttp.req("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: createdBankId,
        subject_id: subj.id,
        class_id: cls.id,
        question_type: "essay",
        default_weight: 4,
        stem_html: "<p>Jelaskan teorema Pythagoras secara singkat.</p>",
        essay_rubric: "Sebutkan a^2 + b^2 = c^2 pada segitiga siku-siku",
      }),
    });
    assert.equal(q4Res.status, 201);
    createdQuestionIds.push(q4Res.data.question.id);

    // Create Exam & Activate
    const now = Date.now();
    const startsAt = new Date(now - 5 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 60 * 60 * 1000).toISOString();
    const examRes = await teacherHttp.req("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Ujian Verifikasi E2E ${now}`,
        subject_id: subj.id,
        class_id: cls.id,
        exam_date: new Date().toISOString().slice(0, 10),
        starts_at: startsAt,
        ends_at: endsAt,
        duration_minutes: 45,
        passing_score: 70,
        max_attempts: 1,
        shuffle_questions: false,
        shuffle_options: false,
        face_verification_enabled: false,
        question_ids: createdQuestionIds,
        sessions: [
          {
            session_number: 1,
            name: "Sesi E2E 1",
            room_name: "Lab 1",
            max_participants: 100,
            starts_at: startsAt,
            ends_at: endsAt,
          },
        ],
      }),
    });
    assert.equal(examRes.status, 201);
    createdExamId = examRes.data.exam.id;
    const sessionId = examRes.data.sessions[0].id;
    assert.equal(examRes.data.exam.face_verification_enabled, false, "Face verification must default to OFF");

    const activateRes = await teacherHttp.req(`/api/exams/${createdExamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    assert.equal(activateRes.status, 200);

    // Enroll student & assign supervisor
    const enrollRes = await teacherHttp.req(`/api/exams/${createdExamId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enroll_students", session_id: sessionId, student_ids: [stuRow.id] }),
    });
    assert.equal(enrollRes.status, 200);

    const assignSupRes = await teacherHttp.req(`/api/exams/${createdExamId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_supervisor", session_id: sessionId, supervisor_id: supProfile.id }),
    });
    assert.equal(assignSupRes.status, 200);

    // School Admin generates CSPRNG token
    console.log("[3/5] Verifying CSPRNG Token Hashing & 3-Component Student Login...");
    const adminHttp = createCookieSession();
    const aLogin = await adminHttp.req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin.sman1", password: TEST_PASSWORD }),
    });
    assert.equal(aLogin.status, 200);

    const tokenRes = await adminHttp.req(`/api/exams/${createdExamId}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "auto",
        session_id: sessionId,
        valid_from: startsAt,
        valid_until: endsAt,
        usage_policy: "session_shared",
      }),
    });
    assert.equal(tokenRes.status, 201);
    const plaintextToken = tokenRes.data.plaintextToken;
    assert.ok(plaintextToken && plaintextToken.length >= 6);

    const { data: tokenDbRow } = await admin
      .from("exam_tokens")
      .select("id, token_hash, token_hint")
      .eq("id", tokenRes.data.tokenRecord.id)
      .single();
    assert.notEqual(tokenDbRow.token_hash, plaintextToken, "Database must never store plaintext token");

    // Negative student login checks
    const badTokenLogin = await createCookieSession().req("/api/auth/student-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "202601001", password: TEST_PASSWORD, token: "WRONG999" }),
    });
    assert.equal(badTokenLogin.status, 403, "Invalid token must return 403");

    const badPassLogin = await createCookieSession().req("/api/auth/student-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "202601001", password: "WrongPassword123!", token: plaintextToken }),
    });
    assert.equal(badPassLogin.status, 401, "Wrong password must return 401");

    // Valid 3-component student login
    const stuHttp = createCookieSession();
    const sLogin = await stuHttp.req("/api/auth/student-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "202601001", password: TEST_PASSWORD, token: plaintextToken }),
    });
    assert.equal(sLogin.status, 200, "Valid 3-component login must succeed");
    assert.equal(sLogin.data.faceVerificationEnabled, false);

    // Start attempt & verify sanitized exam payload (ZERO answer key leak!)
    console.log("[4/5] Verifying Attempt Payload Isolation, Autosave Idempotency & Supervisor Resume...");
    const startRes = await stuHttp.req("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId: createdExamId, sessionId, tokenId: sLogin.data.tokenId }),
    });
    assert.equal(startRes.status, 200);
    const attemptId = startRes.data.attempt.id;

    const payloadRes = await stuHttp.req(`/api/attempts/${attemptId}`, { method: "GET" });
    assert.equal(payloadRes.status, 200);
    const serialized = JSON.stringify(payloadRes.data);
    for (const forbidden of ["isCorrect", "is_correct", "isTrue", "is_true", "explanationHtml", "explanation_html", "essayRubric", "essay_rubric"]) {
      assert.equal(serialized.includes(forbidden), false, `Student exam payload leaked forbidden field: ${forbidden}`);
    }

    const qList = payloadRes.data.questions;
    assert.equal(qList.length, 4);
    const q1 = qList.find((q) => q.question_type === "single_choice");
    const q2 = qList.find((q) => q.question_type === "mcma");
    const q3 = qList.find((q) => q.question_type === "true_false");
    const q4 = qList.find((q) => q.question_type === "essay");

    // Autosave + Idempotency + Version Conflict check
    const idem1 = `e2e-${crypto.randomUUID()}`;
    const save1 = await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: q1.question_id,
        selectedOptionId: q1.options[0].id,
        isAnswered: true,
        answerVersion: 1,
        idempotencyKey: idem1,
      }),
    });
    assert.equal(save1.status, 200);
    assert.equal(save1.data.results[0].persisted_version, 1);

    const replay1 = await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: q1.question_id,
        selectedOptionId: q1.options[1].id,
        isAnswered: true,
        answerVersion: 2,
        idempotencyKey: idem1, // exact duplicate idempotencyKey
      }),
    });
    assert.equal(replay1.status, 200);
    assert.equal(replay1.data.results[0].answer_id, save1.data.results[0].answer_id);
    assert.equal(replay1.data.results[0].persisted_version, 1, "Idempotent replay must return original row without double mutation");

    // Advance Q1 to version 2, then test stale version 1 rejection
    await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: q1.question_id,
        selectedOptionId: q1.options[0].id,
        isAnswered: true,
        answerVersion: 2,
        idempotencyKey: `e2e-${crypto.randomUUID()}`,
      }),
    });

    const staleSave = await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: q1.question_id,
        selectedOptionId: q1.options[1].id,
        isAnswered: true,
        answerVersion: 1,
        idempotencyKey: `e2e-${crypto.randomUUID()}`,
      }),
    });
    assert.equal(staleSave.status, 200);
    assert.equal(staleSave.data.results[0].conflict_detected, true, "Stale version must trigger conflict protection");

    // Save Q2 (1 correct MCMA option), Q3 (both T/F correct), Q4 (essay)
    const stmtMap = {};
    stmtMap[q3.statements[0].id] = true;
    stmtMap[q3.statements[1].id] = false;
    await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            questionId: q2.question_id,
            selectedOptionIds: [q2.options[0].id],
            isAnswered: true,
            answerVersion: 1,
            idempotencyKey: `e2e-${crypto.randomUUID()}`,
          },
          {
            questionId: q3.question_id,
            statementAnswers: stmtMap,
            isAnswered: true,
            answerVersion: 1,
            idempotencyKey: `e2e-${crypto.randomUUID()}`,
          },
          {
            questionId: q4.question_id,
            essayAnswer: "a^2 + b^2 = c^2 untuk segitiga siku-siku.",
            isAnswered: true,
            answerVersion: 1,
            idempotencyKey: `e2e-${crypto.randomUUID()}`,
          },
        ],
      }),
    });

    // Security event logging + Supervisor Pause & Resume on EXACT same attemptId
    await stuHttp.req(`/api/attempts/${attemptId}/security-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "TAB_SWITCH", durationSeconds: 8 }),
    });

    const supHttp = createCookieSession();
    const supLogin = await supHttp.req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "pengawas.ruang1", password: TEST_PASSWORD }),
    });
    assert.equal(supLogin.status, 200);

    const monitorRes = await supHttp.req(`/api/supervisor/monitoring/${createdExamId}?attemptId=${attemptId}`, {
      method: "GET",
    });
    assert.equal(monitorRes.status, 200);
    assert.ok(monitorRes.data.summary.totalRegistered >= 1);

    const pauseRes = await supHttp.req("/api/supervisor/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId,
        actionType: "EXAM_PAUSED",
        reason: "Verifikasi koneksi pengawas uji coba",
      }),
    });
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseRes.data.attempt.status, "PAUSED");

    const blockedWhilePaused = await stuHttp.req(`/api/attempts/${attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: q4.question_id,
        essayAnswer: "Perubahan saat dipause",
        isAnswered: true,
        answerVersion: 2,
        idempotencyKey: `e2e-${crypto.randomUUID()}`,
      }),
    });
    assert.equal(blockedWhilePaused.status, 409, "Autosave must be blocked while attempt is PAUSED");

    const resumeRes = await supHttp.req("/api/supervisor/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId,
        actionType: "RESUME_APPROVED",
        reason: "Siswa diizinkan melanjutkan ujian",
      }),
    });
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.data.attempt.id, attemptId, "Supervisor resume must reuse exact same attempt_id");
    assert.equal(resumeRes.data.attempt.status, "RESUMED");

    const afterResume = await stuHttp.req(`/api/attempts/${attemptId}`, { method: "GET" });
    assert.equal(afterResume.status, 200);
    assert.equal(afterResume.data.savedAnswers.length, 4, "All 4 saved answers must remain intact after supervisor resume");

    // Submit + Auto Grade + Manual Essay Grade + Publish + Export
    console.log("[5/5] Verifying Submit, Auto-Grading, Manual Grading History, Publish & Export...");
    const submitRes = await stuHttp.req(`/api/attempts/${attemptId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Selesai mengerjakan" }),
    });
    assert.equal(submitRes.status, 200);

    const resultsRes = await teacherHttp.req(`/api/results/${createdExamId}`, { method: "GET" });
    assert.equal(resultsRes.status, 200);
    assert.equal(resultsRes.data.results.length, 1);
    assert.ok(Number(resultsRes.data.results[0].auto_score) >= 5, "Auto score should sum Q1(2)+Q2(1)+Q3(2)=5");
    assert.equal(resultsRes.data.manualQueue.length, 1);

    const mgRes = await teacherHttp.req("/api/results/manual-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manualGradingId: resultsRes.data.manualQueue[0].id,
        awardedScore: 3.5,
        graderNote: "Bagus dan tepat",
        reason: "Penilaian esai E2E",
      }),
    });
    assert.equal(mgRes.status, 200);

    const { data: historyRows } = await admin
      .from("grading_history")
      .select("id, new_score")
      .eq("exam_id", createdExamId);
    assert.equal((historyRows || []).length, 1, "Manual grade must record grading_history");

    const pubRes = await teacherHttp.req(`/api/results/${createdExamId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true }),
    });
    assert.equal(pubRes.status, 200);

    // Student reads published result via anon client RLS
    const stuRls = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await stuRls.auth.signInWithPassword({
      email: "202601001@auth.cbtsmartexam.internal",
      password: TEST_PASSWORD,
    });
    const { data: pubStuResult } = await stuRls
      .from("exam_results")
      .select("id, total_score, is_published")
      .eq("exam_id", createdExamId);
    assert.equal((pubStuResult || []).length, 1);
    assert.equal(pubStuResult[0].is_published, true);

    const csvRes = await teacherHttp.req(`/api/results/${createdExamId}/export?format=csv`, { method: "GET" });
    assert.equal(csvRes.status, 200);
    assert.ok(String(csvRes.data).includes("Siswa Uji Coba 1"), "CSV export must contain graded student row");

    console.log("      PASSED: Full E2E Exam, Security, Supervisor Resume, Auto+Manual Grading & Export verified.");
  } finally {
    if (createdExamId) {
      await admin.from("exams").delete().eq("id", createdExamId);
    }
    if (createdQuestionIds.length > 0) {
      await admin.from("questions").delete().in("id", createdQuestionIds);
    }
    if (createdBankId) {
      await admin.from("question_banks").delete().eq("id", createdBankId);
    }
    await admin.from("auth_rate_limits").delete().neq("key", "");
  }
}

async function main() {
  await ensureKnownPasswords();
  await runRlsIsolationChecks();
  await runFullExamLifecycleChecks();
  console.log("\nALL LIVE VERIFICATION CHECKS PASSED SUCCESSFULLY.");
}

main().catch((err) => {
  console.error("\nLIVE VERIFICATION FAILED:", err);
  process.exit(1);
});
