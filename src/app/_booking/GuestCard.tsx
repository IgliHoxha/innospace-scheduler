import { MAX_EMAIL, MAX_NAME } from "@/lib/types";
import type { GuestField } from "@/lib/guest";
import { GoogleMark } from "./GoogleMark";

export type GuestErrors = Partial<Record<GuestField, string>>;

const FIELDS: {
  id: GuestField;
  label: string;
  type: string;
  autoComplete: string;
  placeholder: string;
  maxLength: number;
}[] = [
  {
    id: "fullName",
    label: "Full name",
    type: "text",
    autoComplete: "name",
    placeholder: "First and last name",
    maxLength: MAX_NAME,
  },
  {
    id: "email",
    label: "Email",
    type: "email",
    autoComplete: "email",
    placeholder: "you@example.com",
    maxLength: MAX_EMAIL,
  },
];

export function GuestCard({
  values,
  errors,
  onEdit,
  googleSignIn,
}: {
  values: Record<GuestField, string>;
  errors: GuestErrors;
  onEdit: (field: GuestField, value: string) => void;
  /** Google sign-in is configured, so a guest can be offered it. */
  googleSignIn: boolean;
}) {
  const errorOf = (field: GuestField) => errors[field] ?? "";
  return (
    <>
      <div className="field-label">Your details</div>
      <div className="card guest-card">
        <div className="guest-row">
          {FIELDS.map((f) => (
            <label key={f.id} className="guest-field">
              <span>
                {f.label} <b aria-hidden="true">*</b>
              </span>
              <input
                id={f.id}
                name={f.id}
                type={f.type}
                autoComplete={f.autoComplete}
                placeholder={f.placeholder}
                maxLength={f.maxLength}
                required
                aria-invalid={!!errorOf(f.id)}
                aria-describedby={errorOf(f.id) ? `${f.id}-error` : undefined}
                className={errorOf(f.id) ? "invalid" : ""}
                value={values[f.id]}
                onChange={(e) => onEdit(f.id, e.target.value)}
              />
            </label>
          ))}
        </div>
        {/* A red field is the only visible cue; its reason is read on focus. */}
        {FIELDS.map((f) => (
          <span key={f.id} id={`${f.id}-error`} className="sr-only">
            {errorOf(f.id)}
          </span>
        ))}
        {googleSignIn && (
          <div className="sign-in-offer">
            <a className="btn ghost sm google-btn" href="/api/auth/google">
              <GoogleMark />
              Sign in with Google
            </a>
            <span>
              Optional: skips the typing and lets you repeat a booking weekly.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
