/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): the L1 primitives in components/ui that pages reach through the L2
 * patterns, each in the use those patterns make of it, plus the small L2 parts that have no entry of their own
 * (ClearableInput, HelpTip, NoteMarker, LiveAnnouncer, OperationLine, ListDetail). Captions are reviewer labels;
 * a caption that is a variant, size or side is that code identifier.
 */
import { Link } from "@tanstack/react-router"
import { ChevronDown, CircleAlert, FolderOpen, Inbox, Info, Search, Telescope } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { MOD_LABEL, PALETTE_SHORTCUT, PROCEED_SHORTCUT } from "@/app/shortcuts"
import { ClearableInput } from "@/components/app/clearable-input"
import type { Action } from "@/components/app/contracts"
import { announce } from "@/components/app/feedback"
import { DialogFooter } from "@/components/app/form-dialog"
import { OperationLine } from "@/components/app/operation-panel"
import { ListDetail } from "@/components/app/page"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxGroup } from "@/components/ui/checkbox-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, type DialogSize } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { Messages } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { useStore } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

const done = (): CommitResult => ({ ok: true })

const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const
const ALERT_VARIANTS = ["default", "destructive"] as const
const DIALOG_SIZES: DialogSize[] = ["sm", "md", "lg"]
/** The two Sheet uses the plan keeps: the narrow-window navigation drawer (left) and a bottom panel; pages never open a side sheet. */
const SHEET_SIDES = ["left", "bottom"] as const
const TOOLTIP_SIDES = ["top", "bottom"] as const
const SWITCH_SIZES = ["sm", "default", "lg"] as const
const TABS_VARIANTS = ["default", "line"] as const

// eslint-disable-next-line pv/no-user-string -- catalogue names of sample targets
const GALAXIES = [{ value: "m31", label: "M 31" }, { value: "m33", label: "M 33" }, { value: "m101", label: "M 101" }]
// eslint-disable-next-line pv/no-user-string -- catalogue names of sample targets
const NEBULAE = [{ value: "ngc7000", label: "NGC 7000" }, { value: "ic1396", label: "IC 1396" }]

type Filter = "l" | "ha" | "oiii"
// eslint-disable-next-line pv/no-user-string -- filter names (proper names of the optical filters)
const FILTERS: { value: Filter; label: string }[] = [{ value: "l", label: "L" }, { value: "ha", label: "Hα" }, { value: "oiii", label: "OIII" }]

/** The reviewer line under a specimen whose controls run an action. */
function LastAction({ last }: { last: string | null }) {
  const m = useMessages()
  return <p className="text-xs text-muted-foreground">{last ? m.catalogue_templates_last_action({ action: last }) : m.catalogue_datatable_no_action()}</p>
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function AlertDialogSpecimen() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const stop: Action = { id: "stop-indexing", label: m.catalogue_primitives_alert_action(), kind: "destructive", run: done }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>{m.catalogue_primitives_alert_ellipsis()}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.catalogue_primitives_alert_title()}</AlertDialogTitle>
          <AlertDialogDescription>{m.catalogue_primitives_alert_body()}</AlertDialogDescription>
        </AlertDialogHeader>
        <DialogFooter confirm={stop} onConfirm={() => setOpen(false)} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DialogSpecimen({ size }: { size: DialogSize }) {
  const m = useMessages()
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{m.catalogue_primitives_dialog_ellipsis()}</DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{m.catalogue_primitives_dialog_title()}</DialogTitle>
          <DialogDescription>{m.catalogue_primitives_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter cancel={m.verb_close()} />
      </DialogContent>
    </Dialog>
  )
}

function SheetSpecimen({ side }: { side: (typeof SHEET_SIDES)[number] }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {m.verb_open()}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side}>
          <SheetHeader>
            <SheetTitle>{m.shell_navigation()}</SheetTitle>
            <SheetDescription>{m.catalogue_primitives_sheet_body()}</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </>
  )
}

