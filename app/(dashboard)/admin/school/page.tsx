"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeletableAcademicEntity } from "@/lib/academic/deletion-guard";
import type { ClassRef, SubjectRef } from "@/types/views";

interface SchoolProfileState {
  code: string;
  name: string;
  npsn: string | null;
  city: string | null;
}

interface SchoolSettingsState {
  default_face_verification: boolean;
  default_tab_switch_warning_threshold: number;
  default_tab_switch_review_threshold: number;
  face_data_retention_days: number;
}

interface AcademicYearRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

interface SemesterRow {
  id: string;
  name: string;
  is_active: boolean;
}

export default function SchoolDataManagementPage() {
  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<SchoolProfileState | null>(null);
  const [settings, setSettings] = useState<SchoolSettingsState | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [semesters, setSemesters] = useState<SemesterRow[]>([]);
  const [classes, setClasses] = useState<ClassRef[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);

  // Form states
  const [ayName, setAyName] = useState("");
  const [ayStart, setAyStart] = useState("2026-07-01");
  const [ayEnd, setAyEnd] = useState("2027-06-30");

  const [classCode, setClassCode] = useState("");
  const [className, setClassName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("X");

  const [subjCode, setSubjCode] = useState("");
  const [subjName, setSubjName] = useState("");

  interface DeleteTarget {
    entity: DeletableAcademicEntity;
    id: string;
    label: string;
    entityTitle: string;
    detail?: string;
  }
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/academic");
      const data = await res.json();
      setSchool(data.school);
      setSettings(data.settings);
      setAcademicYears(data.academicYears || []);
      setSemesters(data.semesters || []);
      setClasses(data.classes || []);
      setSubjects(data.subjects || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveEntity(entity: string, payload: Record<string, unknown>, onOk?: () => void) {
    const res = await fetch("/api/admin/academic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Gagal menyimpan data");
      return;
    }
    toast.success("Data berhasil disimpan.");
    onOk?.();
    loadData();
  }

  function openDeleteConfirm(target: DeleteTarget) {
    setDeleteError(null);
    setDeleteTarget(target);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/academic", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: deleteTarget.entity,
          id: deleteTarget.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Gagal menghapus data";
        setDeleteError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`${deleteTarget.entityTitle} "${deleteTarget.label}" berhasil dihapus.`);
      setDeleteTarget(null);
      loadData();
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Memuat data sekolah...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Data Sekolah & Pengaturan CBT</h1>
        <p className="text-sm text-slate-500">
          Kelola identitas sekolah, tahun pelajaran, semester, kelas, mata pelajaran, serta
          kebijakan default anti-cheating dan verifikasi wajah.
        </p>
      </div>

      {/* School Profile + Security Settings */}
      <div className="grid gap-6 lg:grid-cols-2">
        {school && (
          <Card>
            <CardHeader>
              <CardTitle>Identitas Sekolah ({school.code})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Nama Sekolah</Label>
                <Input
                  value={school.name}
                  onChange={(e) => setSchool({ ...school, name: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>NPSN</Label>
                  <Input
                    value={school.npsn || ""}
                    onChange={(e) => setSchool({ ...school, npsn: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Kota</Label>
                  <Input
                    value={school.city || ""}
                    onChange={(e) => setSchool({ ...school, city: e.target.value })}
                  />
                </div>
              </div>
              <Button
                onClick={() =>
                  saveEntity("school_profile", {
                    name: school.name,
                    npsn: school.npsn,
                    city: school.city,
                  })
                }
              >
                <Save className="h-4 w-4" /> Simpan Profil Sekolah
              </Button>
            </CardContent>
          </Card>
        )}

        {settings && (
          <Card>
            <CardHeader>
              <CardTitle>Kebijakan Keamanan & Verifikasi Wajah Default</CardTitle>
              <CardDescription>
                Default verifikasi wajah adalah NONAKTIF (OFF) sesuai standar operasional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <span>Aktifkan Verifikasi Wajah Default (Opsional)</span>
                <input
                  type="checkbox"
                  checked={Boolean(settings.default_face_verification)}
                  onChange={(e) =>
                    setSettings({ ...settings, default_face_verification: e.target.checked })
                  }
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Ambang Warning</Label>
                  <Input
                    type="number"
                    min={1}
                    value={settings.default_tab_switch_warning_threshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        default_tab_switch_warning_threshold: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Ambang Periksa</Label>
                  <Input
                    type="number"
                    min={1}
                    value={settings.default_tab_switch_review_threshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        default_tab_switch_review_threshold: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Retensi Foto (Hari)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={settings.face_data_retention_days}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        face_data_retention_days: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <Button
                onClick={() =>
                  saveEntity("school_settings", {
                    default_face_verification: settings.default_face_verification,
                    default_tab_switch_warning_threshold:
                      settings.default_tab_switch_warning_threshold,
                    default_tab_switch_review_threshold:
                      settings.default_tab_switch_review_threshold,
                    face_data_retention_days: settings.face_data_retention_days,
                  })
                }
              >
                <Save className="h-4 w-4" /> Simpan Kebijakan
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Academic Years & Semesters, Classes, Subjects */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tahun Pelajaran & Semester</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Input
                placeholder="2026/2027"
                value={ayName}
                onChange={(e) => setAyName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={ayStart} onChange={(e) => setAyStart(e.target.value)} />
                <Input type="date" value={ayEnd} onChange={(e) => setAyEnd(e.target.value)} />
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() =>
                  saveEntity(
                    "academic_year",
                    { name: ayName, start_date: ayStart, end_date: ayEnd, is_active: true },
                    () => setAyName("")
                  )
                }
              >
                <Plus className="h-4 w-4" /> Tambah Tahun Pelajaran
              </Button>
            </div>
            <div className="space-y-1.5 text-xs">
              {academicYears.map((ay) => (
                <div
                  key={ay.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 p-2"
                >
                  <span className="font-medium">{ay.name}</span>
                  <div className="flex items-center gap-1">
                    {ay.is_active && <Badge variant="success">Aktif</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        saveEntity("semester", {
                          academic_year_id: ay.id,
                          name: "Semester Ganjil",
                          semester_number: 1,
                          start_date: ay.start_date,
                          end_date: ay.end_date,
                          is_active: true,
                        })
                      }
                    >
                      +Sem 1
                    </Button>
                    <DeleteAcademicIconButton
                      ariaLabel={`Hapus tahun pelajaran ${ay.name}`}
                      onClick={() =>
                        openDeleteConfirm({
                          entity: "academic_year",
                          id: ay.id,
                          label: ay.name,
                          entityTitle: "Tahun Pelajaran",
                          detail:
                            "Semester di bawah tahun pelajaran ini yang belum digunakan pada ujian akan ikut dihapus.",
                        })
                      }
                    />
                  </div>
                </div>
              ))}
              {semesters.map((sm) => (
                <div
                  key={sm.id}
                  className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                >
                  <span>
                    {sm.name} ({sm.is_active ? "Aktif" : "Arsip"})
                  </span>
                  <DeleteAcademicIconButton
                    ariaLabel={`Hapus semester ${sm.name}`}
                    onClick={() =>
                      openDeleteConfirm({
                        entity: "semester",
                        id: sm.id,
                        label: sm.name,
                        entityTitle: "Semester",
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Kelas ({classes.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Kode (X-IPA-1)"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
              />
              <Input
                placeholder="Nama Kelas"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
              />
              <Input
                placeholder="Tingkat (X)"
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() =>
                saveEntity(
                  "class",
                  { code: classCode, name: className, grade_level: gradeLevel },
                  () => {
                    setClassCode("");
                    setClassName("");
                  }
                )
              }
            >
              <Plus className="h-4 w-4" /> Tambah Kelas
            </Button>
            <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {classes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2"
                >
                  <span className="font-medium">
                    {c.name} ({c.code})
                  </span>
                  <div className="flex items-center gap-1">
                    <Badge variant="default">Tingkat {c.grade_level}</Badge>
                    {c.id && (
                      <DeleteAcademicIconButton
                        ariaLabel={`Hapus kelas ${c.name}`}
                        onClick={() =>
                          openDeleteConfirm({
                            entity: "class",
                            id: c.id!,
                            label: `${c.name}${c.code ? ` (${c.code})` : ""}`,
                            entityTitle: "Kelas",
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mata Pelajaran ({subjects.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Kode (MTK-X)"
                value={subjCode}
                onChange={(e) => setSubjCode(e.target.value)}
              />
              <Input
                placeholder="Nama Mapel"
                value={subjName}
                onChange={(e) => setSubjName(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() =>
                saveEntity("subject", { code: subjCode, name: subjName }, () => {
                  setSubjCode("");
                  setSubjName("");
                })
              }
            >
              <Plus className="h-4 w-4" /> Tambah Mata Pelajaran
            </Button>
            <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {subjects.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2"
                >
                  <span className="font-medium">{sub.name}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="primary">{sub.code}</Badge>
                    {sub.id && (
                      <DeleteAcademicIconButton
                        ariaLabel={`Hapus mata pelajaran ${sub.name}`}
                        onClick={() =>
                          openDeleteConfirm({
                            entity: "subject",
                            id: sub.id!,
                            label: `${sub.name}${sub.code ? ` (${sub.code})` : ""}`,
                            entityTitle: "Mata Pelajaran",
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus {deleteTarget?.entityTitle}</DialogTitle>
            <DialogDescription>
              Anda akan menghapus <strong>{deleteTarget?.label}</strong>. Data yang masih digunakan
              oleh siswa, penugasan guru, bank soal, atau jadwal ujian akan otomatis ditolak agar
              data ujian tidak rusak.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget?.detail && (
            <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {deleteTarget.detail}
            </p>
          )}
          {deleteError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
              {deleteError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={handleConfirmDelete}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeleteAcademicIconButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 w-7 shrink-0 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
