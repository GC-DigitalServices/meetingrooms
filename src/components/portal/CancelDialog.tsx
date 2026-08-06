"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  roomName: string;
  roomId?: string;
  onSuccess?: () => void;
}

export default function CancelDialog({ open, onClose, bookingId, roomName, roomId, onSuccess }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Booking cancelled", roomId ? {
          action: {
            label: "Book again",
            onClick: () => router.push(`/rooms/${roomId}`),
          },
        } : undefined);
        onSuccess?.();
        onClose();
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        toast.error(data.error?.message ?? "Could not cancel booking");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel booking?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel your booking for <strong>{roomName}</strong>. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>Keep booking</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleConfirm}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Yes, cancel"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
