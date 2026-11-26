import { describe, expect, it } from "vitest";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { buildQuestionTemplateDocxBuffer } from "@/lib/questions/docx-template";
import { parseQuestionsFromDocxBuffer } from "@/lib/questions/docx-parser";

function cell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun(text)] })],
  });
}

describe("DOCX Question Template & Parser", () => {
  it("generates an official .docx template and round-trips all 4 question types cleanly", async () => {
    const buffer = await buildQuestionTemplateDocxBuffer();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");

    const parsed = await parseQuestionsFromDocxBuffer(buffer);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.questions).toHaveLength(4);

    // 1. PG Tunggal
    const q1 = parsed.questions[0];
    expect(q1.question_type).toBe("single_choice");
    expect(q1.difficulty).toBe("easy");
    expect(q1.default_weight).toBe(2);
    expect(q1.has_math).toBe(true);
    expect(q1.options).toHaveLength(5);
    expect(q1.options.filter((o) => o.is_correct).map((o) => o.option_label)).toEqual(["A"]);
    expect(q1.explanation_html).toContain("10");

    // 2. MCMA
    const q2 = parsed.questions[1];
    expect(q2.question_type).toBe("mcma");
    expect(q2.mcma_scoring_mode).toBe("partial_credit");
    expect(q2.options.filter((o) => o.is_correct).map((o) => o.option_label)).toEqual([
      "A",
      "B",
      "D",
    ]);

    // 3. Benar / Salah multi-pernyataan
    const q3 = parsed.questions[2];
    expect(q3.question_type).toBe("true_false");
    expect(q3.statements).toHaveLength(3);
    expect(q3.statements.map((s) => s.is_true)).toEqual([true, false, true]);

    // 4. Uraian
    const q4 = parsed.questions[3];
    expect(q4.question_type).toBe("essay");
    expect(q4.difficulty).toBe("hard");
    expect(q4.default_weight).toBe(5);
    expect(q4.essay_rubric).toContain("evaporasi");
  });

  it("parses horizontal multi-column Word tables cleanly", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [
                new TableRow({
                  children: [
                    cell("Tipe"),
                    cell("Kesulitan"),
                    cell("Bobot"),
                    cell("Pertanyaan"),
                    cell("A"),
                    cell("B"),
                    cell("Kunci"),
                  ],
                }),
                new TableRow({
                  children: [
                    cell("PG"),
                    cell("Sedang"),
                    cell("2.5"),
                    cell("Ibu kota Provinsi Sulawesi Selatan adalah..."),
                    cell("Makassar"),
                    cell("Manado"),
                    cell("A"),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });

    const buf = await Packer.toBuffer(doc);
    const parsed = await parseQuestionsFromDocxBuffer(buf);

    expect(parsed.errors).toEqual([]);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].question_type).toBe("single_choice");
    expect(parsed.questions[0].default_weight).toBe(2.5);
    expect(parsed.questions[0].options.map((o) => o.is_correct)).toEqual([true, false]);
  });

  it("reports validation errors clearly on malformed question rows and invalid buffers", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [
                new TableRow({ children: [cell("Tipe Soal"), cell("PG")] }),
                new TableRow({ children: [cell("Pertanyaan"), cell("Contoh soal?")] }),
                new TableRow({ children: [cell("Pilihan A"), cell("Opsi A")] }),
                new TableRow({ children: [cell("Pilihan B"), cell("Opsi B")] }),
                new TableRow({ children: [cell("Kunci Jawaban"), cell("A, B")] }),
              ],
            }),
            new Table({
              rows: [
                new TableRow({ children: [cell("Tipe Soal"), cell("BS")] }),
                new TableRow({ children: [cell("Pertanyaan"), cell("Uji BS")] }),
                new TableRow({ children: [cell("Pernyataan 1"), cell("P1")] }),
                new TableRow({ children: [cell("Pernyataan 2"), cell("P2")] }),
                new TableRow({ children: [cell("Kunci Jawaban"), cell("B")] }),
              ],
            }),
          ],
        },
      ],
    });

    const buf = await Packer.toBuffer(doc);
    const parsed = await parseQuestionsFromDocxBuffer(buf);
    expect(parsed.questions).toHaveLength(0);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain("tepat 1 huruf");
    expect(parsed.errors[1]).toContain("sama dengan jumlah pernyataan");

    const corrupt = await parseQuestionsFromDocxBuffer(Buffer.from("not-a-docx"));
    expect(corrupt.questions).toHaveLength(0);
    expect(corrupt.errors[0]).toContain(".docx tidak dapat dibaca");
  });
});
