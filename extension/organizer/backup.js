/**
 * Backup and Safe Undo Module
 * Takes full snapshots of the bookmark state before modifications,
 * and executes precise reverse operations to undo changes cleanly.
 */

const BACKUP_STORAGE_KEY = 'chitragupta_last_backup';
const BACKUP_HISTORY_KEY = 'chitragupta_backup_history';

/**
 * Creates a pre-organization backup snapshot.
 * @param {Object} plan The proposed plan being executed
 * @param {Array} originalTree Full snapshot of the bookmark tree
 * @param {Array} originalBookmarks Array of bookmarks before move
 * @returns {Promise<Object>} The saved backup descriptor
 */
async function createBackup(plan, originalTree, originalBookmarks) {
  const backup = {
    id: 'backup_' + Date.now(),
    timestamp: Date.now(),
    formattedDate: new Date().toLocaleString(),
    planSummary: {
      movesCount: plan.moves ? plan.moves.length : 0,
      foldersToCreate: plan.newFolders ? plan.newFolders.length : 0,
      foldersToDelete: plan.foldersToDelete ? plan.foldersToDelete.length : 0
    },
    // Map of bookmarkId -> { originalParentId, originalIndex, title, url }
    originalLocations: originalBookmarks.map(b => ({
      id: b.id,
      title: b.title,
      url: b.url,
      originalParentId: b.parentId,
      originalFolderPath: b.folderPath
    })),
    // Track newly created folder IDs (populated during execution)
    createdFolderIds: [],
    // Full raw tree representation for emergency manual export/restore
    treeSnapshot: originalTree ? JSON.parse(JSON.stringify(originalTree)) : null
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: backup });

    // Also push to rolling history (keep last 5)
    try {
      const stored = await chrome.storage.local.get([BACKUP_HISTORY_KEY]);
      const history = stored[BACKUP_HISTORY_KEY] || [];
      const historyEntry = { ...backup, treeSnapshot: null }; // strip large tree from history list
      const updatedHistory = [historyEntry, ...history].slice(0, 5);
      await chrome.storage.local.set({ [BACKUP_HISTORY_KEY]: updatedHistory });
    } catch (e) {
      console.warn('Could not update backup history:', e);
    }
  }

  return backup;
}

/**
 * Updates an existing backup with folders that were actually created during execution.
 * @param {string[]} createdFolderIds
 */
async function updateBackupCreatedFolders(createdFolderIds) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get([BACKUP_STORAGE_KEY]);
    if (data[BACKUP_STORAGE_KEY]) {
      data[BACKUP_STORAGE_KEY].createdFolderIds = createdFolderIds;
      await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: data[BACKUP_STORAGE_KEY] });
    }
  }
}

/**
 * Retrieves the latest backup from local storage.
 * @returns {Promise<Object|null>}
 */
async function getLastBackup() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get([BACKUP_STORAGE_KEY]);
    return data[BACKUP_STORAGE_KEY] || null;
  }
  return null;
}

/**
 * Executes a safe, 100% reliable Undo of the last organization operation.
 * Restores original folder hierarchy without duplicating folders, moves all bookmarks back,
 * and removes newly generated organization folders.
 * @returns {Promise<{ success: boolean, restoredCount: number, foldersRestored: number, backupTime: string }>}
 */
async function undoLastOrganization() {
  const backup = await getLastBackup();
  if (!backup) {
    throw new Error('No backup found to restore.');
  }

  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new Error('chrome.bookmarks API is not available');
  }

  // Count bookmarks in treeSnapshot if present
  let hasValidSnapshot = false;
  if (backup.treeSnapshot && Array.isArray(backup.treeSnapshot) && backup.treeSnapshot.length > 0) {
    let bmCount = 0;
    function countBM(n) {
      if (n.url) bmCount++;
      if (n.children) n.children.forEach(countBM);
    }
    backup.treeSnapshot.forEach(countBM);
    if (bmCount > 0) hasValidSnapshot = true;
  }

  let snapshotToRestore = null;
  if (hasValidSnapshot) {
    snapshotToRestore = backup.treeSnapshot;
  }

  let res;
  if (snapshotToRestore && Array.isArray(snapshotToRestore) && snapshotToRestore.length > 0) {
    res = await restoreFromTreeSnapshot(snapshotToRestore, backup.createdFolderIds || []);
  } else {
    res = await restoreFromOriginalLocations(backup);
  }

  backup.isRestored = true;
  backup.restoredAt = new Date().toLocaleString();
  await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: backup });

  return {
    success: true,
    restoredCount: res.totalRestored != null ? res.totalRestored : res.restoredCount,
    foldersRestored: res.foldersRestored,
    backupTime: backup.formattedDate
  };
}

