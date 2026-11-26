import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { APP_AUTHOR_CREDIT } from "@/lib/utils";

interface SampleFieldRow {
  label: string;
  value: string;
  emphasize?: boolean;
}

interface QuestionTemplateSample {
  title: string;
  rows: SampleFieldRow[];
}

const TEMPLATE_SAMPLES: QuestionTemplateSample[] = [
  {
    title: "Soal 1 — Contoh Pilihan Ganda Tunggal (PG)",
    rows: [
      { label: "Tipe Soal", value: "PG", emphasize: true },
      { label: "Kesulitan", value: "Mudah" },
      { label: "Bobot", value: "2" },
      { label: "Topik", value: "Persamaan Kuadrat" },
      {
        label: "Pertanyaan",
        value: "Hitung nilai $x^2 + 1$ apabila diketahui $x = 3$!",
      },
      { label: "Pilihan A", value: "10" },
      { label: "Pilihan B", value: "9" },
      { label: "Pilihan C", value: "8" },
      { label: "Pilihan D", value: "7" },
      { label: "Pilihan E", value: "6" },
      { label: "Kunci Jawaban", value: "A", emphasize: true },
      {
        label: "Pembahasan",
        value: "Substitusikan $x = 3$ ke persamaan: $3^2 + 1 = 9 + 1 = 10$.",
      },
    ],
  },
  {
    title: "Soal 2 — Contoh Pilihan Ganda Kompleks / Banyak Jawaban (MCMA)",
    rows: [
      { label: "Tipe Soal", value: "MCMA", emphasize: true },
      { label: "Mode MCMA", value: "partial_credit" },
      { label: "Kesulitan", value: "Sedang" },
      { label: "Bobot", value: "3" },
      { label: "Topik", value: "Bilangan Bulat" },
      {
        label: "Pertanyaan",
        value: "Pilih seluruh bilangan prima di bawah ini!",
      },
      { label: "Pilihan A", value: "2" },
      { label: "Pilihan B", value: "3" },
      { label: "Pilihan C", value: "4" },
      { label: "Pilihan D", value: "5" },
      { label: "Pilihan E", value: "9" },
      { label: "Kunci Jawaban", value: "A, B, D", emphasize: true },
      {
        label: "Pembahasan",
        value: "Bilangan prima hanya habis dibagi 1 dan dirinya sendiri: 2, 3, dan 5.",
      },
    ],
  },
  {
    title: "Soal 3 — Contoh Benar / Salah Multi-Pernyataan (BS)",
    rows: [
      { label: "Tipe Soal", value: "BS", emphasize: true },
      { label: "Kesulitan", value: "Sedang" },
      { label: "Bobot", value: "3" },
      { label: "Topik", value: "Geografi Indonesia" },
      {
        label: "Pertanyaan",
        value:
          "Tentukan apakah masing-masing pernyataan berikut Benar (B) atau Salah (S):",
      },
      {
        label: "Pernyataan 1",
        value: "Kabupaten Kepulauan Selayar terletak di Provinsi Sulawesi Selatan.",
      },
      {
        label: "Pernyataan 2",
        value: "Ibu kota Indonesia saat ini berada di Provinsi Bali.",
      },
      {
        label: "Pernyataan 3",
        value: "Indonesia beriklim tropis dengan dua musim utama.",
      },
      { label: "Kunci Jawaban", value: "B, S, B", emphasize: true },
      {
        label: "Pembahasan",
        value: "Pernyataan 1 dan 3 benar; pernyataan 2 salah.",
      },
    ],
  },
  {
    title: "Soal 4 — Contoh Uraian / Esai (URAIAN)",
    rows: [
      { label: "Tipe Soal", value: "URAIAN", emphasize: true },
      { label: "Kesulitan", value: "Sulit" },
      { label: "Bobot", value: "5" },
      { label: "Topik", value: "Penalaran Sains" },
      {
        label: "Pertanyaan",
        value:
          "Jelaskan proses terjadinya siklus air (hidrologi) secara singkat dan runtut!",
      },
      {
        label: "Kunci Jawaban",
        value:
          "Menyebutkan tahapan evaporasi/transpirasi, kondensasi, presipitasi, dan infiltrasi/aliran permukaan secara benar (skor penuh 5).",
        emphasize: true,
      },
      {
        label: "Pembahasan",
        value: "Penilaian guru berdasarkan kelengkapan 4 tahap utama siklus air.",
      },
    ],
  },
];

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
  left: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
  right: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
};

