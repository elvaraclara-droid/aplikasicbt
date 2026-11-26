import mammoth from "mammoth";
import { parse, type HTMLElement } from "node-html-parser";
import {
  sanitizeRichHtml,
  stripHtmlToPlainText,
} from "@/lib/security/html-sanitizer";
import type {
  DifficultyLevel,
  McmaScoringMode,
  QuestionType,
} from "@/types/database";

export interface ParsedQuestionOption {
  option_label: string;
  content_html: string;
  is_correct: boolean;
}

export interface ParsedQuestionStatement {
  statement_html: string;
  is_true: boolean;
  weight: number;
}

export interface ParsedDocxQuestion {
  question_type: QuestionType;
  difficulty: DifficultyLevel;
  topic: string | null;
  competency: string | null;
  stem_html: string;
  has_math: boolean;
  default_weight: number;
  mcma_scoring_mode: McmaScoringMode;
  explanation_html: string | null;
  essay_rubric: string | null;
  options: ParsedQuestionOption[];
  statements: ParsedQuestionStatement[];
}

export interface DocxParseResult {
  questions: ParsedDocxQuestion[];
  errors: string[];
  warnings: string[];
}

type CanonicalFieldKey =
  | "type"
  | "mcma_mode"
  | "difficulty"
  | "weight"
  | "topic"
  | "competency"
  | "stem"
  | "answer"
  | "explanation"
  | `slot_${number}`;

interface RawCellValue {
  html: string;
  plain: string;
}

type QuestionFieldBag = Partial<Record<CanonicalFieldKey, RawCellValue>>;

const ALLOWED_DOCX_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const MAX_INLINE_IMAGE_BYTES = 1_500_000;
const MAX_QUESTIONS_PER_DOCX = 200;

const FIELD_SYNONYMS: Record<string, CanonicalFieldKey> = {
  tipe: "type",
  "tipe soal": "type",
  jenis: "type",
  "jenis soal": "type",
  type: "type",
  question_type: "type",
  "mode mcma": "mcma_mode",
  "mode penilaian": "mcma_mode",
  mcma_scoring_mode: "mcma_mode",
  kesulitan: "difficulty",
  "tingkat kesulitan": "difficulty",
  level: "difficulty",
  difficulty: "difficulty",
  bobot: "weight",
  "bobot nilai": "weight",
  skor: "weight",
  weight: "weight",
  default_weight: "weight",
  topik: "topic",
  materi: "topic",
  topic: "topic",
  kompetensi: "competency",
  kd: "competency",
  competency: "competency",
  pertanyaan: "stem",
  soal: "stem",
  "isi soal": "stem",
  "teks soal": "stem",
  stem: "stem",
  kunci: "answer",
  "kunci jawaban": "answer",
  jawaban: "answer",
  "jawaban benar": "answer",
  rubrik: "answer",
  "pedoman penilaian": "answer",
  answer: "answer",
  pembahasan: "explanation",
  penjelasan: "explanation",
  keterangan: "explanation",
  explanation: "explanation",
  a: "slot_1",
  b: "slot_2",
  c: "slot_3",
  d: "slot_4",
  e: "slot_5",
  "pilihan a": "slot_1",
  "pilihan b": "slot_2",
  "pilihan c": "slot_3",
  "pilihan d": "slot_4",
  "pilihan e": "slot_5",
  "opsi a": "slot_1",
  "opsi b": "slot_2",
  "opsi c": "slot_3",
  "opsi d": "slot_4",
  "opsi e": "slot_5",
  "jawaban a": "slot_1",
  "jawaban b": "slot_2",
  "jawaban c": "slot_3",
  "jawaban d": "slot_4",
  "jawaban e": "slot_5",
};

function normalizeFieldKey(rawLabel: string): CanonicalFieldKey | null {
  const cleaned = rawLabel
    .toLowerCase()
    .replace(/[:*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned in FIELD_SYNONYMS) {
    return FIELD_SYNONYMS[cleaned];
  }

  const statementMatch = cleaned.match(/^(?:pernyataan|p)\s*([1-8])$/);
  if (statementMatch) {
    return `slot_${Number(statementMatch[1])}`;
  }

  const optionNumberMatch = cleaned.match(/^(?:pilihan|opsi)\s*([1-5])$/);
  if (optionNumberMatch) {
    return `slot_${Number(optionNumberMatch[1])}`;
  }

  return null;
}

function hasRenderableContent(html: string): boolean {
  return (
    stripHtmlToPlainText(html).length > 0 ||
    /<img\b[^>]*\bsrc\s*=\s*["'](?:data:image\/|https?:\/\/)/i.test(html)
  );
}

function hasTableAncestor(el: HTMLElement): boolean {
  let cursor = el.parentNode;
  while (cursor) {
    if (
      "rawTagName" in cursor &&
      typeof cursor.rawTagName === "string" &&
      cursor.rawTagName.toLowerCase() === "table"
    ) {
      return true;
    }
    cursor = cursor.parentNode;
  }
  return false;
}

function extractDirectRows(table: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of table.childNodes) {
    if (!("rawTagName" in child) || typeof child.rawTagName !== "string") {
      continue;
    }
    const tag = child.rawTagName.toLowerCase();
    if (tag === "tr") {
      rows.push(child as HTMLElement);
    } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      for (const sectionChild of child.childNodes) {
        if (
          "rawTagName" in sectionChild &&
          typeof sectionChild.rawTagName === "string" &&
          sectionChild.rawTagName.toLowerCase() === "tr"
        ) {
          rows.push(sectionChild as HTMLElement);
        }
      }
    }
  }
  return rows;
}

