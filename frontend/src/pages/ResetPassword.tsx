import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { ApiError, apiFetch } from "../api/client";
import { AuthCard } from "../components/AuthCard";
import { Banner, PasswordField, TextField } from "../components/FormFields";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (mismatch) {
      setFieldErrors({ confirmPassword: "Passwords do not match" });
      return;
    }

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      await apiFetch(
        "/auth/reset-password",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            code: code.trim(),
            password,
            confirmPassword,
          }),
        },
        false,
      );
      setDone(true);
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

  if (email === "") {
    return (
      <AuthCard
        title="Code required"
        subtitle="This page needs the e-mail address the verification code was sent to."
        footer={
          <Link
            to="/forgot-password"
            className="font-medium text-blue-400 transition hover:text-blue-300"
          >
            Request a new code
          </Link>
        }
      >
        <Banner tone="error">
          No e-mail address was provided. Request a code first, then enter it
          on the next screen.
        </Banner>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={done ? "Password updated" : "Enter your reset code"}
      subtitle={
        done
          ? "Your previous sessions have been signed out for safety."
          : "Type the 6-digit code we e-mailed you, then pick a password you do not reuse anywhere else."
      }
      footer={
        done ? (
          <Link
            to="/login"
            className="font-medium text-blue-400 transition hover:text-blue-300"
          >
            Continue to sign in
          </Link>
        ) : (
          <Link
            to="/login"
            className="font-medium text-blue-400 transition hover:text-blue-300"
          >
            Back to sign in
          </Link>
        )
      }
    >
      {done ? (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-emerald-400" />
          <p className="mt-3 font-medium text-emerald-300">
            Your password has been changed
          </p>
          <p className="mt-1 text-sm text-emerald-300/70">
            Sign in with your new password to get back to your dashboard.
          </p>

          <Link
            to="/login"
            className="mt-5 w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          <Banner tone="error">{error}</Banner>

          <p className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-400">
            Code sent to <span className="text-slate-200">{email}</span>{" "}
            <Link
              to="/forgot-password"
              className="ml-1 font-medium text-blue-400 hover:text-blue-300"
            >
              (change)
            </Link>
          </p>

          <TextField
            id="code"
            label="Verification code"
            value={code}
            onChange={(value) =>
              setCode(value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="123456"
            autoComplete="one-time-code"
            required
            autoFocus
            error={fieldErrors.code}
          />

          <PasswordField
            id="password"
            label="New password"
            value={password}
            onChange={setPassword}
            placeholder="Enter a new password"
            autoComplete="new-password"
            required
            error={fieldErrors.password}
          />

          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repeat the new password"
            autoComplete="new-password"
            required
            error={fieldErrors.confirmPassword}
          />

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Updating password…
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Update password
              </>
            )}
          </button>

          <p className="text-center text-sm text-slate-400">
            No code yet?{" "}
            <Link
              to="/forgot-password"
              className="font-medium text-blue-400 hover:text-blue-300"
            >
              Request a new one
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
