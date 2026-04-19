import type {
  StatisticsExportResult,
  StatisticsImportPreview,
  StatisticsImportResult,
} from './contracts';
import { tauriInvoke } from './invoke';

export type StatisticsImportMode = 'overwrite' | 'merge';

export const statisticsApi = {
  exportStatisticsFile: (filePath: string, includeRecentPlays: boolean) =>
    tauriInvoke('export_statistics_file', { filePath, includeRecentPlays }) as Promise<StatisticsExportResult>,
  previewStatisticsImport: (filePath: string) =>
    tauriInvoke('preview_statistics_import', { filePath }) as Promise<StatisticsImportPreview>,
  importStatisticsFile: (
    filePath: string,
    mode: StatisticsImportMode,
    continueDuplicateImport = false,
  ) =>
    tauriInvoke('import_statistics_file', {
      filePath,
      mode,
      continueDuplicateImport,
    }) as Promise<StatisticsImportResult>,
};
