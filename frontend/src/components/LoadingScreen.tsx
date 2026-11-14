import { Loader2 } from "lucide-react";

/**
 * Full-screen placeholder used while the session is being restored, so the
 * router never briefly shows the sign-in page to a signed-in user.
 */
export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
