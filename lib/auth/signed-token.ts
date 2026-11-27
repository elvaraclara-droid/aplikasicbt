import crypto from "crypto";

export const EXAM_AUTH_COOKIE_NAME = "cbt_exam_auth";

export interface SignedExamSessionPayload {
  uid: string;
  stid: string;
  role: "student";
  exp: number;
}

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Creates a signed HMAC-SHA256 token for fast local validation on hot exam APIs.
 */
export function signStudentExamToken(params: {
  userId: string;
  sessionTokenId: string;
  secret: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): string {
  const nowSec = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 8 * 60 * 60;
  const payload: SignedExamSessionPayload = {
    uid: params.userId,
    stid: params.sessionTokenId,
    role: "student",
    exp: nowSec + ttl,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const sig = hmacHex(params.secret, encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verifies an HMAC-SHA256 student exam session token in constant time without network calls.
 */
export function verifyStudentExamToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): SignedExamSessionPayload | null {
  if (!token || !secret) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return null;

  const encoded = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encoded || !providedSig) return null;

  const expectedSig = hmacHex(secret, encoded);
  if (providedSig.length !== expectedSig.length) return null;

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<SignedExamSessionPayload>;

    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.stid !== "string" ||
      parsed.role !== "student" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= nowSeconds
    ) {
      return null;
    }

    return parsed as SignedExamSessionPayload;
  } catch {
    return null;
  }
}
