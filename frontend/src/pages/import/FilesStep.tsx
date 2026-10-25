import { useState, type DragEvent } from 'react'
import type { ImportChoices, ImportFile, ImportProposal } from '../../api/imports'
import { quietButton } from '../../components/buttons'
import { removeFile } from '../../lib/importChoices'
import { formatCents } from '../../lib/money'
import { Step } from './Step'

type FilesStepProps = {
  files: ImportFile[]
  choices: ImportChoices
  totals: ImportProposal['totals'] | undefined
  onChange: (files: ImportFile[], choices: ImportChoices) => void
}

export function FilesStep({ files, choices, totals, onChange }: FilesStepProps) {
  const [dragging, setDragging] = useState(false)

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return
    const added = await Promise.all([...list].map(async (file) => ({ name: file.name, text: await file.text() })))
    // Adding a file with the same name again replaces it.
    const kept = files.filter((f) => !added.some((a) => a.name === f.name))
    onChange([...kept, ...added], choices)
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void add(event.dataTransfer.files)
  }

  return (
    <Step
      number={1}
      title="Add your sheet's tabs"
      intro="In Google Sheets, open each tab and choose File, Download, Comma-separated values (.csv). Add every tab you want to bring in."
    >
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-8 text-center has-focus-visible:outline-2 has-focus-visible:outline-brass ${
          dragging ? 'border-brass bg-velvet/40' : 'border-velvet hover:bg-velvet/20'
        }`}
      >
        <span className="font-semibold">Choose CSV files</span>
        <span className="text-sm text-dim">or drop them here</span>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(e) => {
            void add(e.target.files)
            e.target.value = '' // so choosing the same file again still counts as a change
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-6 divide-y divide-velvet/60 border-y border-velvet/60">
          {files.map((file, index) => {
            const total = totals?.[index]
            return (
              <li key={file.name} aria-label={file.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p>{file.name}</p>
                  {total ? (
                    <p className="text-sm text-dim">
                      <span>{total.rows} rows</span>
                      <span className="mx-2" aria-hidden="true">
                        /
                      </span>
                      <span>
                        Sheet total {formatCents(total.legacy_total)}, {total.tickets} tickets
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-dim">Reading…</p>
                  )}
                </div>
                <button
                  type="button"
                  className={quietButton}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onChange(...removeFile(files, choices, index))}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Step>
  )
}
