import { describe, it, expect } from "vitest";
import { APP_AUTHOR_CREDIT, formatSecondsClock } from "@/lib/utils";
import { stripHtmlToPlainText } from "@/lib/security/html-sanitizer";

describe("Utilities & Text Sanitization", () => {
  it("exposes expected author attribution text", () => {
    expect(APP_AUTHOR_CREDIT).toBe(
      "Aplikasi ini dibuat oleh Murdani dari Kepulauan Selayar"
    );
  });

  it("formats countdown clock safely without negative overflow", () => {
    expect(formatSecondsClock(3665)).toBe("01:01:05");
    expect(formatSecondsClock(0)).toBe("00:00:00");
    expect(formatSecondsClock(-25)).toBe("00:00:00");
  });

  it("strips HTML tags cleanly for plain search indexing", () => {
    expect(stripHtmlToPlainText("<p>Hasil <b>2 + 2</b> adalah?</p>")).toBe(
      "Hasil 2 + 2 adalah?"
    );
  });
});