function buildSampleTable(sample: QuestionTemplateSample): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: sample.rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 28, type: WidthType.PERCENTAGE },
              shading: {
                fill: "EEF2FF",
                type: ShadingType.CLEAR,
                color: "auto",
              },
              margins: { top: 90, bottom: 90, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: row.label,
                      bold: true,
                      size: 20,
                      color: "1E3A8A",
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 72, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: row.value,
                      bold: Boolean(row.emphasize),
                      size: 20,
                      color: "0F172A",
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function guideBullet(lead: string, detail: string): Paragraph {
  return new Paragraph({
    spacing: { after: 70 },
    bullet: { level: 0 },
    children: [
      new TextRun({ text: `${lead}: `, bold: true, size: 20, color: "0F172A" }),
      new TextRun({ text: detail, size: 20, color: "334155" }),
    ],
  });
}

/**
 * Generates an official Microsoft Word (.docx) template with structured 2-column question tables.
 */
export async function buildQuestionTemplateDocxBuffer(): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: "TEMPLATE BANK SOAL — CBT SMART EXAM",
          bold: true,
          size: 30,
          color: "1E3A8A",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "Format Tabel Terstruktur untuk import soal Pilihan Ganda (PG), MCMA, Benar/Salah (BS), dan Uraian.",
          italics: true,
          size: 20,
          color: "475569",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: "Petunjuk Pengisian:",
          bold: true,
          size: 22,
          color: "0F172A",
        }),
      ],
    }),
    guideBullet(
      "Aturan Tabel",
      "Setiap 1 tabel mewakili 1 butir soal. Salin-tempel (Copy–Paste) salah satu tabel di bawah ini untuk menambah nomor soal berikutnya."
    ),
    guideBullet(
      "Tipe Soal",
      "Isi PG (Pilihan Ganda Tunggal), MCMA (banyak jawaban benar), BS (Benar/Salah multi-pernyataan), atau URAIAN (esai penilaian manual)."
    ),
    guideBullet(
      "Format Kunci Jawaban",
      "PG isi 1 huruf (misal: A). MCMA pisahkan koma (misal: A, B, D). BS pisahkan koma sesuai urutan Pernyataan (misal: B, S, B atau Benar, Salah, Benar). URAIAN isi pedoman rubrik penilaian."
    ),
    guideBullet(
      "Rumus & Gambar",
      "Rumus matematika KaTeX ditulis dengan $...$ (misal: $\\frac{1}{2}$). Gambar atau format tebal/miring/pangkat dapat langsung dimasukkan ke sel Pertanyaan atau Pilihan."
    ),
  ];

  for (const sample of TEMPLATE_SAMPLES) {
    children.push(
      new Paragraph({
        spacing: { before: 260, after: 100 },
        children: [
          new TextRun({
            text: sample.title,
            bold: true,
            size: 22,
            color: "1E3A8A",
          }),
        ],
      }),
      buildSampleTable(sample)
    );
  }

  const doc = new Document({
    creator: "CBT SMART EXAM",
    title: "Template Bank Soal CBT SMART EXAM",
    description:
      "Template resmi Word (.docx) format tabel terstruktur untuk import bank soal.",
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, bottom: 900, left: 950, right: 950 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `CBT SMART EXAM • ${APP_AUTHOR_CREDIT}`,
                    size: 16,
                    color: "64748B",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
