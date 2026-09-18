/**
 * Bookmark Organizer Engine
 * Generates proposed plans, manages constraints (depth, folder reuse, non-deletion of bookmarks),
 * and executes migrations safely.
 */

// Resolve dependencies safely in both browser and Node.js environments
let _SYSTEM_FOLDER_IDS = typeof SYSTEM_FOLDER_IDS !== 'undefined' ? SYSTEM_FOLDER_IDS : new Set(['0', '1', '2', '3']);
let _createBackup = typeof createBackup !== 'undefined' ? createBackup : null;
let _updateBackupCreatedFolders = typeof updateBackupCreatedFolders !== 'undefined' ? updateBackupCreatedFolders : null;

if (typeof require !== 'undefined') {
  try {
    const reader = require('./bookmark-reader.js');
    const backup = require('./backup.js');
    _SYSTEM_FOLDER_IDS = reader.SYSTEM_FOLDER_IDS;
    _createBackup = backup.createBackup;
    _updateBackupCreatedFolders = backup.updateBackupCreatedFolders;
  } catch (e) {
    // Already in browser or handled
  }
}

/**
 * Generates a proposed organization plan based on classified bookmarks.
 * @param {Array} classifiedBookmarks Bookmarks with .classification attached
 * @param {Array} existingFolders List of currently existing folders
 * @param {Object} options Configuration options
 * @returns {Object} Proposed plan: { newFolders, moves, foldersToDelete, stats }
 */
function generateOrganizationPlan(classifiedBookmarks, existingFolders, options = {}) {
  const targetParentId = options.targetParentId || '1'; // Default: Bookmarks Bar ('1')
  const maxDepth = options.maxDepth || 2; // 2: Category/Subcategory, 3: Cat/Sub/Tag
  const cleanEmptyFolders = options.cleanEmptyFolders !== false;
  const minBookmarksPerFolder = options.minBookmarksPerFolder || 1;
  const mergeSingleItemSubfolders = options.mergeSingleItemSubfolders !== false; // Default true: merge single-site subfolders

  // Build index of existing folders by path and title under target parent
  const existingFolderByTitle = new Map();
  for (const f of existingFolders) {
    if (f.parentId === targetParentId) {
      existingFolderByTitle.set(f.title.toLowerCase().trim(), f);
    }
  }

  // Group bookmarks by proposed folder path
  // Category -> Subcategory
  const groups = new Map(); // pathKey -> { pathSegments, bookmarks: [] }

  for (const b of classifiedBookmarks) {
    const cls = b.classification || { category: 'Other', subcategory: 'General' };
    let category = (cls.category || 'Other').trim();
    let subcategory = (cls.subcategory || 'General').trim();

    // Prevent flat "General" dumping: elevate specific subcategory to category if needed
    if (category.toLowerCase() === 'general' && subcategory && !['general', 'bookmarks'].includes(subcategory.toLowerCase())) {
      category = subcategory;
      subcategory = 'General';
    }

    let pathSegments = [];
    if (maxDepth === 1 || subcategory === 'General' || category === subcategory) {
      pathSegments = [category];
    } else {
      pathSegments = [category, subcategory];
    }

    const pathKey = pathSegments.join(' / ');
    if (!groups.has(pathKey)) {
      groups.set(pathKey, { pathSegments, bookmarks: [] });
    }
    groups.get(pathKey).bookmarks.push(b);
  }

  // If mergeSingleItemSubfolders is enabled or minBookmarksPerFolder > 1:
  // Merge subfolders that have only 1 bookmark (or fewer than threshold) directly into their parent folder!
  const threshold = mergeSingleItemSubfolders ? Math.max(2, minBookmarksPerFolder) : minBookmarksPerFolder;
  if (threshold > 1) {
    for (const [pathKey, group] of Array.from(groups.entries())) {
      if (group.bookmarks.length < threshold && group.pathSegments.length > 1) {
        // Drop the leaf subfolder to merge directly into parent category
        const parentSegments = group.pathSegments.slice(0, -1);
        const parentKey = parentSegments.join(' / ');
        if (!groups.has(parentKey)) {
          groups.set(parentKey, { pathSegments: parentSegments, bookmarks: [] });
        }
        groups.get(parentKey).bookmarks.push(...group.bookmarks);
        groups.delete(pathKey);
      }
    }
  }

  // Calculate new folders to create and moves
  const newFolderPaths = new Set();
  const plannedMoves = [];
  const movingBookmarkIds = new Set();

  for (const [pathKey, group] of groups.entries()) {
    // Check if folder hierarchy already exists
    let currParentId = targetParentId;
    let accumulatedPath = [];

    for (let i = 0; i < group.pathSegments.length; i++) {
      const seg = group.pathSegments[i];
      accumulatedPath.push(seg);
      const accKey = accumulatedPath.join(' / ');

      // Find matching existing folder
      const existing = existingFolders.find(f =>
        f.title.toLowerCase().trim() === seg.toLowerCase().trim() &&
        (i === 0 ? f.parentId === targetParentId : true)
      );

      if (!existing) {
        newFolderPaths.add(accKey);
      }
    }

    // Determine moves
    for (const b of group.bookmarks) {
      // Current folder path of the bookmark relative to Bookmarks bar
      const currentRelPath = (b.folderPath || '')
        .replace(/^Bookmarks bar\s*(\/\s*)?/i, '')
        .trim()
        .toLowerCase();
      const destRelPath = group.pathSegments
        .map(s => s.trim().toLowerCase())
        .join(' / ');

      // Check if it's already in the destination folder
      const isAlreadyInPlace = (currentRelPath === destRelPath);

      if (!isAlreadyInPlace) {
        plannedMoves.push({
          bookmarkId: b.id,
          title: b.title,
          url: b.url,
          fromFolder: currentRelPath || 'Bookmarks Bar',
          toFolder: destRelPath ? group.pathSegments.join(' / ') : 'Bookmarks Bar',
          pathSegments: group.pathSegments,
          originalParentId: b.parentId,
          tags: (b.classification && b.classification.tags) || []
        });
        movingBookmarkIds.add(b.id);
      }
    }
  }

  // Order new folders by depth so parents are created before children
  const sortedNewFolders = Array.from(newFolderPaths)
    .map(pathStr => ({
      pathStr,
      segments: pathStr.split(' / '),
      depth: pathStr.split(' / ').length
    }))
    .sort((a, b) => a.depth - b.depth);

  // Identify folders that will become empty after moves
  const foldersToDelete = [];
  if (cleanEmptyFolders) {
    for (const f of existingFolders) {
      if (!f.isSystem && !_SYSTEM_FOLDER_IDS.has(String(f.id))) {
        // Count bookmarks in folder that are NOT moving
        const remainingBookmarks = f.bookmarkIds.filter(id => !movingBookmarkIds.has(id));
        // Count child folders
        const remainingChildFolders = f.childFolderIds.length;

        if (remainingBookmarks.length === 0 && remainingChildFolders === 0) {
          foldersToDelete.push({
            id: f.id,
            title: f.title,
            path: f.path,
            reason: 'Becomes empty after bookmark migration'
          });
        }
      }
    }
  }

  const unchangedCount = classifiedBookmarks.length - plannedMoves.length;

  return {
    targetParentId,
    newFolders: sortedNewFolders,
    moves: plannedMoves,
    foldersToDelete,
    stats: {
      totalBookmarks: classifiedBookmarks.length,
      movedCount: plannedMoves.length,
      unchangedCount,
      newFoldersCount: sortedNewFolders.length,
      cleanFoldersCount: foldersToDelete.length
    }
  };
}