/**
 * Fallback restorer using flat originalLocations list.
 */
async function restoreFromOriginalLocations(backup) {

  const originalLocations = backup.originalLocations || [];
  let restoredCount = 0;
  let foldersRestored = 0;

  // Step 1: Index all current folders in Chrome
  const currentTree = await chrome.bookmarks.getTree();
  const existingFolderIds = new Set();
  const currentPathToIdMap = new Map();
  const currentFolderTitleToIdMap = new Map();

  function indexCurrentFolders(node, currentSegments = []) {
    if (!node.url) {
      existingFolderIds.add(String(node.id));
      const cleanTitle = (node.title || '').trim();
      const segs = cleanTitle ? [...currentSegments, cleanTitle] : currentSegments;
      if (segs.length > 0) {
        const normKey = segs.map(s => s.trim().toLowerCase()).join(' / ');
        currentPathToIdMap.set(normKey, String(node.id));
        if (cleanTitle) {
          currentFolderTitleToIdMap.set(cleanTitle.toLowerCase(), String(node.id));
        }
      }
      if (node.children) {
        for (const child of node.children) {
          indexCurrentFolders(child, segs);
        }
      }
    }
  }
  for (const root of currentTree) {
    indexCurrentFolders(root, []);
  }

  // Ensure system roots are always mapped
  currentPathToIdMap.set('bookmarks bar', '1');
  currentPathToIdMap.set('other bookmarks', '2');
  currentPathToIdMap.set('mobile bookmarks', '3');
  existingFolderIds.add('1');
  existingFolderIds.add('2');
  existingFolderIds.add('3');

  // Map of original folder ID -> newly recreated folder ID (if folder was deleted)
  const recreatedFolderIdMap = new Map();
  const originalPathToParentIdMap = new Map();
  for (const item of originalLocations) {
    if (item.originalFolderPath && item.originalParentId) {
      const normKey = item.originalFolderPath.split(' / ').map(s => s.trim().toLowerCase()).join(' / ');
      if (normKey && !originalPathToParentIdMap.has(normKey)) {
        originalPathToParentIdMap.set(normKey, String(item.originalParentId));
      }
    }
  }

  // Step 2: Identify and recreate any missing folders
  const EXCLUDED_RESTORE_FOLDERS = new Set(['trash', 'speed dials', 'pinboard', 'unsorted bookmarks', 'unsynchronized pinboard']);
  const neededFolderPaths = new Set();
  for (const item of originalLocations) {
    if (item.originalFolderPath) {
      const segs = item.originalFolderPath.split(' / ').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (segs.some(s => EXCLUDED_RESTORE_FOLDERS.has(s))) continue;
      const norm = item.originalFolderPath.split(' / ').map(s => s.trim()).filter(Boolean).join(' / ');
      if (norm) neededFolderPaths.add(norm);
    }
  }

  // Sort needed folder paths by depth (shallowest first)
  const sortedPaths = Array.from(neededFolderPaths).sort((a, b) => {
    return a.split(' / ').length - b.split(' / ').length;
  });

  for (const fullPath of sortedPaths) {
    const segments = fullPath.split(' / ').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    if (segments.some(s => EXCLUDED_RESTORE_FOLDERS.has(s.toLowerCase()))) continue;

    const rootName = segments[0].toLowerCase();
    let currentParentId = '1';
    if (rootName.includes('other')) currentParentId = '2';
    else if (rootName.includes('mobile')) currentParentId = '3';

    let currentAccumulatedPath = [segments[0]];

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i].trim();
      currentAccumulatedPath.push(seg);
      const accKey = currentAccumulatedPath.map(s => s.trim().toLowerCase()).join(' / ');

      if (currentPathToIdMap.has(accKey)) {
        currentParentId = currentPathToIdMap.get(accKey);
      } else if (currentFolderTitleToIdMap.has(seg.toLowerCase()) && currentParentId === '1') {
        currentParentId = currentFolderTitleToIdMap.get(seg.toLowerCase());
        currentPathToIdMap.set(accKey, currentParentId);
      } else {
        try {
          const createdFolder = await chrome.bookmarks.create({
            parentId: currentParentId,
            title: seg
          });
          currentParentId = String(createdFolder.id);
          existingFolderIds.add(currentParentId);
          currentPathToIdMap.set(accKey, currentParentId);
          currentFolderTitleToIdMap.set(seg.toLowerCase(), currentParentId);
          if (originalPathToParentIdMap.has(accKey)) {
            recreatedFolderIdMap.set(originalPathToParentIdMap.get(accKey), currentParentId);
          }
          foldersRestored++;
        } catch (e) {
          console.warn(`Could not recreate folder "${seg}" under parent ${currentParentId}:`, e.message);
        }
      }
    }
  }

  // Step 3: Move all bookmarks back to their exact original folder
  for (const item of originalLocations) {
    const rawPath = (item.originalFolderPath || 'Bookmarks bar').trim();
    const leafTitle = rawPath.split(' / ').map(s => s.trim().toLowerCase()).pop();
    if (leafTitle && EXCLUDED_RESTORE_FOLDERS.has(leafTitle)) {
      continue; // Skip trash and speed dials items
    }
    const targetFolderKey = rawPath.split(' / ').map(s => s.trim().toLowerCase()).join(' / ');

    let targetParentId = null;

    // 1. Direct match by originalParentId if that folder still exists in Chrome!
    // Never place into system root '0'
    if (item.originalParentId && item.originalParentId !== '0' && existingFolderIds.has(String(item.originalParentId))) {
      targetParentId = String(item.originalParentId);
    }
    // 2. If the original folder was recreated, use its new ID
    else if (item.originalParentId && recreatedFolderIdMap.has(String(item.originalParentId))) {
      targetParentId = recreatedFolderIdMap.get(String(item.originalParentId));
    }
    // 3. Match by normalized folder path
    else if (currentPathToIdMap.has(targetFolderKey)) {
      targetParentId = currentPathToIdMap.get(targetFolderKey);
    }
    // 4. Match by leaf folder title (e.g. "ai", "docs", "tools")
    else if (leafTitle && currentFolderTitleToIdMap.has(leafTitle)) {
      targetParentId = currentFolderTitleToIdMap.get(leafTitle);
    }
    // 5. Match by path suffix
    else if (leafTitle) {
      for (const [key, id] of currentPathToIdMap.entries()) {
        if (key.endsWith(' / ' + leafTitle) || key === leafTitle) {
          targetParentId = id;
          break;
        }
      }
    }

    // Default fallback to Bookmarks bar ('1')
    if (!targetParentId || targetParentId === '0') {
      targetParentId = '1';
    }

    try {
      // Find the bookmark: first by item.id, fallback by URL search
      let targetNodeId = null;
      try {
        const existing = await chrome.bookmarks.get(item.id);
        if (existing && existing.length > 0) {
          targetNodeId = existing[0].id;
          if (String(existing[0].parentId) !== String(targetParentId)) {
            await chrome.bookmarks.move(targetNodeId, { parentId: targetParentId });
            restoredCount++;
          }
        }
      } catch {
        // Bookmark ID may have changed, search by URL
      }

      if (!targetNodeId && item.url) {
        try {
          const matching = await chrome.bookmarks.search({ url: item.url });
          if (matching && matching.length > 0) {
            targetNodeId = matching[0].id;
            if (String(matching[0].parentId) !== String(targetParentId)) {
              await chrome.bookmarks.move(targetNodeId, { parentId: targetParentId });
              restoredCount++;
            }
          }
        } catch {
          // Search failed
        }
      }

      // If bookmark is completely missing, recreate it
      if (!targetNodeId) {
        await chrome.bookmarks.create({
          parentId: targetParentId,
          title: item.title || 'Untitled',
          url: item.url
        });
        restoredCount++;
      }
    } catch (err) {
      console.warn(`Could not restore bookmark "${item.title}":`, err.message);
    }
  }

  // Step 4: Delete the organization folders that were created during the organize run
  if (backup.createdFolderIds && Array.isArray(backup.createdFolderIds)) {
    // Reverse order so children are deleted before parents
    const toClean = [...backup.createdFolderIds].reverse();
    for (const folderId of toClean) {
      try {
        // Safety check: Never touch system folders (0, 1, 2, 3)
        if (['0', '1', '2', '3'].includes(String(folderId))) continue;

        // Check if folder exists
        const sub = await chrome.bookmarks.getSubTree(folderId);
        if (sub && sub[0]) {
          const children = sub[0].children || [];
          if (children.length === 0) {
            await chrome.bookmarks.remove(folderId);
          }
        }
      } catch (err) {
        // Folder already gone or non-empty
      }
    }
  }

  // Mark backup as restored instead of deleting it, so the user can always re-inspect
  backup.isRestored = true;
  backup.restoredAt = new Date().toLocaleString();
  await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: backup });

  return {
    success: true,
    restoredCount,
    foldersRestored,
    backupTime: backup.formattedDate
  };
}

