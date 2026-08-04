"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface Current {
  filename: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function MinibusChecklistManager({ current }: { current: Current | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/minibus-checklist", { method: "POST", body: form });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(data.error?.message ?? "Upload failed");
        return;
      }
      toast.success(current ? "Checklist replaced" : "Checklist uploaded");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {current ? (
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <FileText className="h-8 w-8 flex-shrink-0 text-primary" />
                <div>
                  <p className="font-medium">{current.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(current.size)} · uploaded {formatDate(current.uploadedAt)} by{" "}
                    {current.uploadedBy}
                  </p>
                </div>
              </div>
              <a href="/api/admin/minibus-checklist/file" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Download className="mr-1 h-4 w-4" /> View
                </Button>
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No checklist uploaded yet. Minibus bookers still receive their confirmation email —
              it just won&apos;t have the checklist attached until you upload one here.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <label className="text-sm font-medium">
          {current ? "Replace checklist" : "Upload checklist"}
        </label>
        <div className="flex items-center gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
          />
          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">PDF or Word document, max 4 MB.</p>
      </div>
    </div>
  );
}
