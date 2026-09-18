/**
 * Background Service Worker for Chitragupta
 * Manages context menus, keyboard shortcuts, background bookmark additions,
 * and background bookmark arrangement with desktop system notifications.
 */

// Import organizer modules for background execution
importScripts(
  '../api/client.js',
  '../organizer/bookmark-reader.js',
  '../organizer/classifier.js',
  '../organizer/backup.js',
  '../organizer/organizer.js'
);

let isAnalyzing = false;
let isApplying = false;
let currentAnalysisAbortController = null;
let isApplyCancelled = false;

// Helper to find or create the default AI Bookmarks folder
async function getOrCreateDefaultFolder(folderName = 'AI Bookmarks') {
  const tree = await chrome.bookmarks.getTree();
  const bookmarksBar = tree[0]?.children?.find(c => c.id === '1') || tree[0]?.children?.[0];
  const targetParentId = bookmarksBar ? bookmarksBar.id : '1';

  const existing = bookmarksBar?.children?.find(c => !c.url && c.title === folderName);
  if (existing) {
    return existing.id;
  }

  const created = await chrome.bookmarks.create({
    parentId: targetParentId,
    title: folderName
  });
  return created.id;
}

// Set up Context Menus on Install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'chitragupta_save_page',
    title: 'Bookmark page with Chitragupta',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'chitragupta_save_link',
    title: 'Bookmark link with Chitragupta',
    contexts: ['link']
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const defaultFolderId = await getOrCreateDefaultFolder();

    if (info.menuItemId === 'chitragupta_save_page' && tab) {
      await chrome.bookmarks.create({
        parentId: defaultFolderId,
        title: tab.title || 'Saved Page',
        url: tab.url
      });
      flashBadge('Saved', '#10B981');
    } else if (info.menuItemId === 'chitragupta_save_link' && info.linkUrl) {
      const linkTitle = info.selectionText || info.linkUrl;
      await chrome.bookmarks.create({
        parentId: defaultFolderId,
        title: linkTitle,
        url: info.linkUrl
      });
      flashBadge('Saved', '#10B981');
    }
  } catch (err) {
    console.error('Error saving bookmark from context menu:', err);
    flashBadge('Err', '#EF4444');
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'quick_save_bookmark') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      try {
        const defaultFolderId = await getOrCreateDefaultFolder();
        await chrome.bookmarks.create({
          parentId: defaultFolderId,
          title: tab.title || 'Saved Bookmark',
          url: tab.url
        });
        flashBadge('Saved', '#10B981');
      } catch (err) {
        console.error('Error in quick save shortcut:', err);
        flashBadge('Err', '#EF4444');
      }
    }
  }
});

// Temporary visual badge confirmation
function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3500);
}