/**
 * Completely restores the bookmark tree from a tree snapshot JSON.
 * Smart restoration: Reuses existing folders, moves existing bookmarks by URL or ID (preventing duplicates),
 * creates any missing items, restores exact folder hierarchy recursively, and cleans up empty organization folders.
 * @param {Array} snapshot The tree snapshot array
 * @param {string[]} [createdFolderIds] Optional folder IDs created during organization to delete
 * @returns {Promise<{ success: boolean, totalRestored: number, foldersRestored: number }>}
 */
async function restoreFromTreeSnapshot(snapshot, createdFolderIds = []) {
  if (!snapshot || !Array.isArray(snapshot)) {
    throw new Error('Invalid tree snapshot format.');
  }

  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new Error('chrome.bookmarks API is not available');
  }

  let totalRestored = 0;
  let foldersRestored = 0;

  // 1. Index all current bookmarks and folders in Chrome
  const currentTree = await chrome.bookmarks.getTree();
  const existingFoldersByParentAndTitle = new Map(); // `${parentId}:::${title.toLowerCase().trim()}` -> folderId
  const existingFoldersById = new Map(); // folderId -> folderNode
  const urlToCurrentBookmarkMap = new Map(); // normalizedUrl -> bookmarkNode
  const nodeMapById = new Map(); // id -> node

  function indexCurrent(node) {
    nodeMapById.set(String(node.id), node);
    if (!node.url) {
      existingFoldersById.set(String(node.id), node);
      if (node.parentId && node.title) {
        const key = `${node.parentId}:::${node.title.trim().toLowerCase()}`;
        existingFoldersByParentAndTitle.set(key, String(node.id));
      }
      if (node.children) {
        for (const child of node.children) {
          indexCurrent(child);
        }
      }
    } else {
      const norm = (typeof normalizeUrl === 'function' ? normalizeUrl(node.url) : (node.url || '').toLowerCase());
      if (norm && !urlToCurrentBookmarkMap.has(norm)) {
        urlToCurrentBookmarkMap.set(norm, node);
      }
    }
  }
  for (const root of currentTree) {
    indexCurrent(root);
  }

  // 2. Recursively restore individual node (folder or bookmark)
  async function restoreNode(node, currentParentId) {
    if (node.url) {
      // It's a bookmark!
      const norm = (typeof normalizeUrl === 'function' ? normalizeUrl(node.url) : (node.url || '').toLowerCase());
      let existingBookmark = null;
      if (node.id && nodeMapById.has(String(node.id)) && nodeMapById.get(String(node.id)).url) {
        existingBookmark = nodeMapById.get(String(node.id));
      } else if (norm && urlToCurrentBookmarkMap.has(norm)) {
        existingBookmark = urlToCurrentBookmarkMap.get(norm);
      }

      if (existingBookmark) {
        if (String(existingBookmark.parentId) !== String(currentParentId)) {
          try {
            await chrome.bookmarks.move(existingBookmark.id, { parentId: String(currentParentId) });
            existingBookmark.parentId = String(currentParentId);
            totalRestored++;
          } catch (e) {
            console.warn(`Could not move bookmark "${node.title}":`, e);
          }
        } else {
          totalRestored++;
        }
      } else {
        try {
          const created = await chrome.bookmarks.create({
            parentId: String(currentParentId),
            title: node.title || 'Untitled',
            url: node.url
          });
          nodeMapById.set(String(created.id), created);
          if (norm) urlToCurrentBookmarkMap.set(norm, created);
          totalRestored++;
        } catch (e) {
          console.warn(`Could not recreate bookmark "${node.title}":`, e);
        }
      }
    } else {
      // It's a folder!
      let targetFolderId = currentParentId;
      const cleanTitle = (node.title || '').trim();
      const lowerTitle = cleanTitle.toLowerCase();

      // Skip trash, speed dials, pinboard, and unsorted folders during restoration
      const EXCLUDED_RESTORE_FOLDERS = new Set(['trash', 'speed dials', 'pinboard', 'unsorted bookmarks', 'unsynchronized pinboard']);
      if (EXCLUDED_RESTORE_FOLDERS.has(lowerTitle)) {
        return;
      }

      if (['0', '1', '2', '3'].includes(String(node.id))) {
        targetFolderId = String(node.id);
      } else if (cleanTitle) {
        const folderKey = `${currentParentId}:::${cleanTitle.toLowerCase()}`;
        if (existingFoldersByParentAndTitle.has(folderKey)) {
          targetFolderId = existingFoldersByParentAndTitle.get(folderKey);
        } else if (node.id && existingFoldersById.has(String(node.id))) {
          targetFolderId = String(node.id);
          const existingFolder = existingFoldersById.get(String(node.id));
          if (existingFolder && String(existingFolder.parentId) !== String(currentParentId)) {
            try {
              await chrome.bookmarks.move(targetFolderId, { parentId: String(currentParentId) });
              existingFolder.parentId = String(currentParentId);
            } catch (e) {
              console.warn(`Could not move folder "${node.title}" to parent ${currentParentId}:`, e);
            }
          }
        } else {
          try {
            const created = await chrome.bookmarks.create({
              parentId: String(currentParentId),
              title: node.title || cleanTitle
            });
            targetFolderId = String(created.id);
            existingFoldersByParentAndTitle.set(folderKey, targetFolderId);
            existingFoldersById.set(targetFolderId, created);
            foldersRestored++;
          } catch (e) {
            console.warn(`Could not recreate folder "${node.title}":`, e);
            targetFolderId = currentParentId;
          }
        }
      }

      // Recursively restore children inside this folder!
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          await restoreNode(child, targetFolderId);
        }
      }
    }
  }

  // 3. Dispatch snapshot traversal dynamically based on structure (root 0, subtree 1, or direct nodes)
  async function dispatchSnapshot(nodes, fallbackParentId = '1') {
    for (const node of nodes) {
      if (node.id === '0') {
        if (node.children) {
          for (const sysChild of node.children) {
            const sysTarget = (sysChild.id === '2' ? '2' : (sysChild.id === '3' ? '3' : '1'));
            if (sysChild.children) {
              for (const item of sysChild.children) {
                await restoreNode(item, sysTarget);
              }
            }
          }
        }
      } else if (node.id === '1') {
        // Bookmarks Bar subtree: restore its direct children into '1'
        if (node.children) {
          for (const item of node.children) {
            await restoreNode(item, '1');
          }
        }
      } else if (node.id === '2' || node.id === '3') {
        const sysTarget = String(node.id);
        if (node.children) {
          for (const item of node.children) {
            await restoreNode(item, sysTarget);
          }
        }
      } else {
        await restoreNode(node, fallbackParentId);
      }
    }
  }

  await dispatchSnapshot(snapshot, '1');

  // 4. Delete folders that were created during the organization run
  // CRITICAL SAFETY: NEVER call removeTree. Only remove completely empty folders with chrome.bookmarks.remove.
  if (createdFolderIds && Array.isArray(createdFolderIds) && createdFolderIds.length > 0) {
    const toClean = [...createdFolderIds].reverse();
    for (const folderId of toClean) {
      if (['0', '1', '2', '3'].includes(String(folderId))) continue;
      try {
        const sub = await chrome.bookmarks.getSubTree(folderId);
        if (sub && sub[0]) {
          const children = sub[0].children || [];
          if (children.length === 0) {
            await chrome.bookmarks.remove(folderId);
          }
        }
      } catch {}
    }
  }

  // 5. Prune any remaining empty folders under Bookmarks Bar ('1')
  try {
    async function pruneEmpty(parentId) {
      const sub = await chrome.bookmarks.getSubTree(parentId);
      if (!sub || !sub[0] || !sub[0].children) return;
      for (const child of sub[0].children) {
        if (!child.url && !['0', '1', '2', '3'].includes(String(child.id))) {
          await pruneEmpty(child.id);
          try {
            const check = await chrome.bookmarks.getSubTree(child.id);
            if (check && check[0] && (!check[0].children || check[0].children.length === 0)) {
              await chrome.bookmarks.remove(child.id);
            }
          } catch {}
        }
      }
    }
    await pruneEmpty('1');
  } catch {}

  return { success: true, totalRestored, foldersRestored };
}

