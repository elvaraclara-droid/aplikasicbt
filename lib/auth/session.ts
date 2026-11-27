import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv, isSupabasePublicConfigured } from "@/lib/env";
import {
  EXAM_AUTH_COOKIE_NAME,
  signStudentExamToken,
  verifyStudentExamToken,
} from "@/lib/auth/signed-token";
import type { ProfileRecord, UserRole } from "@/types/database";

export interface AuthenticatedContext {
  userId: string;
  profile: ProfileRecord;
}

const PROFILE_SELECT_COLUMNS =
  "id, school_id, role, username, full_name, display_email, phone, avatar_path, status, is_active, must_change_password, last_login_at, created_at, updated_at";

export async function getAuthenticatedContext(): Promise<AuthenticatedContext | null> {
  if (!isSupabasePublicConfigured()) {
    return null;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    const admin = createSupabaseAdminClient();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select(PROFILE_SELECT_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active || profile.status !== "active") {
      return null;
    }

    return {
      userId: user.id,
      profile: profile as ProfileRecord,
    };
  } catch {
    return null;
  }
}

export async function requireRoleApi(allowedRoles: UserRole[]): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; response: NextResponse }
> {
  const ctx = await getAuthenticatedContext();
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sesi tidak valid atau telah berakhir. Silakan login kembali." },
        { status: 401 }
      ),
    };
  }

  if (!allowedRoles.includes(ctx.profile.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Anda tidak memiliki kewenangan mengakses resource ini." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, ctx };
}

/**
 * Attaches an HTTP-only HMAC-signed session cookie for student exam endpoints.
 */
export function attachStudentExamAuthCookie(
  response: NextResponse,
  params: { userId: string; sessionTokenId: string }
): void {
  const env = getServerEnv();
  const signed = signStudentExamToken({
    userId: params.userId,
    sessionTokenId: params.sessionTokenId,
    secret: env.sessionSigningSecret,
  });

  response.cookies.set(EXAM_AUTH_COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function clearStudentExamAuthCookie(response: NextResponse): void {
  response.cookies.delete(EXAM_AUTH_COOKIE_NAME);
}

/**
 * Validates student identity on hot exam APIs (autosave & heartbeat) using the local
 * HMAC-signed cookie + user_sessions check without calling Supabase Auth on every request.
 * Falls back cleanly to standard Supabase Auth verification if the cookie is absent.
 */
export async function requireFastStudentExamSession(
  request: NextRequest
): Promise<
  | { ok: true; ctx: AuthenticatedContext; fastAuth: boolean }
  | { ok: false; response: NextResponse }
> {
  const rawCookie = request.cookies.get(EXAM_AUTH_COOKIE_NAME)?.value;
  if (rawCookie && isSupabasePublicConfigured()) {
    const env = getServerEnv();
    const verified = verifyStudentExamToken(rawCookie, env.sessionSigningSecret);
    if (verified) {
      const admin = createSupabaseAdminClient();
      const [{ data: profile }, { data: sessionRow }] = await Promise.all([
        admin
          .from("profiles")
          .select(PROFILE_SELECT_COLUMNS)
          .eq("id", verified.uid)
          .maybeSingle(),
        admin
          .from("user_sessions")
          .select("is_active, expires_at")
          .eq("user_id", verified.uid)
          .eq("session_token_id", verified.stid)
          .maybeSingle(),
      ]);

      const sessionValid = Boolean(
        sessionRow &&
          sessionRow.is_active &&
          (!sessionRow.expires_at ||
            new Date(sessionRow.expires_at).getTime() > Date.now())
      );

      if (!sessionValid) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Sesi Anda telah dihentikan atau digantikan perangkat lain." },
            { status: 401 }
          ),
        };
      }

      if (
        profile &&
        profile.is_active &&
        profile.status === "active" &&
        profile.role === "student"
      ) {
        return {
          ok: true,
          ctx: { userId: verified.uid, profile: profile as ProfileRecord },
          fastAuth: true,
        };
      }
    }
  }

  const fallback = await requireRoleApi(["student"]);
  if (!fallback.ok) return fallback;
  return { ...fallback, fastAuth: false };
}

export function getRoleHomePath(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "/super-admin";
    case "school_admin":
      return "/admin";
    case "teacher":
      return "/teacher";
    case "supervisor":
      return "/supervisor";
    case "student":
      return "/student";
  }
}
