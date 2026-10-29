import { DetailPage } from "@/components/templates/detail-page"
import type { ProjectTabProps } from "./project-page"

export function ViewTab({ header, chrome }: ProjectTabProps) {
  return <DetailPage {...chrome} title={header.name} sections={[]} />
}