function extractDirectCells(row: HTMLElement): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (const child of row.childNodes) {
    if (
      "rawTagName" in child &&
      typeof child.rawTagName === "string" &&
      (child.rawTagName.toLowerCase() === "td" ||
        child.rawTagName.toLowerCase() === "th")
    ) {
      cells.push(child as HTMLElement);
    }
  }
  return cells;
}

function toCellValue(cell: HTMLElement): RawCellValue {
  const cleaned = sanitizeRichHtml(cell.innerHTML || "").replace(
    /<img\b[^>]*\bsrc\s*=\s*(?:""|''|"#")[^>]*\/?>/gi,
    ""
  );
  const plain = stripHtmlToPlainText(cleaned);
  return { html: cleaned.trim(), plain };
}

function parseQuestionType(
  rawType: string | undefined,
  fields: QuestionFieldBag
): QuestionType | null {
  const normalized = (rawType || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    const slotCount = [1, 2, 3, 4, 5].filter(
      (n) => fields[`slot_${n}`] && hasRenderableContent(fields[`slot_${n}`]!.html)
    ).length;
    if (slotCount === 0) return "essay";
    const letters = (fields.answer?.plain || "").match(/\b[A-E]\b/gi) || [];
    return letters.length > 1 ? "mcma" : "single_choice";
  }

  if (
    ["pg", "pilihan ganda", "pilihan ganda tunggal", "single_choice", "single"].includes(
      normalized
    )
  ) {
    return "single_choice";
  }
  if (
    [
      "mcma",
      "pgk",
      "pilihan ganda kompleks",
      "banyak jawaban",
      "multiple_answer",
    ].includes(normalized)
  ) {
    return "mcma";
  }
  if (
    ["bs", "benar/salah", "benar salah", "true_false", "true/false"].includes(
      normalized
    )
  ) {
    return "true_false";
  }
  if (["uraian", "esai", "essay", "isian"].includes(normalized)) {
    return "essay";
  }
  return null;
}

function parseDifficulty(raw: string | undefined): DifficultyLevel {
  const normalized = (raw || "").toLowerCase().trim();
  if (["mudah", "easy"].includes(normalized)) return "easy";
  if (["sulit", "hard", "sukar"].includes(normalized)) return "hard";
  return "medium";
}

function parseMcmaMode(raw: string | undefined): McmaScoringMode {
  const normalized = (raw || "").toLowerCase().trim();
  if (["exact", "exact_match", "persis", "sama persis"].includes(normalized)) {
    return "exact_match";
  }
  return "partial_credit";
}

function parseWeight(raw: string | undefined): number {
  const cleaned = (raw || "").replace(",", ".").trim();
  if (!cleaned) return 1;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.min(100, num);
}

function parseOptionKeys(raw: string): string[] {
  const matches = raw.toUpperCase().match(/[A-E]/g) || [];
  return [...new Set(matches)];
}

function parseBooleanToken(raw: string): boolean | null {
  const stripped = raw
    .trim()
    .replace(/^(?:\d+|[A-Ea-e])\s*[:.)-]\s*/, "")
    .toLowerCase();
  if (["b", "benar", "true", "t", "1", "ya", "y"].includes(stripped)) {
    return true;
  }
  if (["s", "salah", "false", "f", "0", "tidak", "n"].includes(stripped)) {
    return false;
  }
  return null;
}

function collectOrderedSlots(fields: QuestionFieldBag): Array<{
  letter: string;
  value: RawCellValue;
}> {
  const result: Array<{ letter: string; value: RawCellValue }> = [];
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (let i = 1; i <= 8; i++) {
    const val = fields[`slot_${i}`];
    if (val && hasRenderableContent(val.html)) {
      result.push({ letter: letters[i - 1], value: val });
    }
  }
  return result;
}

