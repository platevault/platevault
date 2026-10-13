/**
 * Catalogue entry (§3.3, §8.3): the status bar parts and the list popovers,
 * with sample work, counters and notifications. Real catalogue copy.
 */
import { Bell, HardDrive, OctagonX, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { MiniProgress, ListEmpty, ListFold, ListNotice, ListOperationRow, ListPopover, ListRows, ListSection, StatusBar, StatusGroup, StatusLink, StatusOperation, StatusSelection, StatusText } from "@/components/app/status-bar"
import { ComponentSection, Specimen } from "./specimen"

function Counters() {
  const m = useMessages()
  const [errors, setErrors] = useState(false)
  const [warnings, setWarnings] = useState(false)
  const [notices, setNotices] = useState(false)
  return (
    <StatusGroup label={m.issues_title()}>
      <ListPopover open={errors} onOpenChange={setErrors} title={m.status_bar_errors({ count: 1 })} trigger={{ label: m.status_bar_errors({ count: 1 }), icon: OctagonX, tone: "danger", content: 1 }}>
        <ListRows>
          <ListNotice id="n1" tone="danger" text={m.issue_failed({ name: "Flat OIII" })} full={m.issue_failed({ name: "Flat OIII" })} onNavigate={() => setErrors(false)} at="2026-09-26T21:04:00Z" time="21:04" />
        </ListRows>
      </ListPopover>
      <ListPopover open={warnings} onOpenChange={setWarnings} title={m.issues_title()} meta={m.issues_none()} trigger={{ label: m.status_bar_warnings({ count: 0 }), icon: TriangleAlert, tone: "warning", content: 0 }}>
        <ListSection label={m.nav_sessions()}>
          <ListEmpty>{m.issues_none()}</ListEmpty>
        </ListSection>
        <ListFold label={m.issues_dismissed({ count: 1 })} action={{ label: m.issues_restore_all(), onRun: () => setWarnings(false) }}>
          <ListNotice id="n2" tone="warning" text={m.issue_needs_target({ count: 2 })} full={m.issue_needs_target({ count: 2 })} onNavigate={() => setWarnings(false)} at="2026-09-26T20:00:00Z" time="20:00" />
        </ListFold>
      </ListPopover>
      <ListPopover open={notices} onOpenChange={setNotices} width="lg" title={m.status_bar_notifications()} link={{ label: m.nav_activity(), to: "/activity" }} trigger={{ label: m.status_bar_notifications(), icon: Bell }}>
        <ListRows>
          <ListNotice id="n3" tone="success" text={m.status_bar_working()} full={m.status_bar_working()} href="/activity" onNavigate={() => setNotices(false)} at="2026-09-26T21:04:00Z" time="21:04" />
        </ListRows>
      </ListPopover>
    </StatusGroup>
  )
}

export function StatusBarCatalogue() {
  const m = useMessages()
  const [more, setMore] = useState(false)
  return (
    <ComponentSection
      components={["StatusBar", "StatusGroup", "StatusLink", "StatusText", "StatusSelection", "StatusOperation", "MiniProgress", "ListPopover", "ListRows", "ListOperationRow", "ListSection", "ListEmpty", "ListFold", "ListNotice"]}
      description={m.catalogue_status_bar_desc()}
    >
      <div className="space-y-3">
        <Specimen caption={m.catalogue_frame_wide()}>
          <div className="w-full">
            <StatusBar
              label={m.status_bar()}
              start={
                <>
                  <StatusLink to="/settings/locations" icon={HardDrive} label={m.common_locations()} text={m.status_bar_locations_online({ online: 2, total: 3 })} />
                  <StatusSelection>{m.status_bar_selected_of({ count: 3, total: 12 })}</StatusSelection>
                </>
              }
              middle={
                <StatusGroup label={m.status_running()} layout="work">
                  <StatusOperation id="op1" title={m.nav_calibration()} href="/activity" value={42} word="42%" onCancel={() => undefined} />
                  <StatusOperation id="op2" title={m.nav_sessions()} href="/activity" value={null} word="" />
                  <ListPopover open={more} onOpenChange={setMore} align="center" width="sm" label={m.status_running()} trigger={{ label: m.status_bar_more_running({ count: 1 }), content: "+1" }}>
                    <ListRows dense>
                      <ListOperationRow>
                        <StatusOperation id="op3" title={m.shell_import()} href="/activity" value={10} word={m.status_paused()} expanded onCancel={() => undefined} />
                      </ListOperationRow>
                    </ListRows>
                  </ListPopover>
                </StatusGroup>
              }
              end={<Counters />}
            />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_frame_narrow()}>
          <div className="w-96">
            <StatusBar label={m.status_bar()} start={<StatusLink compact to="/settings/locations" icon={HardDrive} label={m.common_locations()} text={m.storage_no_locations()} />} middle={<StatusText>{m.status_bar_idle()}</StatusText>} />
          </div>
          <MiniProgress value={null} label={m.status_bar_working()} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}