function Overlays() {
  const m = useMessages()
  return (
    <>
      <ComponentSection components={["AlertDialog", "AlertDialogTrigger", "AlertDialogContent", "AlertDialogHeader", "AlertDialogTitle", "AlertDialogDescription"]} description={m.catalogue_primitives_alert_desc()}>
        <Specimen caption={m.catalogue_primitives_state_destructive()}>
          <AlertDialogSpecimen />
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["Dialog", "DialogTrigger", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogClose"]} description={m.catalogue_primitives_dialog_desc()}>
        <div className="space-y-2">
          {DIALOG_SIZES.map((size) => (
            <Specimen key={size} caption={size}>
              <DialogSpecimen size={size} />
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Sheet", "SheetContent", "SheetHeader", "SheetTitle", "SheetDescription"]} description={m.catalogue_primitives_sheet_desc()}>
        <div className="space-y-2">
          {SHEET_SIDES.map((side) => (
            <Specimen key={side} caption={side}>
              <SheetSpecimen side={side} />
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Popover", "PopoverTrigger", "PopoverContent", "PopoverTitle"]} description={m.catalogue_primitives_popover_desc()}>
        <Specimen caption={m.catalogue_primitives_state_default()}>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              {m.tonight_moon_limits()}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent align="start">
              <PopoverTitle>{m.tonight_moon_limits()}</PopoverTitle>
              <p className="text-muted-foreground">{m.catalogue_primitives_popover_body()}</p>
            </PopoverContent>
          </Popover>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["TooltipProvider", "Tooltip", "TooltipTrigger", "TooltipContent"]} description={m.catalogue_primitives_tooltip_desc()}>
        <TooltipProvider delay={400}>
          <div className="space-y-2">
            {TOOLTIP_SIDES.map((side) => (
              <Specimen key={side} caption={side}>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={m.palette_search_label()} />}>
                    <Search aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side={side}>
                    {m.palette_search_label()}
                    <Kbd>{PALETTE_SHORTCUT}</Kbd>
                  </TooltipContent>
                </Tooltip>
              </Specimen>
            ))}
          </div>
        </TooltipProvider>
      </ComponentSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function Menus() {
  const m = useMessages()
  const [last, setLast] = useState<string | null>(null)
  const [byNight, setByNight] = useState(true)
  const [sort, setSort] = useState("night")
  const ran = (label: string) => () => setLast(label)
  return (
    <>
      <ComponentSection
        components={[
          "DropdownMenu",
          "DropdownMenuTrigger",
          "DropdownMenuContent",
          "DropdownMenuGroup",
          "DropdownMenuLabel",
          "DropdownMenuItem",
          "DropdownMenuCheckboxItem",
          "DropdownMenuRadioGroup",
          "DropdownMenuRadioItem",
          "DropdownMenuSeparator",
          "DropdownMenuShortcut",
          "DropdownMenuSub",
          "DropdownMenuSubTrigger",
          "DropdownMenuSubContent",
        ]}
        description={m.catalogue_primitives_dropdown_desc()}
      >
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_menu_parts()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                {m.display_menu_label()}
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{m.nav_sessions()}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={ran(m.verb_open())}>
                    {m.verb_open()}
                    <DropdownMenuShortcut>{PROCEED_SHORTCUT}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={byNight} onCheckedChange={setByNight} closeOnClick={false}>
                    {m.catalogue_primitives_menu_group_by_night()}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{m.catalogue_primitives_menu_sort()}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(String(value))}>
                    <DropdownMenuRadioItem value="night" closeOnClick>
                      {m.run_col_night()}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="target" closeOnClick>
                      {m.sessions_column_target()}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{m.common_more()}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    <DropdownMenuItem onClick={ran(m.location_rescan())}>{m.location_rescan()}</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={ran(m.common_move_to_trash())}>
                      {m.common_move_to_trash()}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </Specimen>
          <LastAction last={last} />
        </div>
      </ComponentSection>

      <ComponentSection components={["ContextMenu", "ContextMenuTrigger", "ContextMenuContent", "ContextMenuGroup", "ContextMenuLabel", "ContextMenuItem", "ContextMenuShortcut", "ContextMenuSeparator"]} description={m.catalogue_primitives_context_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_context_caption()}>
            <ContextMenu>
              <ContextMenuTrigger tabIndex={0} className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                {m.catalogue_primitives_context_area()}
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuGroup>
                  <ContextMenuLabel>{m.nav_sessions()}</ContextMenuLabel>
                  <ContextMenuItem onClick={ran(m.verb_open())}>
                    {m.verb_open()}
                    <ContextMenuShortcut>{PROCEED_SHORTCUT}</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem onClick={ran(m.location_rescan())}>{m.location_rescan()}</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={ran(m.common_move_to_trash())}>{m.common_move_to_trash()}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </Specimen>
          <LastAction last={last} />
        </div>
      </ComponentSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function TextInputs() {
  const m = useMessages()
  const id = useId()
  const [search, setSearch] = useState("M 31")
  const [filter, setFilter] = useState("")
  const [path, setPath] = useState("")
  return (
    <>
      <ComponentSection components={["Input", "Textarea", "FieldLabel", "FieldError"]} description={m.catalogue_primitives_input_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_state_default()}>
            <Input aria-label={m.catalogue_primitives_name_label()} defaultValue={m.catalogue_primitives_sample_name()} className="w-56" />
            <Input aria-label={m.catalogue_primitives_name_label()} placeholder={m.catalogue_primitives_name_label()} className="w-56" />
          </Specimen>
          <Specimen caption={m.catalogue_primitives_state_disabled()}>
            <Input aria-label={m.catalogue_primitives_name_label()} defaultValue={m.catalogue_primitives_sample_name()} disabled className="w-56" />
          </Specimen>
          <Specimen caption={m.catalogue_primitives_state_invalid()}>
            <Field className="w-56">
              <FieldLabel htmlFor={`${id}-name`}>{m.catalogue_primitives_name_label()}</FieldLabel>
              <Input id={`${id}-name`} aria-invalid="true" aria-describedby={`${id}-error`} />
              <FieldError id={`${id}-error`}>{m.catalogue_primitives_name_required()}</FieldError>
            </Field>
          </Specimen>
          <Specimen caption={m.catalogue_primitives_textarea()}>
            <Textarea aria-label={m.catalogue_primitives_notes_label()} defaultValue={m.catalogue_primitives_sample_notes()} rows={3} className="w-80" />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["ClearableInput"]} description={m.catalogue_primitives_clearable_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_clearable_search()}>
            <ClearableInput search value={search} onValueChange={setSearch} aria-label={m.sessions_search()} placeholder={m.sessions_search_placeholder()} wrapperClassName="w-64" />
          </Specimen>
          <Specimen caption={m.catalogue_primitives_clearable_plain()}>
            <ClearableInput value={filter} onValueChange={setFilter} aria-label={m.filter_bar_label()} placeholder={m.filter_bar_label()} wrapperClassName="w-64" />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["InputGroup", "InputGroupAddon", "InputGroupInput", "InputGroupButton"]} description={m.catalogue_primitives_input_group_desc()}>
        <Specimen caption={m.catalogue_primitives_input_group_caption()}>
          <InputGroup className="w-80">
            <InputGroupAddon>
              <FolderOpen aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput aria-label={m.location_path()} value={path} onChange={(event) => setPath(event.target.value)} placeholder={m.catalogue_primitives_path_placeholder()} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={() => setPath("/Volumes/Astro-T7/Captures")}>{m.verb_choose()}</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Specimen>
      </ComponentSection>
    </>
  )
}

function Choices() {
  const m = useMessages()
  const [filters, setFilters] = useState<string[]>(["l", "ha"])
  const [mode, setMode] = useState("symlink")
  const [rescan, setRescan] = useState(true)
  const [target, setTarget] = useState<(typeof GALAXIES)[number] | null>(null)
  const [frames, setFrames] = useState("lights")
  const groups = [
    { value: m.catalogue_primitives_group_galaxies(), items: GALAXIES },
    { value: m.catalogue_primitives_group_nebulae(), items: NEBULAE },
  ]
  const frameItems = [
    { value: "lights", label: m.catalogue_primitives_frames_lights() },
    { value: "calibration", label: m.catalogue_primitives_frames_calibration() },
    { value: "all", label: m.filter_bar_all() },
  ]
  return (
    <>
      <ComponentSection components={["Checkbox", "CheckboxGroup"]} description={m.catalogue_primitives_checkbox_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_checkbox_states()}>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <Checkbox defaultChecked />
              {m.catalogue_primitives_state_checked()}
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <Checkbox />
              {m.catalogue_primitives_state_unchecked()}
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <Checkbox indeterminate />
              {m.catalogue_primitives_state_mixed()}
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <Checkbox disabled />
              {m.catalogue_primitives_state_disabled()}
            </label>
          </Specimen>
          <Specimen caption={m.catalogue_primitives_checkbox_group()}>
            <CheckboxGroup aria-label={m.catalogue_primitives_filters_label()} value={filters} onValueChange={setFilters}>
              {FILTERS.map((filter) => (
                <label key={filter.value} className="inline-flex items-center gap-1.5 text-sm">
                  <Checkbox value={filter.value} />
                  {filter.label}
                </label>
              ))}
            </CheckboxGroup>
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["RadioGroup", "RadioGroupItem"]} description={m.catalogue_primitives_radio_desc()}>
        <div className="space-y-2">
          {[false, true].map((disabled) => (
            <Specimen key={String(disabled)} caption={disabled ? m.catalogue_primitives_state_disabled() : m.catalogue_primitives_state_default()}>
              <RadioGroup aria-label={m.project_view_mode()} value={mode} onValueChange={(value) => setMode(String(value))} disabled={disabled} className="w-auto">
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="symlink" />
                  {m.domain_mode_symlink()}
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="copy" />
                  {m.domain_mode_copy()}
                </label>
              </RadioGroup>
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Switch"]} description={m.catalogue_primitives_switch_desc()}>
        <div className="space-y-2">
          {SWITCH_SIZES.map((size) => (
            <Specimen key={size} caption={size}>
              <label className="inline-flex items-center gap-2 text-sm">
                <Switch size={size} checked={rescan} onCheckedChange={setRescan} />
                {m.catalogue_templates_rescan_on_open()}
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <Switch size={size} disabled />
                {m.catalogue_primitives_state_disabled()}
              </label>
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Combobox", "ComboboxInput", "ComboboxContent", "ComboboxEmpty", "ComboboxList", "ComboboxGroup", "ComboboxLabel", "ComboboxCollection", "ComboboxItem"]} description={m.catalogue_primitives_combobox_desc()}>
        <Specimen caption={m.catalogue_primitives_combobox_caption()}>
          <Combobox items={groups} value={target} onValueChange={(next: (typeof GALAXIES)[number] | null) => setTarget(next)} isItemEqualToValue={(item: (typeof GALAXIES)[number], current: (typeof GALAXIES)[number]) => item.value === current.value}>
            <ComboboxInput aria-label={m.sessions_column_target()} placeholder={m.session_choose_a_target()} className="w-64" />
            <ComboboxContent>
              <ComboboxEmpty>{m.fields_no_match()}</ComboboxEmpty>
              <ComboboxList>
                {(group: (typeof groups)[number]) => (
                  <ComboboxGroup key={group.value} items={group.items}>
                    <ComboboxLabel>{group.value}</ComboboxLabel>
                    <ComboboxCollection>
                      {(item: (typeof GALAXIES)[number]) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["SelectSeparator"]} description={m.catalogue_primitives_select_desc()}>
        <Specimen caption={m.catalogue_primitives_select_caption()}>
          <Select items={frameItems} value={frames} onValueChange={(value) => setFrames(String(value))}>
            <SelectTrigger size="sm" aria-label={m.catalogue_primitives_frames_label()} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {frameItems.slice(0, 2).map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value="all">{m.filter_bar_all()}</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
      </ComponentSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function Display() {
  const m = useMessages()
  return (
    <>
      <ComponentSection components={["Badge"]} description={m.catalogue_primitives_badge_desc()}>
        <Specimen caption={m.catalogue_primitives_variants()}>
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["Alert", "AlertTitle", "AlertDescription"]} description={m.catalogue_primitives_alert_box_desc()}>
        <div className="space-y-2">
          {ALERT_VARIANTS.map((variant) => (
            <Specimen key={variant} caption={variant}>
              <Alert variant={variant} className="max-w-md">
                {variant === "destructive" ? <CircleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
                <AlertTitle>{variant === "destructive" ? m.status_offline() : m.catalogue_primitives_alert_box_title()}</AlertTitle>
                <AlertDescription>{variant === "destructive" ? m.catalogue_primitives_alert_box_offline() : m.catalogue_primitives_alert_box_body()}</AlertDescription>
              </Alert>
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Kbd", "KbdGroup"]} description={m.catalogue_primitives_kbd_desc()}>
        <Specimen caption={m.catalogue_primitives_kbd_caption()}>
          <Kbd>{PALETTE_SHORTCUT}</Kbd>
          <KbdGroup>
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>↩</Kbd>
          </KbdGroup>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["Separator", "Skeleton"]} description={m.catalogue_primitives_separator_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_separator_caption()}>
            <div className="flex h-5 items-center gap-3 text-sm">
              {m.nav_sessions()}
              <Separator orientation="vertical" />
              {m.nav_targets()}
              <Separator orientation="vertical" />
              {m.nav_calibration()}
            </div>
            <Separator className="max-w-md" />
          </Specimen>
          <Specimen caption={m.catalogue_primitives_skeleton_caption()}>
            <div className="w-64 space-y-2" aria-busy="true" aria-label={m.common_loading()}>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["Progress", "ProgressLabel", "ProgressValue"]} description={m.catalogue_primitives_progress_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_progress_known()}>
            <Progress value={42} className="w-64">
              <ProgressLabel>{m.catalogue_primitives_progress_label()}</ProgressLabel>
              <ProgressValue />
            </Progress>
          </Specimen>
          <Specimen caption={m.catalogue_primitives_progress_unknown()}>
            <Progress value={null} className="w-64">
              <ProgressLabel>{m.catalogue_primitives_progress_label()}</ProgressLabel>
            </Progress>
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["Empty", "EmptyHeader", "EmptyMedia", "EmptyDescription", "EmptyContent"]} description={m.catalogue_primitives_empty_desc()}>
        <Specimen caption={m.catalogue_primitives_empty_caption()}>
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox aria-hidden="true" />
              </EmptyMedia>
              <h3 className="text-sm font-medium">{m.catalogue_primitives_empty_title()}</h3>
              <EmptyDescription>{m.catalogue_primitives_empty_body()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" render={<Link to="/import" />}>
                {m.shell_import()}
              </Button>
            </EmptyContent>
          </Empty>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["Breadcrumb", "BreadcrumbList", "BreadcrumbItem", "BreadcrumbLink", "BreadcrumbSeparator"]} description={m.catalogue_primitives_breadcrumb_desc()}>
        <Specimen caption={m.catalogue_primitives_breadcrumb_caption()}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/projects" />}>{m.nav_projects()}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span aria-current="page" className="text-foreground">
                  {m.catalogue_primitives_sample_name()}
                </span>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Specimen>
      </ComponentSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

type Pane = "sessions" | "targets" | "calibration"

function paneLabel(m: Messages, pane: Pane): string {
  return pane === "sessions" ? m.nav_sessions() : pane === "targets" ? m.nav_targets() : m.nav_calibration()
}

function Structure() {
  const m = useMessages()
  const [pane, setPane] = useState<Pane>("sessions")
  const panes: Pane[] = ["sessions", "targets", "calibration"]
  return (
    <>
      <ComponentSection components={["Tabs", "TabsList", "TabsTrigger", "TabsContent"]} description={m.catalogue_primitives_tabs_desc()}>
        <div className="space-y-2">
          {TABS_VARIANTS.map((variant) => (
            <Specimen key={variant} caption={variant}>
              <Tabs defaultValue="sessions" className="w-80">
                <TabsList variant={variant}>
                  {panes.map((value) => (
                    <TabsTrigger key={value} value={value} disabled={value === "calibration"}>
                      {paneLabel(m, value)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {panes.map((value) => (
                  <TabsContent key={value} value={value} className="text-muted-foreground">
                    {m.catalogue_primitives_tabs_panel({ name: paneLabel(m, value) })}
                  </TabsContent>
                ))}
              </Tabs>
            </Specimen>
          ))}
        </div>
      </ComponentSection>

      <ComponentSection components={["Collapsible", "CollapsibleTrigger", "CollapsibleContent"]} description={m.catalogue_primitives_collapsible_desc()}>
        <Specimen caption={m.catalogue_primitives_collapsible_caption()}>
          <Collapsible className="w-80 text-sm">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/collapsible" />}>
              <ChevronDown aria-hidden="true" data-icon="inline-start" className="-rotate-90 transition-transform group-data-[panel-open]/collapsible:rotate-0" />
              {m.catalogue_primitives_collapsible_trigger()}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 pl-7 text-muted-foreground">{m.catalogue_primitives_collapsible_body()}</CollapsibleContent>
          </Collapsible>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["ListDetail"]} description={m.catalogue_primitives_list_detail_desc()}>
        <div className="flex h-48 flex-col overflow-hidden rounded-lg border bg-background">
          <ListDetail
            list={
              <ul aria-label={m.catalogue_primitives_list_detail_label()} className="p-1">
                {panes.map((value) => (
                  <li key={value}>
                    <Button variant="ghost" size="sm" className="w-full justify-start" aria-current={pane === value ? "true" : undefined} onClick={() => setPane(value)}>
                      {paneLabel(m, value)}
                    </Button>
                  </li>
                ))}
              </ul>
            }
            detail={<p className="p-4 text-sm text-muted-foreground">{m.catalogue_primitives_tabs_panel({ name: paneLabel(m, pane) })}</p>}
          />
        </div>
      </ComponentSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Small L2 parts
// ---------------------------------------------------------------------------

function Value({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-baseline gap-0.5 text-sm tabular-nums">{children}</span>
}

function SmallParts() {
  const m = useMessages()
  const latest = useStore((s) => Object.values(s.operations).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  return (
    <>
      <ComponentSection components={["HelpTip", "NoteMarker"]} description={m.catalogue_primitives_tips_desc()}>
        <div className="space-y-2">
          <Specimen caption={m.catalogue_primitives_help_tip()}>
            <span className="inline-flex items-center gap-1 text-sm">
              {m.catalogue_primitives_help_subject()}
              <HelpTip>{m.catalogue_primitives_help_body()}</HelpTip>
            </span>
          </Specimen>
          <Specimen caption={m.catalogue_primitives_note_rows()}>
            <Value>
              {"2.41″"}
              <NoteMarker
                label={m.catalogue_primitives_note_fwhm()}
                rows={[
                  { label: m.catalogue_primitives_note_method(), value: m.catalogue_primitives_note_method_value() },
                  { label: m.catalogue_primitives_note_basis(), value: m.catalogue_primitives_note_basis_value({ count: 42 }) },
                  { label: m.catalogue_primitives_note_time(), value: "2026-09-14 23:10" },
                ]}
              />
            </Value>
          </Specimen>
          <Specimen caption={m.catalogue_primitives_note_line()}>
            <Value>
              {"–"}
              <NoteMarker n={2}>{m.catalogue_primitives_note_absent()}</NoteMarker>
            </Value>
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["LiveAnnouncer"]} description={m.catalogue_primitives_announcer_desc()}>
        <Specimen caption={m.catalogue_primitives_announcer_caption()}>
          <Button variant="outline" size="sm" onClick={() => announce(m.catalogue_primitives_announced())}>
            <Telescope aria-hidden="true" data-icon="inline-start" />
            {m.catalogue_primitives_announce_action()}
          </Button>
        </Specimen>
      </ComponentSection>

      <ComponentSection components={["OperationLine"]} description={m.catalogue_primitives_operation_desc()}>
        <Specimen caption={m.catalogue_primitives_operation_caption()}>
          {latest ? <OperationLine operationId={latest.id} className="w-full max-w-xl" /> : <p className="text-sm text-muted-foreground">{m.ds_op_none()}</p>}
        </Specimen>
      </ComponentSection>
    </>
  )
}

export function PrimitivesCatalogue() {
  return (
    <>
      <Overlays />
      <Menus />
      <TextInputs />
      <Choices />
      <Display />
      <Structure />
      <SmallParts />
    </>
  )
}
