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

  const alwaysSortAlphabeticalCheckbox = document.getElementById('always-sort-alphabetical');
  const bookmarkSearchInput = document.getElementById('bookmark-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const searchFieldRadios = document.querySelectorAll('input[name="search-field"]');
  const searchResultsContainer = document.getElementById('search-results-container');
  const searchResultsSummary = document.getElementById('search-results-summary');
  const searchResultsCountText = document.getElementById('search-results-count-text');
  const searchCountBadge = document.getElementById('search-count-badge');

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
      cleanEmptyFolders: true,
      sortAlphabetical: false
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
    if (alwaysSortAlphabeticalCheckbox) {
      alwaysSortAlphabeticalCheckbox.checked = settings.sortAlphabetical === true;
    }

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
      cleanEmptyFolders: cleanEmptyCheckbox.checked,
      sortAlphabetical: alwaysSortAlphabeticalCheckbox ? alwaysSortAlphabeticalCheckbox.checked : false
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

  // ==========================================
  // Bookmark Search Engine (Tags / URL / Title)
  // ==========================================
  let indexedBookmarks = [];

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function extractDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }

  // Load and index all bookmarks from Chrome/browser tree
  async function indexAllBookmarks() {
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      if (searchCountBadge) searchCountBadge.textContent = '0 Bookmarks';
      return;
    }

    try {
      const tree = await chrome.bookmarks.getTree();
      const flatList = [];

      function traverse(node, currentSegments = []) {
        if (node.url) {
          const domain = extractDomain(node.url);
          const domainToken = domain.split('.')[0] || '';
          const folderTags = currentSegments.filter(s => !['bookmarks bar', 'other bookmarks', 'mobile bookmarks'].includes(s.toLowerCase()));
          const tags = Array.from(new Set([...folderTags, domainToken].filter(Boolean)));

          flatList.push({
            id: String(node.id),
            title: node.title || domain || 'Untitled Bookmark',
            url: node.url,
            domain,
            folderPath: currentSegments.join(' / '),
            tags,
            searchTitle: (node.title || '').toLowerCase(),
            searchUrl: (node.url || '').toLowerCase(),
            searchTags: tags.join(' ').toLowerCase()
          });
        }

        if (node.children && Array.isArray(node.children)) {
          const cleanTitle = (node.title || '').trim();
          const nextSegments = cleanTitle ? [...currentSegments, cleanTitle] : currentSegments;
          for (const child of node.children) {
            traverse(child, nextSegments);
          }
        }
      }

      for (const root of tree) {
        traverse(root, []);
      }

      indexedBookmarks = flatList;
      if (searchCountBadge) {
        searchCountBadge.textContent = `${indexedBookmarks.length} Bookmarks`;
      }
    } catch (e) {
      console.warn('Could not index bookmarks for search:', e);
      if (searchCountBadge) searchCountBadge.textContent = 'Unavailable';
    }
  }

  function getActiveSearchField() {
    for (const r of searchFieldRadios) {
      if (r.checked) return r.value;
    }
    return 'all';
  }

  function renderSearchResults(results, query) {
    if (!searchResultsContainer) return;
    searchResultsContainer.innerHTML = '';

    if (!query) {
      if (searchResultsSummary) searchResultsSummary.classList.add('hidden');
      searchResultsContainer.innerHTML = `
        <div class="search-placeholder">
          Type in the box above to instantly search through ${indexedBookmarks.length} bookmarks.
        </div>
      `;
      return;
    }

    if (searchResultsSummary && searchResultsCountText) {
      searchResultsSummary.classList.remove('hidden');
      searchResultsCountText.textContent = `${results.length} match${results.length === 1 ? '' : 'es'} for "${query}"`;
    }

    if (results.length === 0) {
      searchResultsContainer.innerHTML = `
        <div class="search-no-results">
          No bookmarks found matching "<strong>${escapeHtml(query)}</strong>". Try another keyword or change search criteria.
        </div>
      `;
      return;
    }

    // Render up to 100 results for fast DOM performance
    const toRender = results.slice(0, 100);
    for (const item of toRender) {
      const card = document.createElement('div');
      card.className = 'search-result-item';

      const faviconUrl = item.domain
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.domain)}&sz=32`
        : '';

      const tagsHtml = item.tags.length > 0
        ? item.tags.map(t => `<span class="tag-badge" data-tag="${escapeHtml(t)}">🏷️ ${escapeHtml(t)}</span>`).join('')
        : '';
      const folderBadge = item.folderPath
        ? `<span class="tag-badge folder-badge" title="Folder: ${escapeHtml(item.folderPath)}">📁 ${escapeHtml(item.folderPath.split(' / ').pop())}</span>`
        : '';

      card.innerHTML = `
        <div class="result-main">
          <div class="result-title-row">
            ${faviconUrl ? `<img class="result-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="result-title" title="${escapeHtml(item.title)}">
              ${escapeHtml(item.title)}
            </a>
          </div>
          <span class="result-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
          <div class="result-tags-row">
            ${folderBadge}
            ${tagsHtml}
          </div>
        </div>
        <div class="result-actions">
          <button class="btn-result-action btn-copy-url" data-url="${escapeHtml(item.url)}" title="Copy URL">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn-result-action" title="Open Link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Open
          </a>
        </div>
      `;

      // Copy URL button listener
      const copyBtn = card.querySelector('.btn-copy-url');
      if (copyBtn) {
        copyBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(item.url);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
              copyBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
              `;
            }, 1500);
          } catch (err) {
            console.warn('Clipboard error:', err);
          }
        });
      }

      // Clicking tag badge sets search query to that tag
      const tagElements = card.querySelectorAll('.tag-badge[data-tag]');
      tagElements.forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const t = el.getAttribute('data-tag');
          if (t && bookmarkSearchInput) {
            bookmarkSearchInput.value = t;
            // Switch radio to tags
            const tagRadio = document.querySelector('input[name="search-field"][value="tags"]');
            if (tagRadio) tagRadio.checked = true;
            executeSearch();
          }
        });
      });

      searchResultsContainer.appendChild(card);
    }
  }

  function executeSearch() {
    if (!bookmarkSearchInput) return;
    const query = bookmarkSearchInput.value.trim();

    if (btnClearSearch) {
      if (query) btnClearSearch.classList.remove('hidden');
      else btnClearSearch.classList.add('hidden');
    }

    if (!query) {
      renderSearchResults([], '');
      return;
    }

    const field = getActiveSearchField();
    const qLower = query.toLowerCase();

    const matches = indexedBookmarks.filter(item => {
      if (field === 'title') {
        return item.searchTitle.includes(qLower);
      } else if (field === 'url') {
        return item.searchUrl.includes(qLower);
      } else if (field === 'tags') {
        return item.searchTags.includes(qLower);
      } else {
        // 'all'
        return item.searchTitle.includes(qLower) || item.searchUrl.includes(qLower) || item.searchTags.includes(qLower);
      }
    });

    renderSearchResults(matches, query);
  }

  let searchDebounceTimer = null;
  if (bookmarkSearchInput) {
    bookmarkSearchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(executeSearch, 120);
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (bookmarkSearchInput) bookmarkSearchInput.value = '';
      executeSearch();
      bookmarkSearchInput.focus();
    });
  }

  searchFieldRadios.forEach(r => {
    r.addEventListener('change', executeSearch);
  });

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
  await indexAllBookmarks();
});
