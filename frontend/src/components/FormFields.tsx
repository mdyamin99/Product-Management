import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

type Tone = "error" | "success" | "info";

const TONES: Record<Tone, string> = {
  error: "border-red-500/30 bg-red-500/10 text-red-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
};

export function Banner({
  tone = "info",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  if (!children) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-5 rounded-xl border p-4 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
  error?: string;
  /** Rendered inside the field on the right, e.g. a visibility toggle. */
  trailing?: ReactNode;
}

export function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  required,
  autoFocus,
  error,
  trailing,
}: TextFieldProps) {
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm text-slate-300">
        {label}
        {required && <span className="text-blue-400"> *</span>}
      </label>

      <div className="relative">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-lg border bg-slate-950 px-4 py-3 outline-none transition placeholder:text-slate-600 focus:border-blue-500 ${
            trailing ? "pr-12" : ""
          } ${error ? "border-red-500/60" : "border-slate-700"}`}
        />

        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {trailing}
          </div>
        )}
      </div>

      {error && (
        <p id={`${id}-error`} className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** `TextField` with a show/hide affordance for password entry. */
export function PasswordField(props: Omit<TextFieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="rounded p-1 text-slate-500 transition hover:text-slate-300"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      }
    />
  );
}