// Background Analysis Execution
async function performBackgroundAnalysis(scopeId = '1', cleanEmpty = true) {
  if (isAnalyzing) {
    return { success: false, error: 'Analysis already in progress' };
  }
  isAnalyzing = true;
  currentAnalysisAbortController = new AbortController();
  const abortSignal = currentAnalysisAbortController.signal;

  try {
    await chrome.storage.local.set({
      chitragupta_analysis_state: {
        status: 'running',
        percent: 15,
        statusMsg: 'Reading Bookmarks Bar...'
      }
    });
    chrome.runtime.sendMessage({ action: 'ANALYSIS_PROGRESS', percent: 15, statusMsg: 'Reading Bookmarks Bar...' }).catch(() => {});

    if (abortSignal.aborted) throw new Error('Arranging was cancelled by user.');

    const targetScopeId = (!scopeId || scopeId === '0') ? '1' : scopeId;
    const rawScopeTree = await chrome.bookmarks.getSubTree(targetScopeId);
    const scopeData = parseBookmarkTree(rawScopeTree);

    if (!scopeData.bookmarks || scopeData.bookmarks.length === 0) {
      throw new Error('No bookmarks found in the selected Bookmarks Bar scope.');
    }

    if (abortSignal.aborted) throw new Error('Arranging was cancelled by user.');

    const totalCount = scopeData.bookmarks.length;

    await chrome.storage.local.set({
      chitragupta_analysis_state: {
        status: 'running',
        percent: 10,
        statusMsg: `Read ${totalCount} bookmarks. Starting classification (0/${totalCount} done, ${totalCount} left)...`,
        doneCount: 0,
        totalCount,
        remainingCount: totalCount
      }
    });
    chrome.runtime.sendMessage({
      action: 'ANALYSIS_PROGRESS',
      percent: 10,
      statusMsg: `Read ${totalCount} bookmarks. Starting classification (0/${totalCount} done, ${totalCount} left)...`,
      doneCount: 0,
      totalCount,
      remainingCount: totalCount
    }).catch(() => {});

    // Classify using hybrid rules + AI with real-time fine-grained progress callback and abort signal
    const classified = await classifyBookmarks(scopeData.bookmarks, {
      onProgress: (done, total) => {
        if (abortSignal.aborted) return;
        const remaining = Math.max(0, total - done);
        // Map classified items directly to 10% -> 85% progress bar fill
        const pct = Math.round(10 + (done / total) * 75);
        const statusMsg = `Classifying bookmarks (${done}/${total} done, ${remaining} left)...`;

        chrome.storage.local.set({
          chitragupta_analysis_state: {
            status: 'running',
            percent: pct,
            statusMsg,
            doneCount: done,
            totalCount: total,
            remainingCount: remaining
          }
        }).catch(() => {});

        chrome.runtime.sendMessage({
          action: 'ANALYSIS_PROGRESS',
          percent: pct,
          statusMsg,
          doneCount: done,
          totalCount: total,
          remainingCount: remaining
        }).catch(() => {});
      },
      aiClient: async (ambiguous, onChunk) => {
        try {
          return await apiClient.classifyBatch(ambiguous, onChunk, abortSignal);
        } catch (e) {
          console.warn('AI classification fallback in service worker:', e);
          return null;
        }
      }
    });

    if (abortSignal.aborted) throw new Error('Arranging was cancelled by user.');

    await chrome.storage.local.set({
      chitragupta_analysis_state: {
        status: 'running',
        percent: 90,
        statusMsg: 'Generating folder hierarchy plan...',
        doneCount: totalCount,
        totalCount,
        remainingCount: 0
      }
    });
    chrome.runtime.sendMessage({
      action: 'ANALYSIS_PROGRESS',
      percent: 90,
      statusMsg: 'Generating folder hierarchy plan...',
      doneCount: totalCount,
      totalCount,
      remainingCount: 0
    }).catch(() => {});

    // Read user settings
    const stored = await chrome.storage.local.get(['chitragupta_user_settings']);
    const userSettings = stored.chitragupta_user_settings || {};

    const plan = generateOrganizationPlan(classified, scopeData.folders, {
      targetParentId: '1',
      maxDepth: parseInt(userSettings.maxDepth, 10) || 2,
      minBookmarksPerFolder: parseInt(userSettings.minBookmarks, 10) || 2,
      mergeSingleItemSubfolders: userSettings.mergeSingleItemSubfolders !== false,
      cleanEmptyFolders: cleanEmpty !== false
    });

    if (abortSignal.aborted) throw new Error('Arranging was cancelled by user.');

    const now = new Date();
    const formattedTime = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const planData = {
      plan,
      rawTree: rawScopeTree,
      originalBookmarks: scopeData.bookmarks,
      createdAt: Date.now(),
      formattedTime
    };

    await chrome.storage.local.set({
      chitragupta_pending_plan: planData,
      chitragupta_analysis_state: {
        status: 'ready',
        completedAt: Date.now()
      }
    });

    // Badge indicator on icon
    chrome.action.setBadgeText({ text: 'PLAN' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

    // Notify any active popup
    chrome.runtime.sendMessage({ action: 'ANALYSIS_COMPLETE', planData }).catch(() => {});

    // Show desktop system notification
    const movesCount = plan.moves ? plan.moves.length : 0;
    const foldersCount = plan.newFolders ? plan.newFolders.length : 0;
    const totalChanges = movesCount + foldersCount + (plan.foldersToDelete ? plan.foldersToDelete.length : 0);

    const notifMsg = totalChanges > 0
      ? `Arranging done: ${movesCount} moves across ${foldersCount} categories proposed. Click to review & apply!`
      : 'Arranging done: All bookmarks in Bookmarks Bar are already organized!';

    chrome.notifications.create('chitragupta_arranging_done_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Chitragupta — Bookmarks Arranged!',
      message: notifMsg,
      priority: 2,
      requireInteraction: true
    });

    return { success: true, planData };
  } catch (err) {
    if (abortSignal && abortSignal.aborted) {
      console.log('Background analysis cancelled cleanly by user.');
      await chrome.storage.local.remove(['chitragupta_analysis_state']);
      chrome.runtime.sendMessage({ action: 'ANALYSIS_CANCELLED' }).catch(() => {});
      return { success: false, cancelled: true };
    }

    console.error('Background analysis error:', err);
    await chrome.storage.local.set({
      chitragupta_analysis_state: {
        status: 'error',
        error: err.message
      }
    });
    chrome.runtime.sendMessage({ action: 'ANALYSIS_ERROR', error: err.message }).catch(() => {});

    chrome.notifications.create('chitragupta_error_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Chitragupta — Arranging Issue',
      message: err.message || 'Could not arrange bookmarks.',
      priority: 1
    });

    return { success: false, error: err.message };
  } finally {
    isAnalyzing = false;
    currentAnalysisAbortController = null;
  }
}

