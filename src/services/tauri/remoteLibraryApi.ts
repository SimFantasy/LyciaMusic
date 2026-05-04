import type { RemoteConnectionResult, RemoteSource, RemoteSourceInput, RemoteSyncResult } from '../../types';
import { tauriInvoke } from './invoke';

export const remoteLibraryApi = {
  getRemoteSources: (): Promise<RemoteSource[]> => tauriInvoke('get_remote_sources'),
  testRemoteSource: (source: RemoteSourceInput): Promise<RemoteConnectionResult> =>
    tauriInvoke('test_remote_source', { source }),
  addRemoteSource: (source: RemoteSourceInput): Promise<RemoteSource> =>
    tauriInvoke('add_remote_source', { source }),
  updateRemoteSource: (source: RemoteSourceInput): Promise<RemoteSource> =>
    tauriInvoke('update_remote_source', { source }),
  removeRemoteSource: (sourceId: string): Promise<void> =>
    tauriInvoke('remove_remote_source', { sourceId }),
  syncRemoteSource: (sourceId: string): Promise<RemoteSyncResult> =>
    tauriInvoke('sync_remote_source', { sourceId }),
};
