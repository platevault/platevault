/**
 * The page a record route shows when its id is not in the catalogue (an old
 * link, or a record that went to the Trash). Foundation-owned; every record
 * screen uses it so the wording and the way back stay the same: the standard
 * page header, whose path leads back to the list the record belongs to.
 */
import { DetailPage } from "@/components/templates/detail-page"

/**
 * `title` names what is missing as one complete message ("This Project is not in the catalogue"), so its noun agrees in
 * every language; `backLabel` names the list `backTo` opens ("Projects"), the path before the title.
 */
export function MissingRecord({ title, backTo, backLabel }: { title: string; backTo: string; backLabel: string }) {
  return <DetailPage path={[{ label: backLabel, link: { to: backTo } }]} title={title} sections={[]} />
}
