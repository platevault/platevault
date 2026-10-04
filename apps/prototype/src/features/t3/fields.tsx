/**
 * Small T3 form helpers on the shared primitives: a labelled Select and a
 * labelled number input. Labels are persistent and associated (forms guide).
 */
import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface Option {
  value: string
  label: string
}

/** Select with a visible label. `value` is a string; use a sentinel such as "any" for "no choice". */
export function SelectField({
  label,
  value,
  options,
  onChange,
  description,
  disabled,
  className,
  triggerClassName,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  description?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}) {
  const labelId = useId()
  const descriptionId = useId()
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label id={labelId}>{label}</Label>
      <Select items={options} value={value} onValueChange={(next) => onChange(String(next))} disabled={disabled}>
        <SelectTrigger aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined} className={cn("w-full", triggerClassName)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}

/** Number input that reports null when empty. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  step,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  min?: number
  step?: number
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {unit ? <span className="font-normal text-muted-foreground"> ({unit})</span> : null}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </div>
  )
}
