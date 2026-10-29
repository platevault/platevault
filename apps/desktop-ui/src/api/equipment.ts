/**
 * The saved rigs, as every rig picker reads them: New Project's rigs
 * (065 PRJ-FR-01/02) and the intake rig step (LIB-FR-04/24) offer the same
 * list, so they share one query and one cache entry.
 */
import { libraryQuery } from "./query"

/** Every saved rig by name (`library_list_equipment`), each with the revision a later save or delete expects. */
export const equipmentQuery = () => libraryQuery("libraryListEquipment")
