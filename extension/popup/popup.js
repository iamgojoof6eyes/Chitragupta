/**
 * Chitragupta Popup UI Controller
 * Integrates Save Page, Bookmark Tree Explorer, Rule/AI Classifier, Plan Diff Preview, and Undo.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // State variables
  let currentActiveTab = null;
  let parsedTreeData = null;
  let rawBookmarkTree = null;
  let currentProposedPlan = null;

  // DOM Elements - Navigation & Headers
  const tabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const aiStatusPill = document.getElementById('ai-status-pill');
  const aiStatusText = document.getElementById('ai-status-text');
  const btnOptions = document.getElementById('btn-options');
  const toastMessage = document.getElementById('toast-message');
  const btnSaveCurrentTree = document.getElementById('btn-save-current-tree');
  const btnRollbackSavedTree = document.getElementById('btn-rollback-saved-tree');
  const savedTreeBadge = document.getElementById('saved-tree-badge');

  // Tab 1 Elements (Save)
  const inputTitle = document.getElementById('input-title');
  const inputUrl = document.getElementById('input-url');
  const pageFavicon = document.getElementById('page-favicon');
  const saveDetectedBadge = document.getElementById('save-detected-badge');
  const selectFolder = document.getElementById('select-folder');
  const tagPills = document.getElementById('tag-pills');
  const inputTags = document.getElementById('input-tags');
  const btnSaveBookmark = document.getElementById('btn-save-bookmark');

  // Tab 2 Elements (Organize)
  const statTotalBookmarks = document.getElementById('stat-total-bookmarks');
  const statTotalFolders = document.getElementById('stat-total-folders');
  const statDuplicates = document.getElementById('stat-duplicates');
  const selectScope = document.getElementById('select-scope');
  const checkCleanEmpty = document.getElementById('check-clean-empty');
  const btnAnalyze = document.getElementById('btn-analyze');
  const organizeControls = document.getElementById('organize-controls');
  const organizeProgress = document.getElementById('organize-progress');
  const progressTitle = document.getElementById('progress-title');
  const progressDesc = document.getElementById('progress-desc');
  const progressFill = document.getElementById('progress-fill');
  const progressCountsText = document.getElementById('progress-counts-text');
  const progressPercentBadge = document.getElementById('progress-percent-badge');
  const btnStopOrganize = document.getElementById('btn-stop-organize');
  const organizePreview = document.getElementById('organize-preview');
  const previewBadgeCount = document.getElementById('preview-badge-count');
  const pillNewFolders = document.getElementById('pill-new-folders');
  const pillMoves = document.getElementById('pill-moves');
  const pillDeletes = document.getElementById('pill-deletes');
  const previewTreeList = document.getElementById('preview-tree-list');
  const btnCancelPlan = document.getElementById('btn-cancel-plan');
  const btnApplyPlan = document.getElementById('btn-apply-plan');
  const previewBackgroundBanner = document.getElementById('preview-background-banner');
  const previewBannerText = document.getElementById('preview-banner-text');

  let isDirectCancelled = false;

  function updateProgressBar(percent, title, desc, doneCount = null, totalCount = null) {
    const safePct = Math.max(0, Math.min(100, Math.round(percent || 0)));
    if (progressFill) progressFill.style.width = `${safePct}%`;
    if (progressPercentBadge) progressPercentBadge.textContent = `${safePct}%`;
    if (title && progressTitle) progressTitle.textContent = title;
    if (desc && progressDesc) progressDesc.textContent = desc;

    if (progressCountsText) {
      if (doneCount !== null && doneCount !== undefined && totalCount !== null && totalCount !== undefined && totalCount > 0) {
        const left = Math.max(0, totalCount - doneCount);
        progressCountsText.textContent = `${doneCount}/${totalCount} done (${left} left)`;
      } else {
        progressCountsText.textContent = `${safePct}% complete`;
      }
    }
  }

  // Tab 3 Elements (Explorer)
  const searchBookmarks = document.getElementById('search-bookmarks');
  const btnRefreshTree = document.getElementById('btn-refresh-tree');
  const treeContainer = document.getElementById('tree-container');

  function switchToTab(tabId) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === tabId));
  }

  // 1. Navigation Switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Settings click
  btnOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  // 2. Toast Helper
  function showToast(text, type = 'success') {
    toastMessage.textContent = text;
    toastMessage.className = `toast ${type}`;
    setTimeout(() => {
      toastMessage.className = 'toast hidden';
    }, 2800);
  }

  // 3. Initialize API & Status
  // 3. Backend & AI Intelligence Health Status Check
  async function checkBackendStatus() {
    try {
      await apiClient.init();
      const status = await apiClient.checkHealth();
      const stored = await chrome.storage.local.get(['chitragupta_user_settings']);
      const settings = stored.chitragupta_user_settings || {};
      const hasDirectKey = Boolean(settings.apiKey && (settings.aiProvider === 'gemini' || settings.aiProvider === 'nvidia'));
      const provName = settings.aiProvider === 'gemini' ? 'Gemini' : 'NVIDIA NIM';

      if (status.online) {
        aiStatusPill.className = 'status-pill online';
        aiStatusText.textContent = status.aiConfigured ? 'Local Server (AI)' : 'Local Server';
        aiStatusPill.title = `Connected to local backend (${status.provider})`;
      } else if (hasDirectKey) {
        // Local server is offline, but extension settings have a valid direct API key!
        aiStatusPill.className = 'status-pill direct';
        aiStatusText.textContent = `AI Online (${provName})`;
        aiStatusPill.title = `Local server is offline. Direct ${provName} API key active from settings.`;
      } else {
        aiStatusPill.className = 'status-pill offline';
        aiStatusText.textContent = 'Rules Mode';
        aiStatusPill.title = 'Local server offline and no API key set. Operating in hybrid rules mode.';
      }
    } catch {
      aiStatusPill.className = 'status-pill offline';
      aiStatusText.textContent = 'Rules Mode';
    }
  }

  // 4. Load Current Tab Data for Tab 1
  async function loadCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        currentActiveTab = tab;
        inputTitle.value = tab.title || 'Untitled Webpage';
        inputUrl.value = tab.url || '';
        if (tab.favIconUrl) {
          pageFavicon.src = tab.favIconUrl;
        }

        // Run fast rule classification on active page
        const ruleMatch = classifyWithRules({
          title: tab.title,
          url: tab.url,
          folderPath: ''
        });

        if (ruleMatch) {
          saveDetectedBadge.textContent = `${ruleMatch.category} / ${ruleMatch.subcategory}`;
          renderTagPills(ruleMatch.tags || []);
        } else {
          saveDetectedBadge.textContent = 'General Bookmark';
          renderTagPills(['Web']);
        }
      }
    } catch (err) {
      console.warn('Could not query active tab:', err);
    }
  }

  function renderTagPills(tags) {
    tagPills.innerHTML = '';
    tags.forEach(tag => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = '#' + tag;
      tagPills.appendChild(pill);
    });
  }

  // 5. Load and Parse Bookmark Tree (Scoped exclusively to Bookmarks Bar '1')
  async function refreshBookmarkData() {
    try {
      rawBookmarkTree = await chrome.bookmarks.getSubTree('1');
      parsedTreeData = parseBookmarkTree(rawBookmarkTree);

      // Update Tab 2 Stats (only Bookmarks Bar)
      statTotalBookmarks.textContent = parsedTreeData.bookmarks.length;
      statTotalFolders.textContent = parsedTreeData.folders.filter(f => !f.isSystem).length;
      statDuplicates.textContent = parsedTreeData.duplicates.length;

      // Populate Folder Selectors
      populateFolderDropdowns(parsedTreeData.folders);
      populateScopeDropdown(parsedTreeData.folders);

      // Render Tree Explorer
      renderExplorerTree(rawBookmarkTree);

      // Check Saved Baseline / Rollback Status
      await updateSavedBaselineStatus();
    } catch (err) {
      console.error('Error refreshing bookmarks:', err);
      showToast('Error reading bookmarks', 'error');
    }
  }

  function populateFolderDropdowns(folders) {
    selectFolder.innerHTML = `
      <option value="1">📌 Bookmarks Bar (Root)</option>
    `;

    // Add only user folders within Bookmarks Bar
    folders.forEach(f => {
      if (!f.isSystem && f.id !== '1' && f.id !== '2' && f.id !== '3') {
        const opt = document.createElement('option');
        opt.value = f.id;
        const cleanName = f.path.replace(/^Bookmarks bar\s*\/\s*/i, '');
        opt.textContent = `📁 ${cleanName}`;
        selectFolder.appendChild(opt);
      }
    });
  }

  function populateScopeDropdown(folders) {
    if (!selectScope) return;
    const currentVal = selectScope.value;
    selectScope.innerHTML = `
      <option value="1">📌 All Bookmarks Bar Folders</option>
    `;

    // Only folders within Bookmarks Bar
    folders.forEach(f => {
      if (!f.isSystem && f.id !== '1' && f.id !== '2' && f.id !== '3') {
        const opt = document.createElement('option');
        opt.value = f.id;
        const cleanName = f.path.replace(/^Bookmarks bar\s*\/\s*/i, '');
        opt.textContent = `📁 ${cleanName}`;
        selectScope.appendChild(opt);
      }
    });

    if (currentVal && Array.from(selectScope.options).some(o => o.value === currentVal)) {
      selectScope.value = currentVal;
    } else {
      selectScope.value = '1';
    }
  }

  // 6. Check Baseline Snapshot & Rollback Status
  async function updateSavedBaselineStatus() {
    try {
      const baseline = await getBaselineSnapshot();
      if (baseline && baseline.tree) {
        const countText = baseline.bmCount != null ? ` (${baseline.bmCount} bms)` : '';
        const prefix = baseline.isAutoBackup ? 'Auto-backup: ' : 'Saved: ';
        if (savedTreeBadge) {
          savedTreeBadge.textContent = `${prefix}${baseline.formattedDate || 'Yes'}${countText}`;
          savedTreeBadge.className = 'badge-snapshot saved';
          savedTreeBadge.title = `Baseline snapshot saved at ${baseline.formattedDate || 'earlier'}. Click Roll Back to restore this structure.`;
        }
        if (btnRollbackSavedTree) {
          btnRollbackSavedTree.disabled = false;
        }
      } else {
        if (savedTreeBadge) {
          savedTreeBadge.textContent = 'No Baseline Saved';
          savedTreeBadge.className = 'badge-snapshot';
          savedTreeBadge.title = 'Click Save Structure to create a baseline snapshot.';
        }
        if (btnRollbackSavedTree) {
          btnRollbackSavedTree.disabled = true;
        }
      }
    } catch (e) {
      console.warn('Could not check baseline status:', e);
    }
  }

  // Handle Save Current Tree Structure Action
  if (btnSaveCurrentTree) {
    btnSaveCurrentTree.addEventListener('click', async () => {
      btnSaveCurrentTree.disabled = true;
      const originalHtml = btnSaveCurrentTree.innerHTML;
      btnSaveCurrentTree.textContent = 'Saving...';
      try {
        const snapshot = await saveBaselineSnapshot();
        showToast(`Baseline saved! (${snapshot.bmCount} bookmarks, ${snapshot.folderCount} folders)`, 'success');
        await updateSavedBaselineStatus();
      } catch (err) {
        showToast('Error saving structure: ' + err.message, 'error');
      } finally {
        btnSaveCurrentTree.disabled = false;
        btnSaveCurrentTree.innerHTML = originalHtml;
      }
    });
  }

  // Handle Roll Back to Saved Tree Structure Action
  if (btnRollbackSavedTree) {
    btnRollbackSavedTree.addEventListener('click', async () => {
      btnRollbackSavedTree.disabled = true;
      const originalHtml = btnRollbackSavedTree.innerHTML;
      btnRollbackSavedTree.textContent = 'Rolling back...';
      try {
        const result = await rollbackToSavedStructure();
        showToast(`Rolled back to saved structure! (${result.restoredCount} bookmarks in ${result.foldersRestored} folders)`, 'success');
        await refreshBookmarkData();
      } catch (err) {
        showToast('Rollback failed: ' + err.message, 'error');
      } finally {
        btnRollbackSavedTree.disabled = false;
        btnRollbackSavedTree.innerHTML = originalHtml;
      }
    });
  }

  // Export Current Bookmark Tree to JSON
  const btnQuickExportJson = document.getElementById('btn-quick-export-json');
  if (btnQuickExportJson) {
    btnQuickExportJson.addEventListener('click', async () => {
      try {
        const tree = await chrome.bookmarks.getTree();
        const dateStr = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `bookmarks_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        showToast('Backup JSON downloaded!', 'success');
      } catch (err) {
        showToast('Error exporting backup JSON', 'error');
      }
    });
  }

  // Restore All 16 Original Folders from Clean Snapshot
  const btnRestorePristine = document.getElementById('btn-restore-pristine');
  if (btnRestorePristine) {
    btnRestorePristine.addEventListener('click', async () => {
      btnRestorePristine.disabled = true;
      btnRestorePristine.textContent = 'Restoring...';
      try {
        const resp = await fetch(chrome.runtime.getURL('original_bookmarks_restoration.json'));
        if (!resp.ok) throw new Error('Could not load restoration snapshot file.');
        const pristineTree = await resp.json();
        const res = await restoreFromTreeSnapshot(pristineTree);
        showToast(`Successfully restored ${res.totalRestored} bookmarks across ${res.foldersRestored} original folders!`, 'success');
        await refreshBookmarkData();
      } catch (err) {
        console.error('Error restoring pristine bookmarks:', err);
        showToast('Restoration error: ' + err.message, 'error');
      } finally {
        btnRestorePristine.disabled = false;
        btnRestorePristine.textContent = 'Restore 16 Folders';
      }
    });
  }

  // Restore Bookmarks from an uploaded JSON file
  const inputRestoreJson = document.getElementById('input-restore-json');
  if (inputRestoreJson) {
    inputRestoreJson.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const snapshot = JSON.parse(evt.target.result);
          showToast('Restoring bookmarks from JSON...', 'success');
          const res = await restoreFromTreeSnapshot(snapshot);
          showToast(`Restored ${res.totalRestored} bookmarks from JSON!`, 'success');
          await refreshBookmarkData();
        } catch (err) {
          console.error('JSON restore error:', err);
          showToast('Invalid or corrupted JSON backup file', 'error');
        }
      };
      reader.readAsText(file);
      inputRestoreJson.value = ''; // Reset input
    });
  }

  // 7. Save Current Page Bookmark
  btnSaveBookmark.addEventListener('click', async () => {
    if (!inputUrl.value) {
      showToast('No active URL found', 'error');
      return;
    }

    btnSaveBookmark.disabled = true;
    btnSaveBookmark.textContent = 'Saving...';

    try {
      let targetFolderId = selectFolder.value;

      if (targetFolderId === 'default') {
        // Find or create 'AI Bookmarks'
        const barFolders = parsedTreeData.folders.filter(f => f.parentId === '1');
        const aiFolder = barFolders.find(f => f.title.toLowerCase() === 'ai bookmarks');
        if (aiFolder) {
          targetFolderId = aiFolder.id;
        } else {
          const created = await chrome.bookmarks.create({
            parentId: '1',
            title: 'AI Bookmarks'
          });
          targetFolderId = created.id;
        }
      }

      await chrome.bookmarks.create({
        parentId: targetFolderId,
        title: inputTitle.value.trim() || 'Saved Bookmark',
        url: inputUrl.value.trim()
      });

      showToast('Bookmark saved successfully!', 'success');
      await refreshBookmarkData();
    } catch (err) {
      console.error('Failed to save bookmark:', err);
      showToast('Could not save bookmark', 'error');
    } finally {
      btnSaveBookmark.disabled = false;
      btnSaveBookmark.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
        Save Bookmark
      `;
    }
  });

  // 8. Analyze & Propose Organization Plan (Tab 2)
  btnAnalyze.addEventListener('click', async () => {
    const scopeId = selectScope.value;
    const cleanEmpty = checkCleanEmpty.checked;

    organizeControls.classList.add('hidden');
    organizePreview.classList.add('hidden');
    organizeProgress.classList.remove('hidden');

    updateProgressBar(10, 'Arranging Bookmarks...', 'Running in background (safe to click away or close popup anytime)', 0, 0);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'START_ANALYSIS',
        scopeId,
        cleanEmpty
      });

      if (response && response.success && response.planData) {
        currentProposedPlan = response.planData;
        renderPlanPreview(response.planData.plan, false);
        organizeProgress.classList.add('hidden');
        organizePreview.classList.remove('hidden');
        showToast('Arranging complete! Review changes below.', 'success');
      } else if (response && !response.success) {
        throw new Error(response.error || 'Failed to arrange bookmarks');
      }
    } catch (err) {
      console.warn('Background message error, falling back to direct analysis:', err);
      try {
        updateProgressBar(15, 'Reading Bookmarks...', 'Scanning Bookmarks Bar hierarchy...', 0, 0);
        const targetScopeId = (!scopeId || scopeId === '0') ? '1' : scopeId;
        const rawScopeTree = await chrome.bookmarks.getSubTree(targetScopeId);
        const scopeData = parseBookmarkTree(rawScopeTree);

        if (scopeData.bookmarks.length === 0) {
          throw new Error('No bookmarks found in Bookmarks Bar.');
        }

        const totalBms = scopeData.bookmarks.length;
        updateProgressBar(20, 'Classifying Bookmarks...', `Classifying bookmarks (0/${totalBms} done, ${totalBms} left)...`, 0, totalBms);

        const classified = await classifyBookmarks(scopeData.bookmarks, {
          onProgress: (done, total) => {
            const left = Math.max(0, total - done);
            const pct = Math.round(15 + (done / total) * 70);
            updateProgressBar(pct, 'Classifying Bookmarks...', `Classifying bookmarks (${done}/${total} done, ${left} left)...`, done, total);
          },
          aiClient: async (ambiguous, onChunk) => apiClient.classifyBatch(ambiguous, onChunk)
        });

        updateProgressBar(88, 'Generating Plan...', 'Building proposed folder hierarchy...', totalBms, totalBms);

        const stored = await chrome.storage.local.get(['chitragupta_user_settings']);
        const userSettings = stored.chitragupta_user_settings || {};
        const plan = generateOrganizationPlan(classified, scopeData.folders, {
          targetParentId: '1',
          maxDepth: parseInt(userSettings.maxDepth, 10) || 2,
          minBookmarksPerFolder: parseInt(userSettings.minBookmarks, 10) || 2,
          mergeSingleItemSubfolders: userSettings.mergeSingleItemSubfolders !== false,
          cleanEmptyFolders: cleanEmpty !== false
        });

        currentProposedPlan = {
          plan,
          rawTree: rawScopeTree,
          originalBookmarks: scopeData.bookmarks,
          createdAt: Date.now()
        };

        await chrome.storage.local.set({ chitragupta_pending_plan: currentProposedPlan });
        renderPlanPreview(plan, false);
        organizeProgress.classList.add('hidden');
        organizePreview.classList.remove('hidden');
      } catch (innerErr) {
        showToast(innerErr.message, 'error');
        organizeProgress.classList.add('hidden');
        organizeControls.classList.remove('hidden');
      }
    }
  });

  // Render Plan Preview Diff
  function renderPlanPreview(plan, isFromBackground = false) {
    const totalChanges = plan.moves.length + plan.newFolders.length + plan.foldersToDelete.length;
    previewBadgeCount.textContent = `${totalChanges} changes`;

    pillNewFolders.textContent = `+ ${plan.newFolders.length} Folders`;
    pillMoves.textContent = `→ ${plan.moves.length} Moves`;
    pillDeletes.textContent = `- ${plan.foldersToDelete.length} Clean`;

    // Show background banner if arrangement was finished while popup was closed
    if (previewBackgroundBanner) {
      if (isFromBackground) {
        previewBackgroundBanner.classList.remove('hidden');
        const timeText = currentProposedPlan && currentProposedPlan.formattedTime ? ` (${currentProposedPlan.formattedTime})` : '';
        if (previewBannerText) {
          previewBannerText.textContent = `Arranging completed while away${timeText}! Review changes and click "Apply Changes" below to reorganize.`;
        }
      } else {
        previewBackgroundBanner.classList.add('hidden');
      }
    }

    previewTreeList.innerHTML = '';

    if (totalChanges === 0) {
      previewTreeList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 20px 0;">
          🎉 All bookmarks in Bookmarks Bar are already perfectly organized!
        </div>
      `;
      btnApplyPlan.disabled = true;
      return;
    }
    btnApplyPlan.disabled = false;

    // Show planned new folders
    plan.newFolders.forEach(f => {
      const item = document.createElement('div');
      item.className = 'preview-item type-folder';
      item.innerHTML = `
        <div class="preview-item-title">
          <span>📁 + New Folder:</span>
          <span>${escapeHtml(f.pathStr)}</span>
        </div>
      `;
      previewTreeList.appendChild(item);
    });

    // Show planned bookmark moves
    plan.moves.forEach(m => {
      const item = document.createElement('div');
      item.className = 'preview-item type-move';
      item.innerHTML = `
        <div class="preview-item-title">
          <span>🔗</span>
          <span>${escapeHtml(m.title)}</span>
        </div>
        <div class="preview-item-desc">
          <span>${escapeHtml(m.fromFolder)}</span> &rarr; <strong style="color: var(--accent-move)">${escapeHtml(m.toFolder)}</strong>
        </div>
      `;
      previewTreeList.appendChild(item);
    });

    // Show empty folders to delete
    plan.foldersToDelete.forEach(d => {
      const item = document.createElement('div');
      item.className = 'preview-item type-clean';
      item.innerHTML = `
        <div class="preview-item-title">
          <span>🗑️ Remove Empty:</span>
          <span>${escapeHtml(d.path)}</span>
        </div>
      `;
      previewTreeList.appendChild(item);
    });
  }

  // Cancel Preview
  btnCancelPlan.addEventListener('click', async () => {
    organizePreview.classList.add('hidden');
    organizeControls.classList.remove('hidden');
    currentProposedPlan = null;
    try {
      await chrome.runtime.sendMessage({ action: 'CANCEL_PLAN' });
    } catch {}
    await chrome.storage.local.remove(['chitragupta_pending_plan', 'chitragupta_analysis_state']);
    chrome.action.setBadgeText({ text: '' });
  });

  // Apply Changes (Delegates to Background with Direct Fallback)
  btnApplyPlan.addEventListener('click', async () => {
    if (!currentProposedPlan) return;

    btnApplyPlan.disabled = true;
    btnCancelPlan.disabled = true;

    organizePreview.classList.add('hidden');
    organizeProgress.classList.remove('hidden');

    progressTitle.textContent = 'Applying Organization...';
    progressDesc.textContent = 'Moving bookmarks in background (safe to close popup anytime)';
    progressFill.style.width = '20%';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'APPLY_PLAN' });
      if (response && response.success && response.result) {
        showToast(`Successfully moved ${response.result.movesCompleted} bookmarks!`, 'success');
        currentProposedPlan = null;
        await refreshBookmarkData();
      } else if (response && !response.success) {
        throw new Error(response.error || 'Failed to apply plan');
      }
    } catch (err) {
      console.warn('Apply message error, falling back to direct:', err);
      try {
        const result = await executeOrganizationPlan(
          currentProposedPlan.plan,
          currentProposedPlan.rawTree,
          currentProposedPlan.originalBookmarks,
          (percent, statusMsg) => {
            progressTitle.textContent = statusMsg;
            progressFill.style.width = `${percent}%`;
          }
        );
        await chrome.storage.local.remove(['chitragupta_pending_plan', 'chitragupta_analysis_state', 'chitragupta_apply_state']);
        chrome.action.setBadgeText({ text: '' });
        showToast(`Successfully moved ${result.movesCompleted} bookmarks!`, 'success');
        currentProposedPlan = null;
        await refreshBookmarkData();
      } catch (innerErr) {
        showToast(innerErr.message, 'error');
      }
    } finally {
      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
      btnApplyPlan.disabled = false;
      btnCancelPlan.disabled = false;
    }
  });

  // Stop / Cancel Button Handler
  if (btnStopOrganize) {
    btnStopOrganize.addEventListener('click', async () => {
      btnStopOrganize.disabled = true;
      btnStopOrganize.textContent = 'Stopping...';
      isDirectCancelled = true;

      try {
        await chrome.runtime.sendMessage({ action: 'STOP_ARRANGING' });
      } catch (e) {
        console.log('Stop arrange error:', e);
      }

      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
      btnStopOrganize.disabled = false;
      btnStopOrganize.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"></rect>
        </svg>
        Stop Arranging
      `;
      showToast('Arranging cancelled', 'error');
    });
  }

  // Listen for Background Arrangement and Execution Messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'ANALYSIS_PROGRESS') {
      updateProgressBar(msg.percent, msg.statusMsg, 'Running in background (safe to close popup anytime)', msg.doneCount, msg.totalCount);
    } else if (msg.action === 'ANALYSIS_COMPLETE') {
      currentProposedPlan = msg.planData;
      renderPlanPreview(msg.planData.plan, false);
      organizeProgress.classList.add('hidden');
      organizePreview.classList.remove('hidden');
      showToast('Arranging complete! Review changes below.', 'success');
    } else if (msg.action === 'ANALYSIS_ERROR') {
      showToast(msg.error, 'error');
      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
    } else if (msg.action === 'ANALYSIS_CANCELLED' || msg.action === 'ARRANGING_CANCELLED') {
      showToast('Arranging cancelled', 'error');
      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
    } else if (msg.action === 'APPLY_PROGRESS') {
      updateProgressBar(msg.percent, msg.statusMsg, 'Applying changes to Bookmarks Bar', msg.doneCount, msg.totalCount);
    } else if (msg.action === 'APPLY_CANCELLED') {
      const moved = msg.result?.movesCompleted || 0;
      showToast(`Organization stopped after moving ${moved} bookmarks`, 'error');
      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
      refreshBookmarkData();
    } else if (msg.action === 'APPLY_COMPLETE') {
      showToast(`Successfully moved ${msg.result.movesCompleted} bookmarks!`, 'success');
      currentProposedPlan = null;
      organizeProgress.classList.add('hidden');
      organizeControls.classList.remove('hidden');
      refreshBookmarkData();
    } else if (msg.action === 'APPLY_ERROR') {
      showToast(msg.error, 'error');
      organizeProgress.classList.add('hidden');
      organizePreview.classList.remove('hidden');
    }
  });

  // Check Background State When Popup Opens
  async function checkPendingBackgroundState() {
    try {
      const stored = await chrome.storage.local.get([
        'chitragupta_pending_plan',
        'chitragupta_analysis_state',
        'chitragupta_apply_state'
      ]);

      if (stored.chitragupta_apply_state?.status === 'running') {
        switchToTab('tab-organize');
        organizeControls.classList.add('hidden');
        organizePreview.classList.add('hidden');
        organizeProgress.classList.remove('hidden');
        const s = stored.chitragupta_apply_state;
        updateProgressBar(s.percent || 40, s.statusMsg || 'Applying Organization...', 'Applying changes in background', s.doneCount, s.totalCount);
      } else if (stored.chitragupta_analysis_state?.status === 'running') {
        switchToTab('tab-organize');
        organizeControls.classList.add('hidden');
        organizePreview.classList.add('hidden');
        organizeProgress.classList.remove('hidden');
        const s = stored.chitragupta_analysis_state;
        updateProgressBar(s.percent || 30, s.statusMsg || 'Arranging Bookmarks...', 'Arranging bookmarks in background', s.doneCount, s.totalCount);
      } else if (stored.chitragupta_pending_plan?.plan) {
        currentProposedPlan = stored.chitragupta_pending_plan;
        switchToTab('tab-organize');
        renderPlanPreview(currentProposedPlan.plan, true);
        organizeControls.classList.add('hidden');
        organizeProgress.classList.add('hidden');
        organizePreview.classList.remove('hidden');
        chrome.action.setBadgeText({ text: '' });
      }
    } catch (e) {
      console.warn('Could not check pending state:', e);
    }
  }

  // 9. Explorer Tree View (Tab 3)
  function renderExplorerTree(treeNodes, filterQuery = '') {
    treeContainer.innerHTML = '';
    const q = filterQuery.toLowerCase().trim();

    function renderNode(node, parentEl) {
      const isFolder = !node.url;

      if (isFolder) {
        // System root container check ('0' root and '1' Bookmarks bar)
        if (node.id === '0' || node.id === '1') {
          if (node.children) {
            node.children.forEach(child => renderNode(child, parentEl));
          }
          return;
        }

        const folderEl = document.createElement('div');
        folderEl.className = 'tree-folder';

        const count = node.children ? node.children.length : 0;
        const header = document.createElement('div');
        header.className = 'tree-folder-header';
        header.innerHTML = `
          <span>📁</span>
          <span>${escapeHtml(node.title || 'Folder')}</span>
          <span style="font-size: 10px; color: var(--text-muted); margin-left: auto;">(${count})</span>
        `;

        const content = document.createElement('div');
        content.className = 'tree-folder-content';

        header.addEventListener('click', () => {
          content.style.display = content.style.display === 'none' ? 'flex' : 'none';
        });

        folderEl.appendChild(header);
        folderEl.appendChild(content);

        let hasVisibleDescendants = false;
        if (node.children) {
          node.children.forEach(child => {
            const childVisible = renderNode(child, content);
            if (childVisible) hasVisibleDescendants = true;
          });
        }

        if (q && !hasVisibleDescendants && !node.title.toLowerCase().includes(q)) {
          folderEl.style.display = 'none';
          return false;
        }

        parentEl.appendChild(folderEl);
        return true;
      } else {
        // Bookmark item
        const matches = !q || node.title.toLowerCase().includes(q) || (node.url && node.url.toLowerCase().includes(q));
        if (!matches) return false;

        const bEl = document.createElement('a');
        bEl.className = 'tree-bookmark';
        bEl.href = node.url;
        bEl.target = '_blank';
        bEl.rel = 'noreferrer';
        bEl.innerHTML = `
          <span style="color: var(--text-muted);">🔗</span>
          <span class="tree-bookmark-title">${escapeHtml(node.title || 'Untitled')}</span>
        `;
        parentEl.appendChild(bEl);
        return true;
      }
    }

    treeNodes.forEach(root => renderNode(root, treeContainer));
  }

  // Search input in Explorer
  searchBookmarks.addEventListener('input', (e) => {
    if (rawBookmarkTree) {
      renderExplorerTree(rawBookmarkTree, e.target.value);
    }
  });

  btnRefreshTree.addEventListener('click', async () => {
    await refreshBookmarkData();
    showToast('Tree refreshed', 'success');
  });

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initial Load
  await checkBackendStatus();
  await loadCurrentTab();
  await refreshBookmarkData();
  await checkPendingBackgroundState();
});