// Background Organization Plan Apply Execution
async function performBackgroundApply() {
  if (isApplying) {
    return { success: false, error: 'Apply already in progress' };
  }
  isApplying = true;
  isApplyCancelled = false;

  try {
    const stored = await chrome.storage.local.get(['chitragupta_pending_plan']);
    const planData = stored.chitragupta_pending_plan;
    if (!planData || !planData.plan) {
      throw new Error('No pending plan found to apply.');
    }

    await chrome.storage.local.set({
      chitragupta_apply_state: {
        status: 'running',
        percent: 20,
        statusMsg: 'Starting organization...'
      }
    });
    chrome.runtime.sendMessage({ action: 'APPLY_PROGRESS', percent: 20, statusMsg: 'Starting organization...' }).catch(() => {});

    const result = await executeOrganizationPlan(
      planData.plan,
      planData.rawTree,
      planData.originalBookmarks,
      (percent, statusMsg, extra = {}) => {
        chrome.storage.local.set({
          chitragupta_apply_state: {
            status: 'running',
            percent,
            statusMsg,
            doneCount: extra.doneCount,
            totalCount: extra.totalCount
          }
        });
        chrome.runtime.sendMessage({
          action: 'APPLY_PROGRESS',
          percent,
          statusMsg,
          doneCount: extra.doneCount,
          totalCount: extra.totalCount
        }).catch(() => {});
      },
      () => isApplyCancelled
    );

    // Clear pending plan and states
    await chrome.storage.local.remove([
      'chitragupta_pending_plan',
      'chitragupta_analysis_state',
      'chitragupta_apply_state'
    ]);

    if (result.cancelled) {
      flashBadge('STOP', '#EF4444');
      chrome.runtime.sendMessage({ action: 'APPLY_CANCELLED', result }).catch(() => {});
      return { success: false, cancelled: true, result };
    }

    // Flash success badge
    flashBadge('DONE', '#10b981');

    // Notify any active popup
    chrome.runtime.sendMessage({ action: 'APPLY_COMPLETE', result }).catch(() => {});

    // Show desktop system notification
    chrome.notifications.create('chitragupta_applied_done_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Chitragupta — Organization Applied!',
      message: `Successfully organized ${result.movesCompleted} bookmarks in Bookmarks Bar.`,
      priority: 1
    });

    return { success: true, result };
  } catch (err) {
    console.error('Background apply error:', err);
    await chrome.storage.local.set({
      chitragupta_apply_state: {
        status: 'error',
        error: err.message
      }
    });
    chrome.runtime.sendMessage({ action: 'APPLY_ERROR', error: err.message }).catch(() => {});
    return { success: false, error: err.message };
  } finally {
    isApplying = false;
  }
}

// Notification Click Handler: Open extension popup or bring browser to front
chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);

  // In Chrome 127+, chrome.action.openPopup() can open the extension popup directly!
  if (chrome.action && typeof chrome.action.openPopup === 'function') {
    try {
      await chrome.action.openPopup();
      return;
    } catch (e) {
      console.log('openPopup notice:', e.message);
    }
  }

  // Fallback: bring browser window to front
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (windows && windows.length > 0) {
      await chrome.windows.update(windows[0].id, { focused: true });
    }
  } catch {}
});

// Runtime Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_ANALYSIS') {
    performBackgroundAnalysis(message.scopeId, message.cleanEmpty)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'APPLY_PLAN') {
    performBackgroundApply()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'STOP_ARRANGING' || message.action === 'CANCEL_ANALYSIS' || message.action === 'CANCEL_APPLY') {
    let wasCancelled = false;
    if (isAnalyzing) {
      if (currentAnalysisAbortController) {
        currentAnalysisAbortController.abort();
      }
      isAnalyzing = false;
      wasCancelled = true;
    }
    if (isApplying) {
      isApplyCancelled = true;
      wasCancelled = true;
    }

    chrome.storage.local.remove([
      'chitragupta_analysis_state',
      'chitragupta_apply_state',
      'chitragupta_pending_plan'
    ]).then(() => {
      chrome.action.setBadgeText({ text: '' });
      chrome.runtime.sendMessage({ action: 'ARRANGING_CANCELLED' }).catch(() => {});
      sendResponse({ success: true, cancelled: wasCancelled });
    });
    return true;
  }

  if (message.action === 'CANCEL_PLAN') {
    chrome.storage.local.remove([
      'chitragupta_pending_plan',
      'chitragupta_analysis_state',
      'chitragupta_apply_state'
    ]).then(() => {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
    });
    return true;
  }
});