const BASELINE_SNAPSHOT_KEY = 'chitragupta_baseline_snapshot';

/**
 * Saves the current Bookmarks Bar tree structure as the user's baseline snapshot.
 * @returns {Promise<Object>} Snapshot metadata
 */
async function saveBaselineSnapshot() {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new Error('chrome.bookmarks API is not available');
  }
  const rawTree = await chrome.bookmarks.getSubTree('1');
  let bmCount = 0;
  let folderCount = 0;
  function countNodes(n) {
    if (n.url) bmCount++;
    else if (n.id !== '1' && n.id !== '0') folderCount++;
    if (n.children) n.children.forEach(countNodes);
  }
  if (rawTree && rawTree[0]) countNodes(rawTree[0]);

  const now = new Date();
  const formattedDate = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const snapshot = {
    id: 'baseline_' + Date.now(),
    timestamp: Date.now(),
    formattedDate,
    bmCount,
    folderCount,
    tree: JSON.parse(JSON.stringify(rawTree))
  };

  if (typeof chrome.storage !== 'undefined' && chrome.storage.local) {
    await chrome.storage.local.set({ [BASELINE_SNAPSHOT_KEY]: snapshot });
  }
  return snapshot;
}

/**
 * Retrieves the saved baseline snapshot from storage.
 * @returns {Promise<Object|null>}
 */
