export const runtime = "nodejs";

export default function MinibusPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-20 h-20 rounded-2xl bg-secondary-container flex items-center justify-center mb-6">
        <span className="material-symbols-outlined text-5xl text-on-secondary-container">directions_bus</span>
      </div>
      <h1 className="font-display font-extrabold text-headline-lg text-on-background mb-3">
        Minibus Booking
      </h1>
      <p className="text-body-md text-on-surface-variant max-w-md mb-2">
        Online minibus booking is coming soon. You&apos;ll be able to request a college minibus for trips,
        specify driver, passengers and destination, and notify premises automatically.
      </p>
      <p className="text-label-md font-label-md text-on-surface-variant">
        In the meantime, please contact the premises team directly.
      </p>
    </div>
  );
}
