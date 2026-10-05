/**
 * Verification time of counted quality decisions (D19, LIB-FR-09). A count
 * uses each frame's last completed verification and labels it; reading these
 * values starts no rehash and writes nothing.
 */
import { isRetiredAsset, qualityApplicability } from "./derive"
import type { Asset, AssetId, Catalog, IsoDateTime } from "./types"

/**
 * When the asset's quality decision was last verified against its bytes: the
 * later of the decision itself (review or inspection) and the last read of a
 * copy whose bytes match the decision basis (a readable rescan or a transfer
 * re-reads and rehashes them). An absent copy was not read, so it never
 * counts. Null for an undecided asset.
 */
export function lastVerifiedAt(asset: Asset): IsoDateTime | null {
  const { decidedAt, basisSha256 } = asset.quality
  if (basisSha256 === null) return null
  let latest = decidedAt
  for (const copy of asset.copies) {
    if (copy.presence === "absent" || copy.sha256 !== basisSha256) continue
    if (!latest || copy.lastObservedAt > latest) latest = copy.lastObservedAt
  }
  return latest
}

/**
 * Verification time to label a usable total with: the oldest last
 * verification among the frames the total counts as Usable (the same frames
 * `addToBreakdown` adds to `usable`). Null when no frame counts.
 */
export function usableVerifiedAt(catalog: Catalog, assetIds: Iterable<AssetId>): IsoDateTime | null {
  let oldest: IsoDateTime | null = null
  for (const id of assetIds) {
    const asset = catalog.assets[id]
    if (!asset || asset.quality.value !== "usable" || isRetiredAsset(catalog, asset) || qualityApplicability(asset) !== "applicable") continue
    const verified = lastVerifiedAt(asset)
    if (verified && (!oldest || verified < oldest)) oldest = verified
  }
  return oldest
}