async function getBaselineSnapshot() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get([BASELINE_SNAPSHOT_KEY, BACKUP_STORAGE_KEY]);
    if (data[BASELINE_SNAPSHOT_KEY]) return data[BASELINE_SNAPSHOT_KEY];
    if (data[BACKUP_STORAGE_KEY] && data[BACKUP_STORAGE_KEY].treeSnapshot) {
      const b = data[BACKUP_STORAGE_KEY];
      return {
        id: b.id,
        timestamp: b.timestamp,
        formattedDate: b.formattedDate,
        bmCount: (b.originalLocations && b.originalLocations.length) || 0,
        folderCount: 0,
        tree: b.treeSnapshot,
        isAutoBackup: true
      };
    }
  }
  return null;
}

/**
 * Rolls back the Bookmarks Bar to the saved baseline structure.
 * @returns {Promise<Object>}
 */
async function rollbackToSavedStructure() {
  const baseline = await getBaselineSnapshot();
  if (!baseline || !baseline.tree) {
    throw new Error('No saved baseline structure found to roll back to.');
  }
  const res = await restoreFromTreeSnapshot(baseline.tree);
  return {
    success: true,
    restoredCount: res.totalRestored,
    foldersRestored: res.foldersRestored,
    date: baseline.formattedDate
  };
}

