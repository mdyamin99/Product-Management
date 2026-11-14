import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Rendered under the card, e.g. a link to the opposite page. */
  footer: ReactNode;
}

/**
 * Centred shell shared by the sign-in and sign-up screens. Reuses the same
 * slate/blue tokens as the dashboard so the two feel like one product.
 */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="rounded-xl bg-blue-600 p-3 text-xl">📦</div>
          <div className="text-center sm:text-left">
            <p className="text-xl font-bold">Product Monitor</p>
            <p className="mt-0.5 text-sm text-slate-400">
              PostgreSQL · Redis · Kafka · RabbitMQ
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>

          {children}
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">{footer}</p>
      </div>
    </main>
  );
}
