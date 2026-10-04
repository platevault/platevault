/**
 * Form field helpers for T1 dialogs. Each field keeps a persistent label, an
 * optional description and an error that names the field and the problem.
 * Errors appear only after a submit attempt (modern-web-guidance
 * `accessible-error-announcement`): the input gets `aria-invalid` and points
 * at the message with `aria-describedby`, and the first invalid field takes
 * focus so the message is read.
 */
import { CircleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface TextFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  description?: ReactNode
  placeholder?: string
  inputMode?: "text" | "decimal" | "numeric"
  mono?: boolean
  className?: string
  autoFocus?: boolean
  readOnly?: boolean
}

export function TextField({ id, label, value, onChange, error, description, placeholder, inputMode, mono, className, autoFocus, readOnly }: TextFieldProps) {
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <Field className={cn("gap-1.5", className)} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        readOnly={readOnly}
        className={cn(mono && "font-mono text-xs md:text-xs", inputMode && inputMode !== "text" && "tabular-nums")}
      />
      {description ? (
        <FieldDescription id={`${id}-description`} className="text-xs">
          {description}
        </FieldDescription>
      ) : null}
      <FieldMessage id={`${id}-error`} message={error} />
    </Field>
  )
}

/** Field-level error text; rendered only when there is a message. */
export function FieldMessage({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs text-destructive">
      <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span className="text-pretty">{message}</span>
    </p>
  )
}

/** After a failed submit, move focus to the first invalid control so its message is announced. */
export function focusFirstInvalid(form: HTMLElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
}

/** Parses a decimal number typed by the user; empty input is `null`, junk is `NaN`. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".").replace("−", "-")
  if (!trimmed) return null
  return /^[-+]?\d*\.?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/** "Ha, H-alpha" → ["Ha", "H-alpha"], trimmed and de-duplicated. */
export function parseAliases(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))]
}
