import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { ApiError, apiFetch } from "../api/client";
import { AuthCard } from "../components/AuthCard";
import { Banner, TextField } from "../components/FormFields";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      await apiFetch(
        "/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email: email.trim() }) },
        false,
      );
      setSubmitted(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fields);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetPath = `/reset-password?email=${encodeURIComponent(email.trim())}`;

  return (
    <AuthCard
      title={submitted ? "Check your inbox" : "Reset your password"}
      subtitle={
        submitted
          ? "If that address belongs to an account, a 6-digit code is on its way."
          : "Enter the e-mail address on your account and we will send you a 6-digit code to choose a new password."
      }
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium text-blue-400 transition hover:text-blue-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      }
    >
      {submitted ? (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="font-medium text-emerald-300">
                Code sent to {email.trim()}
              </p>
              <p className="mt-1 text-sm text-emerald-300/70">
                The code expires in 30 minutes and can only be used once. If it
                has not arrived, check your spam folder or try again in a few
                minutes.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(resetPath)}
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold transition hover:bg-blue-500"
          >
            Enter the code
          </button>

          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="mt-2 w-full rounded-lg border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800"
          >
            Use a different address
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          <Banner tone="error">{error}</Banner>

          <TextField
            id="email"
            label="E-mail"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            required
            autoFocus
            error={fieldErrors.email}
          />

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending code…
              </>
            ) : (
              "Send verification code"
            )}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
