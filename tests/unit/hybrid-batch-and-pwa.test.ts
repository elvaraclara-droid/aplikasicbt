import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  computeJitteredDelayMs,
  getExamSyncProfile,
  resolveExamSyncMode,
} from "@/lib/exam/sync-config";
import {
  signStudentExamToken,
  verifyStudentExamToken,
} from "@/lib/auth/signed-token";
import manifest from "@/app/manifest";

describe("Hybrid Batch Sync Config & Jitter", () => {
  it("defaults to hybrid_batch and switches cleanly back to per_click when requested", () => {
    expect(resolveExamSyncMode(undefined)).toBe("hybrid_batch");
    expect(resolveExamSyncMode("unexpected")).toBe("hybrid_batch");
    expect(resolveExamSyncMode("per_click")).toBe("per_click");

    const hybrid = getExamSyncProfile("hybrid_batch");
    expect(hybrid.batchFlushIntervalMs).toBe(30_000);
    expect(hybrid.heartbeatIntervalMs).toBe(45_000);
    expect(hybrid.batchMaxDirtyCount).toBe(5);

    const legacy = getExamSyncProfile("per_click");
    expect(legacy.batchFlushIntervalMs).toBe(0);
    expect(legacy.heartbeatIntervalMs).toBe(15_000);
  });

  it("computes bounded jittered delays", () => {
    expect(computeJitteredDelayMs(30_000, 5_000, 0)).toBe(30_000);
    expect(computeJitteredDelayMs(30_000, 5_000, 1)).toBe(35_000);
    expect(computeJitteredDelayMs(30_000, 5_000, 0.5)).toBe(32_500);
    expect(computeJitteredDelayMs(0, 5_000, 0.5)).toBe(0);
  });
});

describe("Signed Student Fast Exam Cookie", () => {
  const secret = "test-signing-secret-hex-0123456789abcdef";

  it("signs and verifies valid student exam tokens", () => {
    const token = signStudentExamToken({
      userId: "user-123",
      sessionTokenId: "sess-abc",
      secret,
      nowSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });

    const verified = verifyStudentExamToken(token, secret, 1_700_000_100);
    expect(verified).toEqual({
      uid: "user-123",
      stid: "sess-abc",
      role: "student",
      exp: 1_700_003_600,
    });
  });

  it("rejects tampered, wrong-secret, or expired tokens", () => {
    const token = signStudentExamToken({
      userId: "user-123",
      sessionTokenId: "sess-abc",
      secret,
      nowSeconds: 1_700_000_000,
      ttlSeconds: 60,
    });

    const [body, sig] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ uid: "hacker", stid: "sess-abc", role: "student", exp: 1_900_000_000 }),
      "utf8"
    ).toString("base64url");

    expect(verifyStudentExamToken(`${tamperedPayload}.${sig}`, secret, 1_700_000_010)).toBeNull();
    expect(verifyStudentExamToken(`${body}.${sig.slice(0, -1)}a`, secret, 1_700_000_010)).toBeNull();
    expect(verifyStudentExamToken(token, "wrong-secret", 1_700_000_010)).toBeNull();
    expect(verifyStudentExamToken(token, secret, 1_700_000_060)).toBeNull();
  });
});

describe("Safe CBT PWA Manifest, Icons & Service Worker", () => {
  it("provides standalone PWA manifest and valid PNG icons", () => {
    const data = manifest();
    expect(data.name).toBe("CBT SMART EXAM");
    expect(data.display).toBe("standalone");
    expect(data.start_url).toBe("/login");

    const iconSrcs = (data.icons || []).map((i) => i.src);
    expect(iconSrcs).toContain("/icons/icon-192.png");
    expect(iconSrcs).toContain("/icons/icon-512.png");
    expect(iconSrcs).toContain("/icons/icon-512-maskable.png");
    expect(iconSrcs).not.toContain("/icons/icon.svg");

    for (const file of [
      "icon-192.png",
      "icon-512.png",
      "icon-512-maskable.png",
      "logo.png",
    ]) {
      const buf = fs.readFileSync(path.join(process.cwd(), "public", "icons", file));
      expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it("enforces strict static-only caching in sw.js so APIs & exams stay Network-Only", () => {
    const sw = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain('url.pathname.startsWith("/icons/")');
    expect(sw).toContain('if (request.method !== "GET") return;');
  });
});