/**
 * Executes the proposed organization plan using Chrome Bookmarks API.
 * Sequence: Backup -> Create Folders -> Move Bookmarks -> Clean Empty Folders.
 * @param {Object} plan Generated plan from generateOrganizationPlan
 * @param {Array} rawTree Original bookmark tree snapshot
 * @param {Array} originalBookmarks Flat list of bookmarks
 * @param {Function} [onProgress] Callback (percent, statusMessage)
 * @returns {Promise<Object>} Execution result summary
 */
async function executeOrganizationPlan(plan, rawTree, originalBookmarks, onProgress = () => {}, isCancelled = () => false) {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new Error('chrome.bookmarks API is not available');
  }

  onProgress(5, 'Creating backup snapshot...');
  const backup = _createBackup
    ? await _createBackup(plan, rawTree, originalBookmarks)
    : { id: 'backup_' + Date.now() };

  let wasCancelled = false;

  // Step 1: Create folders in hierarchy
  onProgress(15, 'Creating folder structure...');
  const createdFolderIds = [];
  const folderPathToIdMap = new Map();
  const targetParentId = plan.targetParentId || '1';

  // Seed with existing folders under target parent (relative to target parent)
  try {
    const targetTree = await chrome.bookmarks.getSubTree(targetParentId);
    function indexTargetSubtree(node, currentSegments = []) {
      if (!node.url) {
        const isTargetRoot = String(node.id) === String(targetParentId);
        const cleanTitle = (node.title || '').trim();
        const segs = isTargetRoot ? [] : (cleanTitle ? [...currentSegments, cleanTitle] : currentSegments);
        if (segs.length > 0) {
          const normKey = segs.map(s => s.trim().toLowerCase()).join(' / ');
          folderPathToIdMap.set(normKey, String(node.id));
        }
        if (node.children) {
          for (const child of node.children) {
            indexTargetSubtree(child, segs);
          }
        }
      }
    }
    if (targetTree && targetTree[0]) {
      indexTargetSubtree(targetTree[0], []);
    }
  } catch (err) {
    console.warn('Could not index target subtree:', err);
  }

  // Create required missing folders
  for (const item of plan.newFolders) {
    if (isCancelled && isCancelled()) {
      wasCancelled = true;
      break;
    }

    const segs = item.segments;
    let currentParentId = targetParentId;
    const partialPath = [];

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      partialPath.push(seg);
      const pathKey = partialPath.map(s => s.trim().toLowerCase()).join(' / ');

      if (folderPathToIdMap.has(pathKey)) {
        currentParentId = folderPathToIdMap.get(pathKey);
      } else {
        // Create folder
        const created = await chrome.bookmarks.create({
          parentId: currentParentId,
          title: seg
        });
        createdFolderIds.push(String(created.id));
        folderPathToIdMap.set(pathKey, String(created.id));
        currentParentId = String(created.id);
      }
    }
  }

  // Update backup with newly created folders for clean undo
  const updateBackupFn = (typeof updateBackupCreatedFolders === 'function')
    ? updateBackupCreatedFolders
    : _updateBackupCreatedFolders;
  if (updateBackupFn) {
    await updateBackupFn(createdFolderIds);
  }

  // Step 2: Move bookmarks to destination folders
  const totalMoves = plan.moves.length;
  let movesCompleted = 0;

  if (!wasCancelled) {
    for (let i = 0; i < totalMoves; i++) {
      if (isCancelled && isCancelled()) {
        console.log('[Organizer] Cancellation requested during bookmark moves.');
        wasCancelled = true;
        break;
      }

      const move = plan.moves[i];
      const destKey = move.pathSegments.map(s => s.trim().toLowerCase()).join(' / ');
      const destFolderId = folderPathToIdMap.get(destKey);

      if (destFolderId) {
        try {
          await chrome.bookmarks.move(move.bookmarkId, {
            parentId: destFolderId
          });
          movesCompleted++;
        } catch (err) {
          console.warn(`Could not move bookmark "${move.title}" (${move.bookmarkId}):`, err.message);
        }
      }

      const doneMoves = i + 1;
      const leftMoves = totalMoves - doneMoves;
      const pct = Math.round(20 + (doneMoves / totalMoves) * 65);
      onProgress(pct, `Moving bookmarks (${doneMoves}/${totalMoves} done, ${leftMoves} left)...`, { doneCount: doneMoves, totalCount: totalMoves });
    }
  }

  // Step 3: Deep prune all empty folders under target parent (bottom-up, multi-pass)
  let deletedFoldersCount = 0;
  if (plan.cleanEmptyFolders !== false) {
    onProgress(90, 'Cleaning up empty folders...');

    async function pruneEmptyFolders(parentId) {
      let count = 0;
      try {
        const sub = await chrome.bookmarks.getSubTree(parentId);
        if (!sub || !sub[0] || !sub[0].children) return 0;

        for (const child of sub[0].children) {
          if (!child.url) {
            // Safety check: Never delete system folders
            if (_SYSTEM_FOLDER_IDS.has(String(child.id))) continue;

            // Recursively prune subfolders first (bottom-up)
            count += await pruneEmptyFolders(child.id);

            // Re-check this folder after subfolder pruning
            try {
              const recheck = await chrome.bookmarks.getSubTree(child.id);
              if (recheck && recheck[0]) {
                const remainingChildren = recheck[0].children || [];
                // If folder is now completely empty, remove it!
                if (remainingChildren.length === 0) {
                  await chrome.bookmarks.remove(child.id);
                  count++;
                }
              }
            } catch (e) {
              // Folder may have already been removed
            }
          }
        }
      } catch (e) {}
      return count;
    }

    // Run up to 3 passes to guarantee all cascading empty parent folders are pruned cleanly
    let totalPruned = 0;
    for (let pass = 0; pass < 3; pass++) {
      const prunedInPass = await pruneEmptyFolders(targetParentId);
      totalPruned += prunedInPass;
      if (prunedInPass === 0) break;
    }
    deletedFoldersCount = totalPruned;
  }

  if (wasCancelled) {
    onProgress(100, `Arranging cancelled. Stopped after ${movesCompleted} moves.`);
  } else {
    onProgress(100, 'Organization complete!');
  }

  return {
    success: !wasCancelled,
    cancelled: wasCancelled,
    movesCompleted,
    foldersCreated: createdFolderIds.length,
    foldersDeleted: deletedFoldersCount,
    backupId: backup.id
  };
}

const _rootOrganizer = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
_rootOrganizer.generateOrganizationPlan = generateOrganizationPlan;
_rootOrganizer.executeOrganizationPlan = executeOrganizationPlan;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateOrganizationPlan,
    executeOrganizationPlan
  };
}
