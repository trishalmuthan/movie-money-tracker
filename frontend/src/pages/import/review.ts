import type { Chain } from '../../api/chains'
import type { ImportProposal, RowKey } from '../../api/imports'

/** The blocking problem for one row, if any, to show beside it. */
export function blockerFor(proposal: ImportProposal, key: RowKey): string | undefined {
  return proposal.blockers.find((b) => b.key?.file === key.file && b.key.line === key.line)?.message
}

export function chainName(chains: Chain[], id: number | null): string | undefined {
  return chains.find((c) => c.id === id)?.name
}
