import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { X } from "lucide-react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { IconButton } from "./actions"
import { FieldGroup, NumberField, SelectField, TextAreaField } from "./fields"

const LABEL = "Notes"
const PROBLEM = "Notes are too long"

function Notes({ onChange, error }: { onChange: (value: string) => void; error?: string }) {
  const [value, setValue] = useState("First line")
  return (
    <TextAreaField
      label={LABEL}
      value={value}
      error={error}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe("TextAreaField", () => {
  it("is named by its label and hands every edit, line breaks included, to the host", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Notes onChange={onChange} />)
    const notes = screen.getByRole("textbox", { name: LABEL })
    expect(notes.tagName).toBe("TEXTAREA")
    expect(notes).toHaveValue("First line")

    await user.type(notes, "{Enter}Second")
    expect(onChange).toHaveBeenLastCalledWith("First line\nSecond")
    expect(notes).toHaveValue("First line\nSecond")
  })

  it("marks the text area invalid and describes it with the message", () => {
    render(<Notes onChange={() => {}} error={PROBLEM} />)
    const notes = screen.getByRole("textbox", { name: LABEL })
    expect(notes).toHaveAttribute("aria-invalid", "true")
    expect(notes).toHaveAccessibleDescription(PROBLEM)
  })
})

describe("FieldGroup", () => {
  const GROUPS = ["Ha goal", "OIII goal"]

  it("is named by its legend, holds its fields, and gives each group's action its own name", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <>
        {GROUPS.map((label) => (
          <FieldGroup key={label} label={label} action={<IconButton label={`Remove ${label}`} icon={X} onClick={() => onRemove(label)} />}>
            <NumberField label="Hours" value={10} onChange={() => {}} />
          </FieldGroup>
        ))}
      </>,
    )
    for (const label of GROUPS) {
      const group = screen.getByRole("group", { name: label })
      expect(within(group).getByRole("spinbutton", { name: "Hours" })).toHaveValue(10)
      expect(within(group).getByRole("button", { name: `Remove ${label}` })).toBeInTheDocument()
    }
    expect(screen.getAllByRole("button", { name: /^Remove / }).map((button) => button.getAttribute("aria-label"))).toEqual(GROUPS.map((label) => `Remove ${label}`))

    await user.click(screen.getByRole("button", { name: "Remove OIII goal" }))
    expect(onRemove).toHaveBeenCalledWith("OIII goal")
  })
})

describe("Field cell mode (hideLabel)", () => {
  const OPTIONS = [
    { value: "light", label: "Light" },
    { value: "flat", label: "Flat" },
  ]

  it("keeps the hidden label as the accessible name and shows no error line", () => {
    render(<SelectField label="Kind of result.fits" hideLabel value="light" options={OPTIONS} onChange={() => {}} error="Choose a kind" description="Shown nowhere" />)
    const control = screen.getByRole("combobox", { name: "Kind of result.fits" })
    expect(control).toHaveAttribute("aria-invalid", "true")
    expect(control).not.toHaveAttribute("aria-describedby")
    expect(screen.getByText("Kind of result.fits")).toHaveClass("sr-only")
    expect(screen.queryByText("Choose a kind")).not.toBeInTheDocument()
    expect(screen.queryByText("Shown nowhere")).not.toBeInTheDocument()
  })

  it("names a number field the same way", () => {
    render(<NumberField label="Exposure of row 3" hideLabel value={300} onChange={() => {}} />)
    expect(screen.getByRole("spinbutton", { name: "Exposure of row 3" })).toHaveValue(300)
  })
})

describe("SelectField", () => {
  const OPTIONS = [
    { value: "light", label: "Light" },
    { value: "flat", label: "Flat" },
    { value: "dark", label: "Dark" },
  ]

  function Kind({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = useState("light")
    return (
      <SelectField
        label="Kind"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  it("exposes only its named trigger: the form input holding the raw value is hidden from assistive technology", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<Kind onChange={onChange} />)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(container.querySelector("input[aria-hidden='true']")).toHaveValue("light")

    const trigger = screen.getByRole("combobox", { name: "Kind" })
    expect(trigger).toHaveTextContent("Light")

    trigger.focus()
    await user.keyboard("{ArrowDown}")
    expect(await screen.findByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenLastCalledWith("flat")
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent("Flat")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})
