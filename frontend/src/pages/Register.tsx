import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AuthCard } from "../components/AuthCard";
import { Banner, PasswordField, TextField } from "../components/FormFields";
import { LoadingScreen } from "../components/LoadingScreen";

/** Mirrors the rules enforced by `registerSchema` on the server. */
const RULES: { label: string; test: (value: string) => boolean }[] = [
  { label: "At least 8 characters", test: (v) => v.length >= 8 },
  {
    label: "Upper and lower case letters",
    test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  { label: "At least one number", test: (v) => /[0-9]/.test(v) },
];

function strengthOf(password: string) {
  const passed = RULES.filter((rule) => rule.test(password)).length;

  if (password.length === 0) {
    return { score: 0, label: "Enter a password", bar: "bg-slate-700" };
  }

  const extra = password.length >= 12 && /[^A-Za-z0-9]/.test(password) ? 1 : 0;
  const score = Math.min(4, passed + extra);

  const levels = [
    { label: "Too weak", bar: "bg-red-500" },
    { label: "Weak", bar: "bg-red-500" },
    { label: "Fair", bar: "bg-amber-500" },
    { label: "Good", bar: "bg-blue-500" },
    { label: "Strong", bar: "bg-emerald-500" },
  ];

  const level = levels[score] ?? levels[0] ?? { label: "Weak", bar: "bg-red-500" };

  return { score, label: level.label, bar: level.bar };
}

export default function Register() {
  const { status, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const strength = strengthOf(password);
  const mismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

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
      await register({ name: name.trim(), email: email.trim(), password, confirmPassword });
      navigate("/", { replace: true });
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

  if (status === "loading") {
    return <LoadingScreen label="Restoring your session…" />;
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start tracking products in seconds. No credit card required."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-blue-400 transition hover:text-blue-300"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <Banner tone="error">{error}</Banner>

        <TextField
          id="name"
          label="Full name"
          value={name}
          onChange={setName}
          placeholder="e.g. Alex Rahman"
          autoComplete="name"
          required
          autoFocus
          error={fieldErrors.name}
        />

        <TextField
          id="email"
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          required
          error={fieldErrors.email}
        />

        <div>
          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="Create a password"
            autoComplete="new-password"
            required
            error={fieldErrors.password}
          />

          {password.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${strength.bar}`}
                    style={{ width: `${(strength.score / 4) * 100}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs text-slate-400">
                  {strength.label}
                </span>
              </div>

              <ul className="mt-3 space-y-1.5">
                {RULES.map((rule) => {
                  const satisfied = rule.test(password);

                  return (
                    <li
                      key={rule.label}
                      className={`flex items-center gap-2 text-xs ${
                        satisfied ? "text-emerald-400" : "text-slate-500"
                      }`}
                    >
                      {satisfied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Repeat your password"
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
              Creating account…
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" />
              Create account
            </>
          )}
        </button>

        <p className="text-center text-xs text-slate-500">
          By creating an account you agree to keep your API keys out of source
          control.
        </p>
      </form>
    </AuthCard>
  );
}
