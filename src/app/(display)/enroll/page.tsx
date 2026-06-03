"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function EnrollContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"enrolling" | "success" | "error">("enrolling");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setStatus("error");
      setError("No pairing code found in URL. Ask your administrator to generate a new one.");
      return;
    }

    fetch("/api/devices/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Enrollment failed");
        }
        return res.json() as Promise<{ token: string; deviceId: string }>;
      })
      .then(({ token }) => {
        localStorage.setItem("device_token", token);
        setStatus("success");
        setTimeout(() => router.replace("/display"), 1500);
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      });
  }, [searchParams, router]);

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-sm">
        {status === "enrolling" && (
          <>
            <div className="text-3xl font-light">Pairing display…</div>
            <div className="text-gray-400">Please wait</div>
          </>
        )}
        {status === "success" && (
          <>
            <div className="text-4xl">✓</div>
            <div className="text-2xl font-light">Paired successfully</div>
            <div className="text-gray-400">Loading display…</div>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl text-red-400">✗</div>
            <div className="text-xl text-red-300">Pairing failed</div>
            <div className="text-sm text-gray-300">{error}</div>
            <div className="text-xs text-gray-500 mt-6 border border-gray-700 rounded p-4">
              Contact your administrator for a new pairing code. Codes expire after 10 minutes.
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function EnrollPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="text-gray-400">Loading…</div>
        </main>
      }
    >
      <EnrollContent />
    </Suspense>
  );
}
