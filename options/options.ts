const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const storage = extensionApi.storage;
const runtime = extensionApi.runtime;

type Provider = 'heuristic' | 'openai';

type SlopGuardSettings = {
  enabled: boolean;
  provider: Provider;
  warnThreshold: number;
  highThreshold: number;
  openaiGateThreshold: number;
  openaiApiKey?: string;
  openaiModel: string;
  debugLogging: boolean;
};

const defaults: SlopGuardSettings = {
  enabled: true,
  provider: 'heuristic',
  warnThreshold: 20,
  highThreshold: 40,
  openaiGateThreshold: 20,
  openaiModel: 'gpt-4.1-mini',
  debugLogging: true
};

function storageGet(keys: Record<string, unknown>): Promise<Record<string, any>> {
  return new Promise((resolve) => storage.local.get(keys, resolve));
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => storage.local.set(values, resolve));
}

function runtimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return runtime.sendMessage(message);
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing options element: ${id}`);
  return el;
}

const enabled = byId<HTMLInputElement>('enabled');
const debugLogging = byId<HTMLInputElement>('debugLogging');
const provider = byId<HTMLSelectElement>('provider');
const apiKey = byId<HTMLInputElement>('apiKey');
const openaiModel = byId<HTMLInputElement>('openaiModel');
const warnThreshold = byId<HTMLInputElement>('warnThreshold');
const highThreshold = byId<HTMLInputElement>('highThreshold');
const openaiGateThreshold = byId<HTMLInputElement>('openaiGateThreshold');
const save = byId<HTMLButtonElement>('save');
const refreshStats = byId<HTMLButtonElement>('refreshStats');
const clearCache = byId<HTMLButtonElement>('clearCache');
const stats = byId<HTMLPreElement>('stats');
const status = byId<HTMLDivElement>('status');

function setStatus(message: string): void {
  status.textContent = message;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 2500);
}

async function load(): Promise<void> {
  const stored = await storageGet({ slopguardSettings: defaults, openaiApiKey: '' });
  const settings: SlopGuardSettings = {
    ...defaults,
    ...(stored.slopguardSettings || {})
  };

  if (!settings.openaiApiKey && stored.openaiApiKey) {
    settings.openaiApiKey = stored.openaiApiKey;
  }

  enabled.checked = settings.enabled;
  debugLogging.checked = settings.debugLogging;
  provider.value = settings.provider;
  apiKey.value = settings.openaiApiKey || '';
  openaiModel.value = settings.openaiModel;
  warnThreshold.value = String(settings.warnThreshold);
  highThreshold.value = String(settings.highThreshold);
  openaiGateThreshold.value = String(settings.openaiGateThreshold);
}

async function saveSettings(): Promise<void> {
  const settings: SlopGuardSettings = {
    enabled: enabled.checked,
    debugLogging: debugLogging.checked,
    provider: provider.value as Provider,
    openaiApiKey: apiKey.value.trim(),
    openaiModel: openaiModel.value.trim() || defaults.openaiModel,
    warnThreshold: Number(warnThreshold.value || defaults.warnThreshold),
    highThreshold: Number(highThreshold.value || defaults.highThreshold),
    openaiGateThreshold: Number(openaiGateThreshold.value || defaults.openaiGateThreshold)
  };

  await storageSet({
    slopguardSettings: settings,
    openaiApiKey: settings.openaiApiKey || ''
  });

  setStatus('Saved. Refresh YouTube tabs to apply changes.');
}

async function updateStats(): Promise<void> {
  const result = await runtimeMessage<Record<string, unknown>>({ type: 'GET_STATS' });
  stats.textContent = JSON.stringify(result, null, 2);
}

async function clearSlopGuardCache(): Promise<void> {
  const result = await runtimeMessage<{ removed: number }>({ type: 'CLEAR_CACHE' });
  setStatus(`Cleared ${result.removed} cached classifications. Refresh YouTube tabs.`);
  await updateStats();
}

save.addEventListener('click', () => {
  saveSettings().catch((error) => {
    console.error('Failed to save SlopGuard settings', error);
    setStatus('Failed to save settings. Check console.');
  });
});

refreshStats.addEventListener('click', () => {
  updateStats().catch((error) => {
    console.error('Failed to refresh SlopGuard stats', error);
    setStatus('Failed to refresh stats. Check console.');
  });
});

clearCache.addEventListener('click', () => {
  clearSlopGuardCache().catch((error) => {
    console.error('Failed to clear SlopGuard cache', error);
    setStatus('Failed to clear cache. Check console.');
  });
});

load()
  .then(updateStats)
  .catch((error) => {
    console.error('Failed to initialize SlopGuard settings', error);
    setStatus('Failed to initialize settings. Check console.');
  });