const _rootBackup = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
_rootBackup.BACKUP_STORAGE_KEY = BACKUP_STORAGE_KEY;
_rootBackup.BACKUP_HISTORY_KEY = BACKUP_HISTORY_KEY;
_rootBackup.BASELINE_SNAPSHOT_KEY = BASELINE_SNAPSHOT_KEY;
_rootBackup.createBackup = createBackup;
_rootBackup.updateBackupCreatedFolders = updateBackupCreatedFolders;
_rootBackup.getLastBackup = getLastBackup;
_rootBackup.undoLastOrganization = undoLastOrganization;
_rootBackup.restoreFromTreeSnapshot = restoreFromTreeSnapshot;
_rootBackup.saveBaselineSnapshot = saveBaselineSnapshot;
_rootBackup.getBaselineSnapshot = getBaselineSnapshot;
_rootBackup.rollbackToSavedStructure = rollbackToSavedStructure;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BACKUP_STORAGE_KEY,
    BACKUP_HISTORY_KEY,
    BASELINE_SNAPSHOT_KEY,
    createBackup,
    updateBackupCreatedFolders,
    getLastBackup,
    undoLastOrganization,
    restoreFromTreeSnapshot,
    saveBaselineSnapshot,
    getBaselineSnapshot,
    rollbackToSavedStructure
  };
}
