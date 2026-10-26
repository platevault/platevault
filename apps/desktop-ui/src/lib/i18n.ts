import { m } from "../paraglide/messages"

export const DEFAULT_LOCALE = "en-GB" as const
export const LOCALES = ["en-GB", "pt-BR"] as const
export type Locale = (typeof LOCALES)[number]

export { m }
