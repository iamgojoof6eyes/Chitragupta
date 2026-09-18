/**
 * Chitragupta Options Page Controller
 */

const STORAGE_SETTINGS_KEY = 'chitragupta_user_settings';

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const serverUrlInput = document.getElementById('server-url');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const testFeedback = document.getElementById('test-feedback');
  const backendStatusBadge = document.getElementById('backend-status-badge');
  const aiStatusBadge = document.getElementById('ai-status-badge');
  const aiProviderSelect = document.getElementById('ai-provider');
  const aiModelInput = document.getElementById('ai-model');
  const apiKeyInput = document.getElementById('api-key');
  const apiKeyGroup = document.getElementById('api-key-group');
  const maxDepthSelect = document.getElementById('max-depth');
  const minBookmarksSelect = document.getElementById('min-bookmarks');
  const mergeSingleSubfoldersCheckbox = document.getElementById('merge-single-subfolders');
  const excludedFoldersInput = document.getElementById('excluded-folders');
  const cleanEmptyCheckbox = document.getElementById('clean-empty-folders');
  const btnExportBackup = document.getElementById('btn-export-backup');
  const btnClearBackup = document.getElementById('btn-clear-backup');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const saveStatus = document.getElementById('save-status');

  function updateAiIntelligenceBadge() {
    if (!aiStatusBadge) return;
    const provider = aiProviderSelect.value;
    const apiKey = (apiKeyInput.value || '').trim();

    if (provider === 'rules') {
      aiStatusBadge.textContent = 'Rules Mode (Active)';
      aiStatusBadge.className = 'badge rules';
    } else if (apiKey) {
      const provName = provider === 'gemini' ? 'Gemini' : 'NVIDIA NIM';
      aiStatusBadge.textContent = `Online (Direct Key: ${provName})`;
      aiStatusBadge.className = 'badge online';
    } else {
      aiStatusBadge.textContent = 'API Key Required';
      aiStatusBadge.className = 'badge offline';
    }
  }

  // Load Saved Settings
  async function loadSettings() {
    let settings = {
      serverUrl: 'http://localhost:8000',
      aiProvider: 'rules',
      aiModel: '',
      apiKey: '',
      maxDepth: '2',
      minBookmarks: '2',
      mergeSingleItemSubfolders: true,
      excludedFolders: '',
      cleanEmptyFolders: true
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get([STORAGE_SETTINGS_KEY]);
      if (stored[STORAGE_SETTINGS_KEY]) {
        settings = { ...settings, ...stored[STORAGE_SETTINGS_KEY] };
      }
    }

    serverUrlInput.value = settings.serverUrl;
    aiProviderSelect.value = settings.aiProvider;
    aiModelInput.value = settings.aiModel;
    apiKeyInput.value = settings.apiKey;
    maxDepthSelect.value = settings.maxDepth;
    minBookmarksSelect.value = settings.minBookmarks;
    if (mergeSingleSubfoldersCheckbox) {
      mergeSingleSubfoldersCheckbox.checked = settings.mergeSingleItemSubfolders !== false;
    }
    excludedFoldersInput.value = settings.excludedFolders;
    cleanEmptyCheckbox.checked = settings.cleanEmptyFolders;

    toggleApiKeyVisibility();
    updateAiIntelligenceBadge();
    await testConnection(false);
  }

  function toggleApiKeyVisibility() {
    if (aiProviderSelect.value === 'rules') {
      apiKeyGroup.style.display = 'none';
    } else {
      apiKeyGroup.style.display = 'flex';
      if (aiProviderSelect.value === 'gemini' && !aiModelInput.value) {
        aiModelInput.placeholder = 'gemini-1.5-flash';
      } else if (aiProviderSelect.value === 'nvidia' && !aiModelInput.value) {
        aiModelInput.placeholder = 'openai/gpt-oss-20b';
      }
    }
    updateAiIntelligenceBadge();
  }

  aiProviderSelect.addEventListener('change', toggleApiKeyVisibility);
  apiKeyInput.addEventListener('input', updateAiIntelligenceBadge);

  // Test Server Connection
  async function testConnection(isManual = true) {
    const url = (serverUrlInput.value || 'http://localhost:8000').replace(/\/+$/, '');
    if (isManual) {
      testFeedback.textContent = 'Connecting...';
      testFeedback.className = 'feedback-text';
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      const resp = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const latency = Date.now() - startTime;

      if (resp.ok) {
        const data = await resp.json();
        backendStatusBadge.textContent = 'Online';
        backendStatusBadge.className = 'badge online';
        if (isManual) {
          testFeedback.textContent = `Connected! Provider: ${data.provider || 'Ready'} (${latency}ms)`;
          testFeedback.className = 'feedback-text success';
        }
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      backendStatusBadge.textContent = 'Offline';
      backendStatusBadge.className = 'badge offline';
      if (isManual) {
        testFeedback.textContent = 'Could not reach server. Verify it is running on localhost:8000.';
        testFeedback.className = 'feedback-text error';
      }
    }
  }

  btnTestConnection.addEventListener('click', () => testConnection(true));

  // Save Settings
  async function saveSettings() {
    const settings = {
      serverUrl: serverUrlInput.value.trim() || 'http://localhost:8000',
      aiProvider: aiProviderSelect.value,
      aiModel: aiModelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      maxDepth: maxDepthSelect.value,
      minBookmarks: minBookmarksSelect.value,
      mergeSingleItemSubfolders: mergeSingleSubfoldersCheckbox ? mergeSingleSubfoldersCheckbox.checked : true,
      excludedFolders: excludedFoldersInput.value.trim(),
      cleanEmptyFolders: cleanEmptyCheckbox.checked
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        [STORAGE_SETTINGS_KEY]: settings,
        chitragupta_api_config: { serverUrl: settings.serverUrl }
      });
    }

    saveStatus.textContent = 'Settings saved successfully at ' + new Date().toLocaleTimeString();
    saveStatus.style.color = 'var(--accent-success)';
    setTimeout(() => {
      saveStatus.style.color = 'var(--text-muted)';
    }, 2500);
  }

  btnSaveSettings.addEventListener('click', saveSettings);

  // Export Last Backup
  btnExportBackup.addEventListener('click', async () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const data = await chrome.storage.local.get(['chitragupta_last_backup']);
    const backup = data['chitragupta_last_backup'];

    if (!backup) {
      alert('No backup found in storage yet.');
      return;
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `chitragupta_backup_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  });

  // Clear Backup History
  btnClearBackup.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete stored backup snapshots? This cannot be undone.')) {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.remove(['chitragupta_last_backup', 'chitragupta_backup_history']);
      }
      alert('Backup history cleared.');
    }
  });

  await loadSettings();
});
