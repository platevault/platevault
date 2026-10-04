/**
 * T4 prototype controls (labelled "Prototype"): the outside-world changes the
 * J24 and J26 steps need that the foundation's simulation sheet does not
 * offer, scoped to the screen they serve. They change the simulated disk, the
 * simulated computer or arm a one-shot pause; they never write the catalog.
 */
import { FlaskConical } from "lucide-react"
import { type ReactNode, useId } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function PrototypeToggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {detail ? <p className="text-xs text-pretty text-muted-foreground">{detail}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(value) => onChange(value)} />
    </div>
  )
}

export function PrototypeControls({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border border-dashed border-input">
      <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start rounded-lg" />}>
        <FlaskConical aria-hidden="true" data-icon="inline-start" />
        Prototype: {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-dashed border-input px-3 py-3 text-sm">
        <p className="text-xs text-pretty text-muted-foreground">Simulates changes outside PlateVault for review. Not part of the product.</p>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}