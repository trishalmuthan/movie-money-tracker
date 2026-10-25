import { useState } from 'react'
import { useChains, type Chain } from '../../api/chains'
import { errorMessage } from '../../api/errors'
import { useImportPreview, useImportStatus, type ImportChoices, type ImportFile } from '../../api/imports'
import { LoadProblem, NeedsChain } from '../../components/LoadProblem'
import { Page } from '../../components/Page'
import { todayIso } from '../../lib/dates'
import { defaultChainRule } from '../../lib/importChoices'
import { CardsStep } from './CardsStep'
import { CommitStep } from './CommitStep'
import { FilesStep } from './FilesStep'
import { ImportSummary } from './ImportSummary'
import { PeriodsStep } from './PeriodsStep'
import { ProblemsStep } from './ProblemsStep'
import { RulesStep } from './RulesStep'
import { VisitsStep } from './VisitsStep'

const TITLE = 'Import your sheet'
const INTRO =
  "Bring your Google Sheet's history into the app, once. Nothing is saved until you import, and you can come back and change anything before then."

export function ImportPage() {
  const status = useImportStatus()
  const chains = useChains()

  if (status.isError) return <LoadProblem title={TITLE} what="import" error={status.error} />
  if (chains.isError) return <LoadProblem title={TITLE} what="import" error={chains.error} />
  if (status.isPending || chains.isPending) return <Page title={TITLE} intro="Loading…" />
  if (status.data) {
    return (
      <Page title={TITLE}>
        <ImportSummary result={status.data} />
      </Page>
    )
  }
  if (chains.data.length === 0) return <NeedsChain title={TITLE} what="Imported rows" />
  return (
    <Page title={TITLE} intro={INTRO}>
      <ImportFlow chains={chains.data} />
    </Page>
  )
}

function ImportFlow({ chains }: { chains: Chain[] }) {
  const [files, setFiles] = useState<ImportFile[]>([])
  const [choices, setChoices] = useState<ImportChoices>(() => ({
    cutoff: todayIso(),
    chain_rule: defaultChainRule(chains),
    rows: [],
    fixes: [],
    periods: null,
  }))
  const preview = useImportPreview(files, choices)

  return (
    <div className="flex max-w-3xl flex-col gap-14">
      <FilesStep
        files={files}
        choices={choices}
        totals={preview.data?.totals}
        onChange={(nextFiles, nextChoices) => {
          setFiles(nextFiles)
          setChoices(nextChoices)
        }}
      />
      {files.length > 0 && (
        <>
          <RulesStep chains={chains} choices={choices} onChange={setChoices} />
          {preview.isError && (
            <p role="alert" className="text-warn">
              {errorMessage(preview.error)}
            </p>
          )}
          {preview.data && (
            <>
              <ProblemsStep files={files} proposal={preview.data} choices={choices} onChange={setChoices} />
              <CardsStep chains={chains} proposal={preview.data} choices={choices} onChange={setChoices} />
              <VisitsStep chains={chains} proposal={preview.data} choices={choices} onChange={setChoices} />
              <PeriodsStep chains={chains} proposal={preview.data} choices={choices} onChange={setChoices} />
              <CommitStep files={files} choices={choices} proposal={preview.data} />
            </>
          )}
        </>
      )}
    </div>
  )
}
