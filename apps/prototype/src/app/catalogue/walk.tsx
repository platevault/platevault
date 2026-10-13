/**
 * Catalogue entry (§4b, §8.3): CoachWalk over this page's own section
 * headings, with one step whose anchor does not exist, which the walk passes
 * over.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { CoachWalk } from "@/components/app/walk"
import { ComponentSection, Specimen } from "./specimen"

export function WalkCatalogue() {
  const m = useMessages()
  const [running, setRunning] = useState(false)
  return (
    <ComponentSection components={["CoachWalk"]} description={m.catalogue_walk_desc()}>
      <Specimen caption={m.catalogue_frame_wide()}>
        <span data-catalogue-walk-anchor="">
          <ActionButton action={{ id: "start-walk", label: m.catalogue_walk_start(), run: () => setRunning(true) }} />
        </span>
      </Specimen>
      {running ? (
        <CoachWalk
          steps={[
            { id: "start", title: m.catalogue_walk_start(), body: m.catalogue_walk_desc(), anchors: ["[data-catalogue-walk-anchor]"] },
            { id: "missing", title: m.nav_targets(), body: m.onboarding_walk_targets(), anchors: ["[data-no-such-anchor]"] },
            { id: "sidebar", title: m.onboarding_walk_sources_title(), body: m.onboarding_walk_sources(), anchors: ["[data-frame-nav]"] },
          ]}
          waitFrames={5}
          onEnd={() => setRunning(false)}
        />
      ) : null}
    </ComponentSection>
  )
}
