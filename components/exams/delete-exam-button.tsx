"use client";

import React, { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteExamButton({
  examId,
  examTitle,
  examStatus,
  onDeleted,
  label = "Hapus",
}: {
  examId: string;
  examTitle: string;
  examStatus?: string;
  onDeleted: (deletedId: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [requiresForce, setRequiresForce] = useState(false);
  const [attemptsCount, setAttemptsCount] = useState(0);
  const [forceConfirmed, setForceConfirmed] = useState(false);

  function openDialog() {
    setErrorMsg(null);
    setRequiresForce(false);
    setAttemptsCount(0);
    setForceConfirmed(false);
    setOpen(true);
  }

  async function handleConfirmDelete() {
    if (requiresForce && !forceConfirmed) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/exams/${examId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: forceConfirmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.error || "Gagal menghapus ujian.";
        setErrorMsg(msg);
        if (data?.requiresForce) {
          setRequiresForce(true);
          setAttemptsCount(Number(data.attemptsCount || 0));
        }
        toast.error(msg);
        return;
      }
      toast.success(`Ujian "${examTitle}" berhasil dihapus.`);
      setOpen(false);
      onDeleted(examId);
    } catch {
      setErrorMsg("Kesalahan jaringan saat menghapus ujian.");
      toast.error("Kesalahan jaringan saat menghapus ujian.");
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
        aria-label={`Hapus ujian ${examTitle}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {label}
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
            <DialogTitle>Hapus Jadwal Ujian</DialogTitle>
            <DialogDescription>
              Anda akan menghapus ujian <strong>{examTitle}</strong> beserta sesi, penugasan
              peserta, dan token terkait. Bank soal sumber tetap aman dan tidak ikut terhapus.
            </DialogDescription>
          </DialogHeader>

          {examStatus === "active" && !errorMsg && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
              Ujian ini berstatus <strong>active</strong>. Jeda, tutup, atau batalkan ujian
              terlebih dahulu sebelum menghapus.
            </div>
          )}

          {errorMsg && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
              {errorMsg}
            </div>
          )}

          {requiresForce && (
            <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={forceConfirmed}
                onChange={(e) => setForceConfirmed(e.target.checked)}
              />
              <span>
                Saya paham dan ingin menghapus permanen ujian ini beserta{" "}
                <strong>{attemptsCount} riwayat pengerjaan dan nilai siswa</strong>.
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2">
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
              disabled={deleting || (requiresForce && !forceConfirmed)}
              onClick={handleConfirmDelete}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {requiresForce ? "Hapus Permanen" : "Ya, Hapus Ujian"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
