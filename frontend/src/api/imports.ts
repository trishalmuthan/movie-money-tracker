import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type ImportFile = components['schemas']['ImportSheetFile']
export type ImportChoices = components['schemas']['ImportChoices']
export type ImportProposal = components['schemas']['ImportProposal']
export type ImportResult = components['schemas']['ImportOut']
export type RowKey = components['schemas']['ImportRowKey']
export type RowChoice = components['schemas']['ImportRowChoice']

/** The committed import, or null before the sheet has been imported. */
export function useImportStatus() {
  return useQuery({
    queryKey: ['import'],
    queryFn: () => unwrap(api.GET('/api/v1/import')),
  })
}

/**
 * What the import would write. A POST, but it only reads, so it's a query keyed by the
 * files and choices; the last proposal stays on screen while the next one loads.
 */
export function useImportPreview(files: ImportFile[], choices: ImportChoices) {
  return useQuery({
    queryKey: ['import-preview', files, choices],
    queryFn: () => unwrap(api.POST('/api/v1/import/preview', { body: { files, choices } })),
    enabled: files.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useCommitImport() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: { files: ImportFile[]; choices: ImportChoices }) =>
      unwrap(api.POST('/api/v1/import/commit', { body })),
    onSuccess,
  })
}
