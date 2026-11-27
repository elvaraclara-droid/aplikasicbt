"use client";

import React, { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  countRelatedSchoolData,
  type SchoolDeletionSummary,
} from "@/lib/schools/deletion-guard";

export function DeleteSchoolButton({
  schoolId,
  schoolCode,
  schoolName,
  onDeleted,
}: {
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  onDeleted: (deletedId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState<SchoolDeletionSummary | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [forceConfirmed, setForceConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setConfirmCode("");
    setForceConfirmed(false);
    setErrorMsg(null);
    setSummary(null);
    setLoadingSummary(true);

    try {
      const res = await fetch(`/api/super-admin/schools/${schoolId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMsg(data?.error || "Gagal memuat ringkasan data sekolah.");
        return;
      }
      setSummary(data.summary || null);
    } catch {
      setErrorMsg("Kesalahan jaringan saat memeriksa data sekolah.");
    } finally {
      setLoadingSummary(false);
    }
  }

  const hasActiveExamOrAttempts =
    Boolean(summary) &&
    ((summary?.activeExamsCount ?? 0) > 0 || (summary?.activeAttemptsCount ?? 0) > 0);
  const relatedCount = summary ? countRelatedSchoolData(summary) : 0;
  const codeMatches =
    confirmCode.trim().toUpperCase() === schoolCode.trim().toUpperCase();

  const canSubmit =
    !loadingSummary &&
    !deleting &&
    Boolean(summary) &&
    !hasActiveExamOrAttempts &&
    codeMatches &&
    (relatedCount === 0 || forceConfirmed);

  async function handleConfirmDelete() {
    if (!canSubmit) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/super-admin/schools/${schoolId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmCode: confirmCode.trim(),
          force: forceConfirmed,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.error || "Gagal menghapus sekolah.";
        setErrorMsg(msg);
        if (data?.summary) setSummary(data.summary);
        toast.error(msg);
        return;
      }

      toast.success(`Sekolah "${schoolName}" (${schoolCode}) berhasil dihapus permanen.`);
      setOpen(false);
      onDeleted(schoolId);
    } catch {
      setErrorMsg("Kesalahan jaringan saat menghapus sekolah.");
      toast.error("Kesalahan jaringan saat menghapus sekolah.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={openDialog}
        aria-label={`Hapus sekolah ${schoolName}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Hapus
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleting) {
            setOpen(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
              Hapus Sekolah Permanen
            </DialogTitle>
            <DialogDescription>
              Anda akan menghapus sekolah <strong>{schoolName}</strong> (kode:{" "}
              <strong>{schoolCode}</strong>). Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>

          {loadingSummary ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memeriksa jumlah akun, bank soal, dan ujian terkait...
            </div>
          ) : summary ? (
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-3">
              <div>
                <p className="text-slate-500">Akun Pengguna</p>
                <p className="font-bold text-slate-900">{summary.usersCount}</p>
              </div>
              <div>
                <p className="text-slate-500">Guru / Siswa</p>
                <p className="font-bold text-slate-900">
                  {summary.teachersCount} / {summary.studentsCount}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Bank Soal / Ujian</p>
                <p className="font-bold text-slate-900">
                  {summary.banksCount} / {summary.examsCount}
                </p>
              </div>
            </div>
          ) : null}

          {hasActiveExamOrAttempts && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-950">
              Sekolah masih memiliki {summary?.activeExamsCount} ujian aktif dan{" "}
              {summary?.activeAttemptsCount} pengerjaan aktif. Hentikan/selesaikan ujian
              tersebut terlebih dahulu.
            </div>
          )}

          {errorMsg && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
              {errorMsg}
            </div>
          )}

          {!hasActiveExamOrAttempts && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`confirm-school-${schoolId}`} className="text-xs">
                  Ketik kode sekolah <strong>{schoolCode}</strong> untuk konfirmasi
                </Label>
                <Input
                  id={`confirm-school-${schoolId}`}
                  placeholder={schoolCode}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  disabled={deleting}
                />
              </div>

              {relatedCount > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-950">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={forceConfirmed}
                    onChange={(e) => setForceConfirmed(e.target.checked)}
                    disabled={deleting}
                  />
                  <span>
                    Saya paham seluruh akun pengguna (Admin, Guru, Pengawas, Siswa), kelas,
                    bank soal, jadwal ujian, media, dan nilai di sekolah ini akan dihapus
                    permanen.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canSubmit}
              onClick={handleConfirmDelete}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Hapus Sekolah
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
