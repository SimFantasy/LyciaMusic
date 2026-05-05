<script setup lang="ts">
import { computed, onMounted, onScopeDispose, reactive, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useToast } from '../../composables/toast';
import { remoteLibraryApi } from '../../services/tauri/remoteLibraryApi';
import type { RemoteSource, RemoteSyncProgress } from '../../types';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { showToast } = useToast();
const remoteSources = ref<RemoteSource[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const testing = ref(false);
const syncingSourceId = ref<string | null>(null);
const sourceToRemove = ref<RemoteSource | null>(null);
const syncProgress = ref<RemoteSyncProgress | null>(null);
let unlistenRemoteSync: UnlistenFn | null = null;

const form = reactive({
  id: '',
  name: '',
  baseUrl: '',
  username: '',
  password: '',
  rootPath: '/',
});

const resetForm = () => {
  form.id = '';
  form.name = '';
  form.baseUrl = '';
  form.username = '';
  form.password = '';
  form.rootPath = '/';
};

const buildPayload = () => ({
  id: form.id || undefined,
  name: form.name.trim(),
  provider: 'webdav' as const,
  baseUrl: form.baseUrl.trim(),
  username: form.username.trim() || null,
  password: form.password || null,
  rootPath: form.rootPath.trim() || '/',
});

const syncPercent = computed(() => {
  const progress = syncProgress.value;
  if (!progress || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
});

const syncProgressText = computed(() => {
  const progress = syncProgress.value;
  if (!progress) return '';
  if (progress.total <= 0) return progress.message;
  return `${progress.message} ${progress.current}/${progress.total}`;
});

const loadSources = async () => {
  isLoading.value = true;
  try {
    remoteSources.value = await remoteLibraryApi.getRemoteSources();
  } catch (error) {
    console.error('Failed to load remote sources:', error);
    showToast('加载远程音乐库失败', 'error');
  } finally {
    isLoading.value = false;
  }
};

const testConnection = async () => {
  testing.value = true;
  try {
    const result = await remoteLibraryApi.testRemoteSource(buildPayload());
    showToast(result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    console.error('Failed to test remote source:', error);
    showToast('连接测试失败', 'error');
  } finally {
    testing.value = false;
  }
};

const saveSource = async () => {
  if (!form.name.trim() || !form.baseUrl.trim()) {
    showToast('名称和服务器地址不能为空', 'error');
    return;
  }

  isSaving.value = true;
  try {
    if (form.id) {
      await remoteLibraryApi.updateRemoteSource(buildPayload());
    } else {
      await remoteLibraryApi.addRemoteSource(buildPayload());
    }
    resetForm();
    await loadSources();
    showToast('远程音乐库已保存', 'success');
  } catch (error) {
    console.error('Failed to save remote source:', error);
    showToast('保存远程音乐库失败', 'error');
  } finally {
    isSaving.value = false;
  }
};

const editSource = (source: RemoteSource) => {
  form.id = source.id;
  form.name = source.name;
  form.baseUrl = source.baseUrl;
  form.username = source.username ?? '';
  form.password = '';
  form.rootPath = source.rootPath || '/';
};

const syncSource = async (source: RemoteSource) => {
  syncingSourceId.value = source.id;
  syncProgress.value = {
    sourceId: source.id,
    phase: 'scanning',
    current: 0,
    total: 0,
    message: '正在读取远程目录',
    done: false,
    failed: false,
  };
  try {
    const result = await remoteLibraryApi.syncRemoteSource(source.id);
    await loadSources();
    showToast(`已同步 ${result.audioFiles} 首远程歌曲`, 'success');
  } catch (error) {
    console.error('Failed to sync remote source:', error);
    await loadSources();
    showToast('同步远程音乐库失败', 'error');
  } finally {
    syncingSourceId.value = null;
  }
};

const confirmRemoveSource = async () => {
  if (!sourceToRemove.value) return;

  try {
    await remoteLibraryApi.removeRemoteSource(sourceToRemove.value.id);
    sourceToRemove.value = null;
    await loadSources();
    showToast('远程音乐库已删除', 'success');
  } catch (error) {
    console.error('Failed to remove remote source:', error);
    showToast('删除远程音乐库失败', 'error');
  }
};

onMounted(async () => {
  await loadSources();
  unlistenRemoteSync = await listen<RemoteSyncProgress>('remote-sync-progress', event => {
    syncProgress.value = event.payload;
    if (event.payload.done) {
      syncingSourceId.value = null;
    }
  });
});

onScopeDispose(() => {
  unlistenRemoteSync?.();
  unlistenRemoteSync = null;
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        远程音乐库
      </h2>

      <div class="remote-form">
        <div class="remote-form-grid">
          <label class="remote-field">
            <span>名称</span>
            <input v-model="form.name" type="text" class="remote-input" placeholder="我的 WebDAV" />
          </label>
          <label class="remote-field">
            <span>服务器地址</span>
            <input v-model="form.baseUrl" type="url" class="remote-input" placeholder="https://example.com/dav" />
          </label>
          <label class="remote-field">
            <span>用户名</span>
            <input v-model="form.username" type="text" class="remote-input" autocomplete="username" />
          </label>
          <label class="remote-field">
            <span>密码</span>
            <input v-model="form.password" type="password" class="remote-input" autocomplete="current-password" />
          </label>
          <label class="remote-field remote-field--wide">
            <span>根目录</span>
            <input v-model="form.rootPath" type="text" class="remote-input" placeholder="/" />
          </label>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" class="remote-action remote-action--soft" :disabled="testing" @click="testConnection">
            {{ testing ? '测试中...' : '测试连接' }}
          </button>
          <button type="button" class="remote-action" :disabled="isSaving" @click="saveSource">
            {{ isSaving ? '保存中...' : form.id ? '保存修改' : '添加远程库' }}
          </button>
          <button v-if="form.id" type="button" class="remote-action remote-action--soft" @click="resetForm">
            取消编辑
          </button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        已添加
      </h2>

      <div class="remote-source-list">
        <div v-if="isLoading" class="remote-empty">加载中...</div>
        <div v-else-if="remoteSources.length === 0" class="remote-empty">还没有远程音乐库</div>
        <template v-else>
          <div v-for="source in remoteSources" :key="source.id" class="remote-source-row">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-gray-900 dark:text-white">{{ source.name }}</div>
              <div class="mt-1 truncate text-xs text-gray-600 dark:text-white/55">{{ source.baseUrl }}{{ source.rootPath }}</div>
              <div v-if="source.lastSyncError" class="mt-1 text-xs text-[#EC4141]">{{ source.lastSyncError }}</div>
              <div v-if="syncProgress?.sourceId === source.id && !syncProgress.done" class="remote-progress">
                <div class="remote-progress__top">
                  <span>{{ syncProgressText }}</span>
                  <span v-if="syncProgress.total > 0">{{ syncPercent }}%</span>
                </div>
                <div class="remote-progress__track">
                  <div class="remote-progress__fill" :style="{ width: `${syncPercent}%` }"></div>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button type="button" class="remote-icon-action" title="编辑" @click="editSource(source)">
                编辑
              </button>
              <button
                type="button"
                class="remote-icon-action"
                :disabled="syncingSourceId === source.id"
                title="同步"
                @click="syncSource(source)"
              >
                {{ syncingSourceId === source.id ? '同步中' : '同步' }}
              </button>
              <button type="button" class="remote-icon-action remote-icon-action--danger" title="删除" @click="sourceToRemove = source">
                删除
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>

    <ConfirmModal
      :visible="!!sourceToRemove"
      title="删除远程音乐库"
      :content="`确定要删除“${sourceToRemove?.name ?? ''}”吗？远程歌曲索引会从音乐库中移除。`"
      @confirm="confirmRemoveSource"
      @cancel="sourceToRemove = null"
    />
  </div>
</template>

<style scoped>
.remote-form,
.remote-source-list {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.28);
  padding: 16px;
}

.remote-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.remote-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(55 65 81);
}

.remote-field--wide {
  grid-column: 1 / -1;
}

.remote-input {
  min-height: 40px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 9px 12px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 500;
  outline: none;
}

.remote-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.remote-action,
.remote-icon-action {
  min-height: 36px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.95);
  color: white;
  font-size: 12px;
  font-weight: 700;
  padding: 0 15px;
}

.remote-action--soft,
.remote-icon-action {
  background: rgba(236, 65, 65, 0.07);
  color: #ec4141;
}

.remote-action:disabled,
.remote-icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.remote-source-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.remote-source-row {
  display: flex;
  align-items: center;
  gap: 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.06);
  padding: 14px 16px;
}

.remote-icon-action--danger {
  border-color: rgba(236, 65, 65, 0.18);
  color: #ec4141;
}

.remote-progress {
  margin-top: 10px;
  max-width: 460px;
}

.remote-progress__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: rgb(75 85 99);
  font-size: 12px;
  font-weight: 600;
}

.remote-progress__track {
  margin-top: 6px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
}

.remote-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: #ec4141;
  transition: width 160ms ease;
}

.remote-empty {
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  color: rgb(100 116 139);
  font-size: 13px;
}

:global(.dark) .remote-form,
:global(.dark) .remote-source-list {
  background: rgba(255, 255, 255, 0.04);
}

:global(.dark) .remote-field {
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .remote-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .remote-source-row {
  background: rgba(255, 255, 255, 0.06);
}

:global(.dark) .remote-progress__top {
  color: rgba(255, 255, 255, 0.7);
}
</style>
