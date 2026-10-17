/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): the pane layout primitives
 * the templates build on. PageBody gives a pane body its 20 px margins and
 * vertical rhythm; Section is an h2 with a one-line caption and its actions
 * beside the heading, or an h3 inside it. Every visible string comes from
 * the message catalogue.
 */
import { useMessages } from "@/app/preferences"
import { Stat } from "@/components/app/data"
import { PageBody, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { formatCount } from "@/lib/format"
import { ComponentSection } from "./specimen"

export function PageCatalogue() {
  const m = useMessages()
  return (
    <ComponentSection components={["PageBody", "Section"]} description={m.catalogue_page_desc()}>
      <div className="rounded-md border border-border">
        <PageBody>
          <Section
            title={m.nav_sessions()}
            description={m.catalogue_page_caption()}
            actions={
              <Button size="sm" variant="outline">
                {m.verb_review()}
              </Button>
            }
          >
            <Section level={3} title={m.nav_calibration()}>
              <Stat label={m.sessions_column_frames()} value={formatCount(208)} />
            </Section>
          </Section>
        </PageBody>
      </div>
    </ComponentSection>
  )
}
