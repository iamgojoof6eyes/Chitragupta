/**
 * Bookmark Reader Module
 * Safely traverses, normalizes, and analyzes Chrome's bookmark tree.
 * Chrome Bookmarks are the single source of truth.
 */

const SYSTEM_FOLDER_IDS = new Set(['0', '1', '2', '3']);

/**
 * Normalizes a URL for comparison (removes tracking hashes, trailing slashes).
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    // Strip common tracking params
    const cleanParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!key.startsWith('utm_') && key !== 'ref' && key !== 'fbclid') {
        cleanParams.append(key, value);
      }
    }
    const searchStr = cleanParams.toString();
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${searchStr ? '?' + searchStr : ''}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Reads the Chrome bookmark tree scoped to Bookmarks Bar ('1') or specified nodeId.
 * @param {string} [rootId] Optional node id to scope traversal (defaults to '1' Bookmarks Bar)
 * @returns {Promise<BookmarkTreeNode[]>}
 */
async function getBookmarkTree(rootId = '1') {
  if (typeof chrome !== 'undefined' && chrome.bookmarks) {
    const targetId = (!rootId || rootId === '0') ? '1' : rootId;
    return await chrome.bookmarks.getSubTree(targetId);
  }
  throw new Error('chrome.bookmarks API is not available in this context');
}

/**
 * Analyzes a raw bookmark tree and extracts flattened bookmarks, folders, and statistics.
 * @param {Array} tree Root nodes returned by chrome.bookmarks.getTree()
 * @returns {Object} { bookmarks, folders, emptyFolderIds, duplicates, systemFolderIds }
 */
function parseBookmarkTree(tree) {
  const bookmarks = [];
  const folders = new Map(); // id -> folder details
  const urlMap = new Map();  // normalizedUrl -> [bookmark]
  const duplicates = [];

  function traverse(node, currentPath = []) {
    const isSystem = SYSTEM_FOLDER_IDS.has(String(node.id));
    const isFolder = !node.url;

    if (isFolder) {
      const cleanTitle = (node.title || '').trim();
      const nextPath = cleanTitle ? [...currentPath, cleanTitle] : currentPath;
      const folderInfo = {
        id: String(node.id),
        title: cleanTitle || (node.id === '0' ? 'Root' : 'Folder'),
        parentId: node.parentId ? String(node.parentId) : null,
        path: nextPath.join(' / '),
        isSystem,
        childFolderIds: [],
        bookmarkIds: [],
        childrenCount: 0
      };
      folders.set(String(node.id), folderInfo);

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (!child.url) {
            folderInfo.childFolderIds.push(String(child.id));
          } else {
            folderInfo.bookmarkIds.push(String(child.id));
          }
          traverse(child, nextPath);
        }
        folderInfo.childrenCount = node.children.length;
      }
    } else {
      const normUrl = normalizeUrl(node.url);
      const item = {
        id: String(node.id),
        title: node.title || 'Untitled Bookmark',
        url: node.url,
        normalizedUrl: normUrl,
        parentId: String(node.parentId),
        folderPath: currentPath.join(' / '),
        dateAdded: node.dateAdded || Date.now()
      };
      bookmarks.push(item);

      if (!urlMap.has(normUrl)) {
        urlMap.set(normUrl, []);
      }
      urlMap.get(normUrl).push(item);
    }
  }

  for (const rootNode of tree) {
    traverse(rootNode, []);
  }

  // Find duplicates
  for (const [normUrl, items] of urlMap.entries()) {
    if (items.length > 1 && normUrl) {
      duplicates.push({
        url: items[0].url,
        normalizedUrl: normUrl,
        count: items.length,
        items
      });
    }
  }

  // Find empty folders (folders with 0 bookmarks and 0 child folders, non-system)
  const emptyFolderIds = [];
  for (const [id, f] of folders.entries()) {
    if (!f.isSystem && f.bookmarkIds.length === 0 && f.childFolderIds.length === 0) {
      emptyFolderIds.push(id);
    }
  }

  return {
    bookmarks,
    folders: Array.from(folders.values()),
    foldersMap: folders,
    emptyFolderIds,
    duplicates,
    systemFolderIds: SYSTEM_FOLDER_IDS
  };
}

/**
 * Returns available top-level and parent folders suitable as organization roots.
 * @param {Array} folders Array of parsed folder objects
 */
function getTargetParentFolders(folders) {
  // Common roots: Bookmarks Bar ('1'), Other Bookmarks ('2')
  return folders.filter(f => f.id === '1' || f.id === '2' || (!f.isSystem && f.parentId === '1'));
}

const _rootReader = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
_rootReader.SYSTEM_FOLDER_IDS = SYSTEM_FOLDER_IDS;
_rootReader.normalizeUrl = normalizeUrl;
_rootReader.getBookmarkTree = getBookmarkTree;
_rootReader.parseBookmarkTree = parseBookmarkTree;
_rootReader.getTargetParentFolders = getTargetParentFolders;

// Support both ES module / Browser and CommonJS for automated unit testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SYSTEM_FOLDER_IDS,
    normalizeUrl,
    getBookmarkTree,
    parseBookmarkTree,
    getTargetParentFolders
  };
}