function containsMathDelimiters(text: string): boolean {
  return /(?<!\\)\$[^$\n]+?\$/.test(text);
}

function normalizeFieldsToQuestion(
  fields: QuestionFieldBag,
  label: string
): { question: ParsedDocxQuestion | null; error: string | null } {
  const stemHtml = fields.stem?.html || "";
  if (!hasRenderableContent(stemHtml)) {
    return {
      question: null,
      error: `${label}: Kolom "Pertanyaan" kosong.`,
    };
  }

  const questionType = parseQuestionType(fields.type?.plain, fields);
  if (!questionType) {
    return {
      question: null,
      error: `${label}: Tipe soal "${fields.type?.plain}" tidak dikenali (gunakan PG, MCMA, BS, atau URAIAN).`,
    };
  }

  const difficulty = parseDifficulty(fields.difficulty?.plain);
  const weight = parseWeight(fields.weight?.plain);
  const mcmaMode = parseMcmaMode(fields.mcma_mode?.plain);
  const topic = fields.topic?.plain ? fields.topic.plain.slice(0, 160) : null;
  const competency = fields.competency?.plain
    ? fields.competency.plain.slice(0, 240)
    : null;
  const explanationHtml =
    fields.explanation && hasRenderableContent(fields.explanation.html)
      ? fields.explanation.html
      : null;

  const slots = collectOrderedSlots(fields);
  const answerPlain = fields.answer?.plain || "";
  let options: ParsedQuestionOption[] = [];
  let statements: ParsedQuestionStatement[] = [];
  let essayRubric: string | null = null;

  if (questionType === "single_choice" || questionType === "mcma") {
    if (slots.length < 2) {
      return {
        question: null,
        error: `${label}: Soal ${questionType} memerlukan minimal 2 pilihan jawaban.`,
      };
    }

    const keys = parseOptionKeys(answerPlain);
    const availableLabels = new Set(slots.map((s) => s.letter));
    const unknownKeys = keys.filter((k) => !availableLabels.has(k));

    if (unknownKeys.length > 0) {
      return {
        question: null,
        error: `${label}: Kunci jawaban (${unknownKeys.join(", ")}) menunjuk pilihan yang kosong.`,
      };
    }

    if (questionType === "single_choice" && keys.length !== 1) {
      return {
        question: null,
        error: `${label}: Kunci jawaban PG harus tepat 1 huruf (misal: A).`,
      };
    }

    if (questionType === "mcma" && keys.length === 0) {
      return {
        question: null,
        error: `${label}: Kunci jawaban MCMA harus berisi minimal 1 huruf (misal: A, B).`,
      };
    }

    const correctSet = new Set(keys);
    options = slots.map((slot) => ({
      option_label: slot.letter,
      content_html: slot.value.html,
      is_correct: correctSet.has(slot.letter),
    }));
  } else if (questionType === "true_false") {
    if (slots.length === 0) {
      return {
        question: null,
        error: `${label}: Soal Benar/Salah memerlukan minimal 1 pernyataan.`,
      };
    }

    const rawTokens = answerPlain
      .split(/[,;|\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (rawTokens.length !== slots.length) {
      return {
        question: null,
        error: `${label}: Jumlah kunci Benar/Salah (${rawTokens.length}) harus sama dengan jumlah pernyataan (${slots.length}), contoh: B, S, B.`,
      };
    }

    const parsedBooleans = rawTokens.map(parseBooleanToken);
    if (parsedBooleans.some((v) => v === null)) {
      return {
        question: null,
        error: `${label}: Format kunci Benar/Salah tidak valid (gunakan B/S atau Benar/Salah dipisah koma).`,
      };
    }

    statements = slots.map((slot, idx) => ({
      statement_html: slot.value.html,
      is_true: parsedBooleans[idx]!,
      weight: 1,
    }));
  } else {
    essayRubric = answerPlain || null;
  }

  const allText = [
    stemHtml,
    ...options.map((o) => o.content_html),
    ...statements.map((s) => s.statement_html),
    explanationHtml || "",
  ].join(" ");

  return {
    question: {
      question_type: questionType,
      difficulty,
      topic,
      competency,
      stem_html: stemHtml,
      has_math: containsMathDelimiters(allText),
      default_weight: weight,
      mcma_scoring_mode: mcmaMode,
      explanation_html: explanationHtml,
      essay_rubric: essayRubric,
      options,
      statements,
    },
    error: null,
  };
}

function tryExtractHorizontalRows(
  rows: HTMLElement[],
  tableIndex: number
): Array<{ bag: QuestionFieldBag; label: string }> | null {
  if (rows.length < 2) return null;
  const headerCells = extractDirectCells(rows[0]);
  if (headerCells.length < 3) return null;

  const headerMap = headerCells.map((cell) =>
    normalizeFieldKey(stripHtmlToPlainText(cell.innerHTML || ""))
  );
  const recognizedCount = headerMap.filter(Boolean).length;
  if (recognizedCount < 2 || !headerMap.includes("stem")) {
    return null;
  }

  const extracted: Array<{ bag: QuestionFieldBag; label: string }> = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = extractDirectCells(rows[r]);
    if (cells.length === 0) continue;

    const bag: QuestionFieldBag = {};
    let hasAnyText = false;
    for (let c = 0; c < Math.min(cells.length, headerMap.length); c++) {
      const key = headerMap[c];
      const val = toCellValue(cells[c]);
      if (hasRenderableContent(val.html)) hasAnyText = true;
      if (key) {
        bag[key] = val;
      }
    }
    if (hasAnyText) {
      extracted.push({
        bag,
        label: `Tabel ${tableIndex + 1} Baris ${r + 1}`,
      });
    }
  }
  return extracted;
}

function tryExtractVerticalCard(
  rows: HTMLElement[],
  tableIndex: number
): { bag: QuestionFieldBag; label: string } | null {
  const bag: QuestionFieldBag = {};
  let recognizedFields = 0;

  for (const row of rows) {
    const cells = extractDirectCells(row);
    if (cells.length < 2) continue;
    const rawKey = stripHtmlToPlainText(cells[0].innerHTML || "");
    const key = normalizeFieldKey(rawKey);
    if (!key) continue;
    recognizedFields++;
    bag[key] = toCellValue(cells[1]);
  }

  if (recognizedFields < 2 && !bag.stem) {
    return null;
  }

  return {
    bag,
    label: `Tabel Soal #${tableIndex + 1}`,
  };
}

/**
 * Parses a Word (.docx) buffer containing structured question tables (2-column cards or horizontal grids).
 */
export async function parseQuestionsFromDocxBuffer(
  buffer: Buffer
): Promise<DocxParseResult> {
  const warnings: string[] = [];

  let html = "";
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const rawMime = (image.contentType || "").toLowerCase();
          if (!ALLOWED_DOCX_IMAGE_MIMES.has(rawMime)) {
            warnings.push(`Gambar dengan format "${rawMime}" dilewati.`);
            return { src: "" };
          }
          const imgBuf = await image.readAsBuffer();
          if (imgBuf.byteLength > MAX_INLINE_IMAGE_BYTES) {
            warnings.push(
              `Gambar berukuran ${(imgBuf.byteLength / 1024 / 1024).toFixed(2)} MB melebihi batas 1.5 MB dan dilewati.`
            );
            return { src: "" };
          }
          const mime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
          return {
            src: `data:${mime};base64,${imgBuf.toString("base64")}`,
          };
        }),
      }
    );
    html = result.value;
    for (const msg of result.messages) {
      if (msg.type === "error") {
        warnings.push(msg.message);
      }
    }
  } catch {
    return {
      questions: [],
      errors: [
        "File .docx tidak dapat dibaca. Pastikan dokumen adalah file Microsoft Word (.docx) yang valid.",
      ],
      warnings,
    };
  }

  const root = parse(html);
  const topTables = root
    .querySelectorAll("table")
    .filter((tbl) => !hasTableAncestor(tbl));

  if (topTables.length === 0) {
    return {
      questions: [],
      errors: [
        "Tidak ditemukan tabel soal di dalam file .docx. Gunakan tombol Download Template .docx.",
      ],
      warnings,
    };
  }

  const questions: ParsedDocxQuestion[] = [];
  const errors: string[] = [];

  for (let i = 0; i < topTables.length; i++) {
    if (questions.length >= MAX_QUESTIONS_PER_DOCX) {
      warnings.push(
        `Maksimal ${MAX_QUESTIONS_PER_DOCX} soal per sekali import. Sisa tabel dilewati.`
      );
      break;
    }

    const rows = extractDirectRows(topTables[i]);
    if (rows.length === 0) continue;

    const horizontal = tryExtractHorizontalRows(rows, i);
    const items = horizontal
      ? horizontal
      : (() => {
          const card = tryExtractVerticalCard(rows, i);
          return card ? [card] : [];
        })();

    for (const entry of items) {
      if (questions.length >= MAX_QUESTIONS_PER_DOCX) break;
      const { question, error } = normalizeFieldsToQuestion(
        entry.bag,
        entry.label
      );
      if (error) {
        errors.push(error);
      } else if (question) {
        questions.push(question);
      }
    }
  }

  return { questions, errors, warnings };
}
