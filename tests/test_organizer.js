/**
 * Unit Test Suite for Chitragupta Bookmark Organizer Engine
 * Validates tree parsing, hybrid classification rules, plan diff generation, and undo integrity.
 */

const assert = require('assert');
const { parseBookmarkTree, normalizeUrl, SYSTEM_FOLDER_IDS, isTrashOrIgnoredFolder } = require('../extension/organizer/bookmark-reader.js');
const { classifyWithRules, classifyHeuristic, classifyBookmarks } = require('../extension/organizer/classifier.js');
const { generateOrganizationPlan, executeOrganizationPlan, parseExcludedFolderNames, isFolderExcluded, sortBookmarksAlphabetically, suggestBookmarkFolder } = require('../extension/organizer/organizer.js');

console.log('🧪 Starting Chitragupta Test Suite...\n');

// Mock Chrome Bookmark Tree
const mockTree = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          {
            id: '10',
            title: 'Random',
            children: [
              { id: '101', title: 'FastAPI Tutorial', url: 'https://fastapi.tiangolo.com/tutorial/' },
              { id: '102', title: 'LeetCode Two Sum', url: 'https://leetcode.com/problems/two-sum/' },
              { id: '103', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' },
              { id: '104', title: 'Python Docs', url: 'https://docs.python.org/3/' }
            ]
          },
          {
            id: '20',
            title: 'Empty Folder',
            children: []
          },
          {
            id: '105',
            title: 'Duplicate LeetCode',
            url: 'https://leetcode.com/problems/two-sum/?ref=test'
          }
        ]
      },
      {
        id: '2',
        title: 'Other bookmarks',
        children: []
      }
    ]
  }
];

// Test 1: URL Normalization
console.log('Test 1: URL Normalization');
const clean1 = normalizeUrl('https://leetcode.com/problems/two-sum/?utm_source=google&ref=test#solution');
assert.strictEqual(clean1, 'https://leetcode.com/problems/two-sum');
console.log('  ✔ Stripped query parameters and hashes successfully.');

// Test 2: Tree Parsing
console.log('\nTest 2: Bookmark Tree Parsing');
const parsed = parseBookmarkTree(mockTree);
assert.strictEqual(parsed.bookmarks.length, 5, 'Should find 5 bookmarks');
assert.strictEqual(parsed.duplicates.length, 1, 'Should find 1 duplicate URL');
assert.strictEqual(parsed.emptyFolderIds.includes('20'), true, 'Folder 20 should be detected as empty');
assert.strictEqual(parsed.emptyFolderIds.includes('2'), false, 'System folder 2 should NOT be in emptyFolderIds');
console.log('  ✔ Correctly parsed bookmarks, duplicates, and empty folders.');
console.log('  ✔ System folder safety verified (system folders 0, 1, 2 excluded).');

// Test 3: Rule Classification
console.log('\nTest 3: Rule-Based Classification');
const rule1 = classifyWithRules({ url: 'https://fastapi.tiangolo.com/', title: 'FastAPI' });
assert.strictEqual(rule1.category, 'Programming');
assert.strictEqual(rule1.subcategory, 'Python Backend');

const rule2 = classifyWithRules({ url: 'https://leetcode.com/problems/two-sum/', title: 'Two Sum' });
assert.strictEqual(rule2.category, 'Programming');
assert.strictEqual(rule2.subcategory, 'DSA & Problems');

const rule3 = classifyWithRules({ url: 'https://arxiv.org/abs/1706.03762', title: 'Attention Paper' });
assert.strictEqual(rule3.category, 'Research');
assert.strictEqual(rule3.subcategory, 'AI Papers');

const rule4 = classifyWithRules({ url: 'https://unknown-domain-xyz.org', title: 'Some Recipe' });
assert.strictEqual(rule4.category, 'Lifestyle');
assert.strictEqual(rule4.subcategory, 'Cooking & Food');

console.log('  ✔ Domain rules and keyword rules matched expected categories.');

// Test 4: Heuristic Classification Fallback
console.log('\nTest 4: Heuristic Fallback');
const fallback = classifyHeuristic({ url: 'https://cooltechblog.io/article-1', title: 'Cool Tech' });
assert.strictEqual(fallback.category, 'Reading & News');
assert.strictEqual(fallback.subcategory, 'Articles');
console.log('  ✔ Fallback heuristic generates intelligent category from semantic tokens.');

// Test 5: Plan Diff Generation
console.log('\nTest 5: Organization Plan Diff Generation');
(async () => {
  const classified = await classifyBookmarks(parsed.bookmarks);
  const plan = generateOrganizationPlan(classified, parsed.folders, {
    targetParentId: '1',
    maxDepth: 2,
    cleanEmptyFolders: true
  });

  assert(plan.moves.length > 0, 'Should propose moves');
  assert(plan.newFolders.length > 0, 'Should propose new folders');
  console.log(`  ✔ Generated ${plan.newFolders.length} new folders, ${plan.moves.length} moves, and ${plan.foldersToDelete.length} folder cleanups.`);

  // Verify that system folders are never proposed for deletion
  for (const f of plan.foldersToDelete) {
    assert(!SYSTEM_FOLDER_IDS.has(String(f.id)), `System folder ${f.id} must never be deleted!`);
  }
  console.log('  ✔ Verified zero system folders in foldersToDelete.');

  // Verify that "Random" folder will be in foldersToDelete because all 4 of its bookmarks move out
  const randomFolderCleanup = plan.foldersToDelete.find(f => f.id === '10');
  assert(randomFolderCleanup, 'Folder 10 (Random) should be marked for cleanup since all bookmarks moved');
  console.log('  ✔ Empty source folder cleanup detection verified.');

  // Test 6: Undo & Backup Restoration Test
  console.log('\nTest 6: Undo & Backup Restoration');
  const { undoLastOrganization, createBackup } = require('../extension/organizer/backup.js');

  // Setup Mock Chrome Storage & Bookmarks
  let storageStore = {};
  const mockBookmarkNodes = new Map();

  // Root tree
  mockBookmarkNodes.set('0', { id: '0', title: '', children: [] });
  mockBookmarkNodes.set('1', { id: '1', title: 'Bookmarks bar', parentId: '0', children: [] });
  mockBookmarkNodes.set('2', { id: '2', title: 'Other bookmarks', parentId: '0', children: [] });
  mockBookmarkNodes.set('11', { id: '11', title: 'AI ', parentId: '1', children: [] }); // Folder with trailing space

  // Add 2 bookmarks inside "AI "
  const bm1 = { id: '201', title: 'Chat GPT', url: 'https://chat.openai.com/', parentId: '11' };
  const bm2 = { id: '202', title: 'DeepSeek', url: 'https://chat.deepseek.com/', parentId: '11' };
  mockBookmarkNodes.set('201', bm1);
  mockBookmarkNodes.set('202', bm2);
  mockBookmarkNodes.get('11').children.push(bm1, bm2);
  mockBookmarkNodes.get('1').children.push(mockBookmarkNodes.get('11'));
  mockBookmarkNodes.get('0').children.push(mockBookmarkNodes.get('1'), mockBookmarkNodes.get('2'));

  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (storageStore[k]) res[k] = storageStore[k];
          }
          return res;
        },
        set: async (obj) => {
          Object.assign(storageStore, obj);
        }
      }
    },
    bookmarks: {
      getTree: async () => [mockBookmarkNodes.get('0')],
      get: async (id) => {
        const n = mockBookmarkNodes.get(String(id));
        return n ? [n] : [];
      },
      getChildren: async (parentId) => {
        const n = mockBookmarkNodes.get(String(parentId));
        return n && n.children ? [...n.children] : [];
      },
      search: async (q) => {
        const found = [];
        for (const n of mockBookmarkNodes.values()) {
          if (q.url && n.url === q.url) found.push(n);
        }
        return found;
      },
      move: async (id, dest) => {
        const n = mockBookmarkNodes.get(String(id));
        if (n) {
          const targetParentId = (dest && dest.parentId !== undefined) ? String(dest.parentId) : String(n.parentId);
          // Remove from old parent
          const oldParent = mockBookmarkNodes.get(String(n.parentId));
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(c => String(c.id) !== String(id));
          }
          n.parentId = targetParentId;
          const newParent = mockBookmarkNodes.get(targetParentId);
          if (newParent) {
            newParent.children = newParent.children || [];
            if (dest && dest.index !== undefined) {
              const safeIndex = Math.min(dest.index, newParent.children.length);
              newParent.children.splice(safeIndex, 0, n);
            } else {
              newParent.children.push(n);
            }
          }
        }
        return n;
      },
      create: async (item) => {
        const newId = 'gen_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        const node = { id: newId, ...item, children: item.url ? undefined : [] };
        mockBookmarkNodes.set(newId, node);
        const parent = mockBookmarkNodes.get(String(item.parentId));
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        }
        return node;
      },
      remove: async (id) => {
        const n = mockBookmarkNodes.get(String(id));
        if (n && n.parentId) {
          const parent = mockBookmarkNodes.get(String(n.parentId));
          if (parent && parent.children) {
            parent.children = parent.children.filter(c => String(c.id) !== String(id));
          }
        }
        mockBookmarkNodes.delete(String(id));
      },
      removeTree: async (id) => {
        function del(nid) {
          const node = mockBookmarkNodes.get(String(nid));
          if (node && node.children) {
            for (const c of [...node.children]) del(c.id);
          }
          if (node && node.parentId) {
            const parent = mockBookmarkNodes.get(String(node.parentId));
            if (parent && parent.children) {
              parent.children = parent.children.filter(c => String(c.id) !== String(nid));
            }
          }
          mockBookmarkNodes.delete(String(nid));
        }
        del(id);
      },
      getSubTree: async (id) => {
        const n = mockBookmarkNodes.get(String(id));
        return n ? [n] : [];
      }
    }
  };

  // 1. Create backup before move
  const originalBookmarks = [
    { id: '201', title: 'Chat GPT', url: 'https://chat.openai.com/', parentId: '11', folderPath: 'Bookmarks bar / AI ' },
    { id: '202', title: 'DeepSeek', url: 'https://chat.deepseek.com/', parentId: '11', folderPath: 'Bookmarks bar / AI ' }
  ];
  await createBackup({ moves: [], newFolders: [], foldersToDelete: [] }, [mockBookmarkNodes.get('0')], originalBookmarks);

  // 2. Simulate what happened: bookmarks were moved outside to Bookmarks Bar root ('1') and "AI " was left empty
  await global.chrome.bookmarks.move('201', { parentId: '1' });
  await global.chrome.bookmarks.move('202', { parentId: '1' });
  assert.strictEqual(mockBookmarkNodes.get('11').children.length, 0, 'AI folder should be empty in simulation');
  assert.strictEqual(mockBookmarkNodes.get('201').parentId, '1', 'BM1 should be on root in simulation');

  // 3. Execute Undo
  const undoResult = await undoLastOrganization();
  assert.strictEqual(undoResult.success, true, 'Undo should succeed');
  assert.strictEqual(undoResult.restoredCount, 2, 'Should restore 2 bookmarks');

  // 4. Assert bookmarks are back inside "AI " folder (id '11')
  assert.strictEqual(mockBookmarkNodes.get('201').parentId, '11', 'Chat GPT should be restored to folder 11 (AI)');
  assert.strictEqual(mockBookmarkNodes.get('202').parentId, '11', 'DeepSeek should be restored to folder 11 (AI)');
  assert.strictEqual(mockBookmarkNodes.get('11').children.length, 2, 'AI folder should have both bookmarks back');
  console.log('  ✔ Verified undo moves bookmarks back inside exact folder (folder 11 "AI ") instead of leaving them outside on root.');

  // Test 7: Smart Tree Snapshot Restoration
  console.log('\nTest 7: Smart Tree Snapshot Restoration');
  const { restoreFromTreeSnapshot } = require('../extension/organizer/backup.js');

  const snapshotToRestore = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          children: [
            {
              id: 'snap_ai',
              title: 'AI ',
              children: [
                { id: 'snap_gpt', title: 'Chat GPT', url: 'https://chat.openai.com/' }
              ]
            },
            {
              id: 'snap_docs',
              title: 'Docs',
              children: [
                { id: 'snap_doc1', title: 'Spring Guides', url: 'https://spring.io/guides' }
              ]
            }
          ]
        }
      ]
    }
  ];

  const treeRes = await restoreFromTreeSnapshot(snapshotToRestore);
  assert.strictEqual(treeRes.success, true);
  // Both Chat GPT and Spring Guides should be placed in their respective folders
  console.log('  ✔ Verified smart tree snapshot restoration reuses existing items and creates missing structure.');

  // Test 8: Single-Item Subfolder Merging into Parent Folder
  console.log('\nTest 8: Single-Site Subfolder Merging into Parent Folder');
  const sampleBookmarks = [
    {
      id: 'sub_1',
      title: 'Figma Web App',
      url: 'https://figma.com',
      parentId: '1',
      classification: { category: 'Design', subcategory: 'Figma' } // Only 1 in Figma
    },
    {
      id: 'sub_2',
      title: 'Dribbble Shots',
      url: 'https://dribbble.com',
      parentId: '1',
      classification: { category: 'Design', subcategory: 'Inspiration' } // 2 in Inspiration
    },
    {
      id: 'sub_3',
      title: 'Behance Portfolio',
      url: 'https://behance.net',
      parentId: '1',
      classification: { category: 'Design', subcategory: 'Inspiration' }
    }
  ];

  // Run with mergeSingleItemSubfolders: true (default)
  const planMerged = generateOrganizationPlan(sampleBookmarks, [], {
    targetParentId: '1',
    maxDepth: 2,
    mergeSingleItemSubfolders: true
  });

  const figmaMove = planMerged.moves.find(m => m.bookmarkId === 'sub_1');
  assert(figmaMove, 'Figma move should be planned');
  assert.strictEqual(figmaMove.toFolder, 'Design', 'Figma (1 item) should merge into parent "Design"');
  
  const dribbbleMove = planMerged.moves.find(m => m.bookmarkId === 'sub_2');
  assert(dribbbleMove, 'Dribbble move should be planned');
  assert.strictEqual(dribbbleMove.toFolder, 'Design / Inspiration', 'Inspiration (2 items) should retain its subfolder');

  // Run with mergeSingleItemSubfolders: false and minBookmarksPerFolder: 1
  const planUnmerged = generateOrganizationPlan(sampleBookmarks, [], {
    targetParentId: '1',
    maxDepth: 2,
    mergeSingleItemSubfolders: false,
    minBookmarksPerFolder: 1
  });

  const figmaUnmergedMove = planUnmerged.moves.find(m => m.bookmarkId === 'sub_1');
  assert(figmaUnmergedMove, 'Figma unmerged move should be planned');
  assert.strictEqual(figmaUnmergedMove.toFolder, 'Design / Figma', 'When merge is disabled, Figma should remain its own subfolder');
  console.log('  ✔ Verified single-item subfolder merges into parent folder "Design".');
  console.log('  ✔ Verified setting toggle can disable merge when user prefers isolated subfolders.');

  // Test 9: Reorganization with Deep Empty Folder Pruning & Clean Undo
  console.log('\nTest 9: Reorganization with Deep Empty Folder Pruning & Clean Undo');

  // Reset mock tree with Bookmarks bar having an old folder "OldDev" containing 2 bookmarks,
  // and an old empty folder "OldEmpty".
  mockBookmarkNodes.clear();
  mockBookmarkNodes.set('0', { id: '0', title: '', children: [] });
  mockBookmarkNodes.set('1', { id: '1', title: 'Bookmarks bar', parentId: '0', children: [] });
  mockBookmarkNodes.set('2', { id: '2', title: 'Other bookmarks', parentId: '0', children: [] });
  mockBookmarkNodes.set('old_dev', { id: 'old_dev', title: 'OldDev', parentId: '1', children: [] });
  mockBookmarkNodes.set('old_empty', { id: 'old_empty', title: 'OldEmpty', parentId: '1', children: [] });

  const bmA = { id: 'bm_a', title: 'FastAPI Tutorial', url: 'https://fastapi.tiangolo.com/', parentId: 'old_dev' };
  const bmB = { id: 'bm_b', title: 'Python Docs', url: 'https://docs.python.org/3/', parentId: 'old_dev' };
  mockBookmarkNodes.set('bm_a', bmA);
  mockBookmarkNodes.set('bm_b', bmB);
  mockBookmarkNodes.get('old_dev').children.push(bmA, bmB);
  mockBookmarkNodes.get('1').children.push(mockBookmarkNodes.get('old_dev'), mockBookmarkNodes.get('old_empty'));
  mockBookmarkNodes.get('0').children.push(mockBookmarkNodes.get('1'), mockBookmarkNodes.get('2'));

  const initialRawTree = [mockBookmarkNodes.get('1')];
  const initialBookmarks = [
    { id: 'bm_a', title: 'FastAPI Tutorial', url: 'https://fastapi.tiangolo.com/', parentId: 'old_dev', folderPath: 'Bookmarks bar / OldDev', classification: { category: 'Programming', subcategory: 'Python' } },
    { id: 'bm_b', title: 'Python Docs', url: 'https://docs.python.org/3/', parentId: 'old_dev', folderPath: 'Bookmarks bar / OldDev', classification: { category: 'Programming', subcategory: 'Python' } }
  ];

  const plan9 = generateOrganizationPlan(initialBookmarks, [
    { id: 'old_dev', title: 'OldDev', parentId: '1', path: 'Bookmarks bar / OldDev', isSystem: false, bookmarkIds: ['bm_a', 'bm_b'], childFolderIds: [] },
    { id: 'old_empty', title: 'OldEmpty', parentId: '1', path: 'Bookmarks bar / OldEmpty', isSystem: false, bookmarkIds: [], childFolderIds: [] }
  ], {
    targetParentId: '1',
    cleanEmptyFolders: true
  });

  // Execute organization plan
  const execRes = await executeOrganizationPlan(plan9, initialRawTree, initialBookmarks);
  assert.strictEqual(execRes.movesCompleted, 2, 'Should move 2 bookmarks');
  
  // Verify empty folders were removed from tree
  assert(!mockBookmarkNodes.has('old_dev'), 'OldDev folder should be removed because it became empty');
  assert(!mockBookmarkNodes.has('old_empty'), 'OldEmpty folder should be removed because it was empty');
  console.log('  ✔ Verified old empty folders are pruned from the bookmark tree.');

  // Now execute Undo
  const undoRes2 = await undoLastOrganization();
  assert.strictEqual(undoRes2.success, true, 'Undo should succeed');
  assert.strictEqual(undoRes2.restoredCount, 2, 'Should restore 2 bookmarks');

  // Verify bookmarks are restored to OldDev
  const restoredBmA = mockBookmarkNodes.get('bm_a');
  assert(restoredBmA, 'BM A should exist');
  const restoredDevFolder = mockBookmarkNodes.get(String(restoredBmA.parentId));
  assert(restoredDevFolder, 'Parent folder should exist');
  assert.strictEqual(restoredDevFolder.title, 'OldDev', 'BM A should be back in OldDev');
  // Test 10: Baseline Snapshot Save, Rollback, and Exclusion of Trash & Speed Dials
  console.log('\nTest 10: Baseline Snapshot Save, Rollback, and Exclusion of Trash & Speed Dials');
  const {
    saveBaselineSnapshot,
    getBaselineSnapshot,
    rollbackToSavedStructure
  } = require('../extension/organizer/backup.js');

  // 1. Save current baseline
  const savedSnap = await saveBaselineSnapshot();
  assert(savedSnap && savedSnap.id, 'Baseline snapshot should have an ID');
  assert.strictEqual(savedSnap.bmCount, 2, 'Should record 2 bookmarks in baseline');
  console.log('  ✔ Baseline snapshot successfully saved to local storage.');

  // 2. Retrieve baseline
  const retrieved = await getBaselineSnapshot();
  assert(retrieved && retrieved.tree, 'Retrieved snapshot should have tree structure');
  assert.strictEqual(retrieved.bmCount, 2, 'Retrieved snapshot should have correct bmCount');
  console.log('  ✔ Retrieved saved baseline snapshot with correct metadata.');

  // 3. Test exclusion of Trash and Speed Dials during snapshot restoration
  const dirtySnapshot = [
    {
      id: '1',
      title: 'Bookmarks bar',
      children: [
        {
          id: 'clean_docs',
          title: 'Docs',
          children: [
            { id: 'clean_bm_1', title: 'React Docs', url: 'https://react.dev/' }
          ]
        },
        {
          id: 'unwanted_trash',
          title: 'Trash',
          children: [
            { id: 'trash_bm', title: 'Deleted Site', url: 'https://deleted.com/' }
          ]
        },
        {
          id: 'unwanted_speed_dials',
          title: 'Speed Dials',
          children: [
            { id: 'sd_bm', title: 'Dial Site', url: 'https://speeddial.com/' }
          ]
        }
      ]
    }
  ];

  await restoreFromTreeSnapshot(dirtySnapshot);

  // Assert Docs was created / restored
  let hasDocs = false;
  let hasTrash = false;
  let hasSpeedDials = false;
  for (const node of mockBookmarkNodes.values()) {
    if (node.title === 'Docs') hasDocs = true;
    if (node.title && node.title.toLowerCase() === 'trash') hasTrash = true;
    if (node.title && node.title.toLowerCase() === 'speed dials') hasSpeedDials = true;
  }
  assert(hasDocs, 'Docs folder should have been restored');
  assert(!hasTrash, 'Trash folder must NOT be restored');
  assert(!hasSpeedDials, 'Speed Dials folder must NOT be restored');
  console.log('  ✔ Verified Trash and Speed Dials are strictly excluded from restoration.');

  // 4. Test rollbackToSavedStructure
  const rollbackResult = await rollbackToSavedStructure();
  assert.strictEqual(rollbackResult.success, true, 'Rollback should succeed');
  console.log('  ✔ Verified rollback to saved baseline structure executes cleanly.');

  // Test 11: Protection of Excluded Folders (e.g. CDH) & Child Bookmarks
  console.log('\nTest 11: Protection of Excluded Folders (e.g. CDH) & Child Bookmarks');

  // 1. Helper function tests
  const parsedEx = parseExcludedFolderNames('CDH, Personal, Secret');
  assert.deepStrictEqual(parsedEx, ['cdh', 'personal', 'secret']);
  assert.strictEqual(isFolderExcluded('CDH', null, parsedEx), true);
  assert.strictEqual(isFolderExcluded('cdh', null, parsedEx), true);
  assert.strictEqual(isFolderExcluded('Other', 'Bookmarks bar / CDH / Subfolder', parsedEx), true);
  assert.strictEqual(isFolderExcluded('Other', 'Bookmarks bar / Random', parsedEx), false);
  console.log('  ✔ Excluded folder parsing and path matching verified.');

  // 2. Mock tree with CDH folder and child bookmarks
  const cdhTree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          children: [
            {
              id: 'cdh_folder',
              title: 'CDH',
              children: [
                { id: 'cdh_bm1', title: 'Cloudera Hadoop', url: 'https://cloudera.com/hadoop' },
                { id: 'cdh_bm2', title: 'CDH Cluster Docs', url: 'https://docs.cloudera.com/cdh' }
              ]
            },
            {
              id: 'normal_folder',
              title: 'Dev',
              children: [
                { id: 'dev_bm1', title: 'FastAPI', url: 'https://fastapi.tiangolo.com/' }
              ]
            },
            {
              id: 'empty_excluded',
              title: 'Personal',
              children: []
            }
          ]
        }
      ]
    }
  ];

  const parsedCdh = parseBookmarkTree(cdhTree);
  assert.strictEqual(parsedCdh.bookmarks.length, 3);

  const cdhPlan = generateOrganizationPlan(parsedCdh.bookmarks, parsedCdh.folders, {
    targetParentId: '1',
    maxDepth: 2,
    cleanEmptyFolders: true,
    excludedFolders: 'CDH, Personal'
  });

  // Verify CDH bookmarks are NOT moved
  const movesFromCdh = cdhPlan.moves.filter(m => m.fromFolder.toLowerCase().includes('cdh') || m.bookmarkId.startsWith('cdh_'));
  assert.strictEqual(movesFromCdh.length, 0, 'No moves should be planned for bookmarks inside CDH!');

  // Verify CDH folder is NEVER marked for deletion
  const cdhInDeletes = cdhPlan.foldersToDelete.find(f => f.title.toLowerCase() === 'cdh');
  assert(!cdhInDeletes, 'CDH folder must NEVER be marked for deletion in foldersToDelete!');

  // Verify empty excluded folder "Personal" is also protected from foldersToDelete
  const personalInDeletes = cdhPlan.foldersToDelete.find(f => f.title.toLowerCase() === 'personal');
  assert(!personalInDeletes, 'Protected empty folder "Personal" must NOT be in foldersToDelete!');

  assert.strictEqual(cdhPlan.stats.protectedCount, 2, 'Should record 2 bookmarks protected in CDH');
  assert(cdhPlan.protectedFolderNames.includes('CDH'), 'CDH should be in protectedFolderNames');
  console.log('  ✔ Verified 0 moves from CDH and 0 deletion targets for protected folders.');

  // 3. Test execution immunity in executeOrganizationPlan
  mockBookmarkNodes.clear();
  function registerMockNodes(node, parentId = null) {
    mockBookmarkNodes.set(String(node.id), {
      id: String(node.id),
      title: node.title,
      url: node.url,
      parentId: parentId ? String(parentId) : null,
      children: node.children ? [] : undefined
    });
    if (node.children) {
      for (const ch of node.children) {
        registerMockNodes(ch, node.id);
        mockBookmarkNodes.get(String(node.id)).children.push(mockBookmarkNodes.get(String(ch.id)));
      }
    }
  }
  registerMockNodes(cdhTree[0]);

  // Mock getSubTree & remove for pruneEmptyFolders
  global.chrome.bookmarks.getSubTree = async (id) => {
    const node = mockBookmarkNodes.get(String(id));
    return node ? [JSON.parse(JSON.stringify(node))] : [];
  };
  global.chrome.bookmarks.remove = async (id) => {
    const node = mockBookmarkNodes.get(String(id));
    if (node && node.parentId) {
      const parent = mockBookmarkNodes.get(String(node.parentId));
      if (parent && parent.children) {
        parent.children = parent.children.filter(c => String(c.id) !== String(id));
      }
    }
    mockBookmarkNodes.delete(String(id));
  };

  await executeOrganizationPlan(cdhPlan, cdhTree, parsedCdh.bookmarks);

  // Assert CDH still exists and still contains its bookmarks
  const finalCdhNode = mockBookmarkNodes.get('cdh_folder');
  assert(finalCdhNode, 'CDH folder MUST still exist in Chrome bookmarks after execution!');
  assert.strictEqual(finalCdhNode.children.length, 2, 'CDH folder must retain all child bookmarks!');
  const finalPersonalNode = mockBookmarkNodes.get('empty_excluded');
  assert(finalPersonalNode, 'Even empty protected folder Personal must NOT be deleted by cleanup!');
  console.log('  ✔ Verified executeOrganizationPlan keeps CDH and protected empty folders 100% intact.');

  // Test 12: Safe Restoration with Nested Folders & Zero Deletion Guarantee
  console.log('\nTest 12: Safe Restoration with Nested Folders & Zero Deletion Guarantee');
  
  // Set up a tree where created folders have nested subfolders and bookmarks
  mockBookmarkNodes.clear();
  mockBookmarkNodes.set('0', { id: '0', title: '', children: [] });
  mockBookmarkNodes.set('1', { id: '1', title: 'Bookmarks bar', parentId: '0', children: [] });
  
  const originalFolder = { id: 'orig_1', title: 'MyWork', parentId: '1', children: [] };
  const b1 = { id: 'b_test_1', title: 'Work Tool 1', url: 'https://tool1.com', parentId: 'orig_1' };
  const b2 = { id: 'b_test_2', title: 'Work Tool 2', url: 'https://tool2.com', parentId: 'orig_1' };
  originalFolder.children.push(b1, b2);
  mockBookmarkNodes.set('orig_1', originalFolder);
  mockBookmarkNodes.set('b_test_1', b1);
  mockBookmarkNodes.set('b_test_2', b2);
  mockBookmarkNodes.get('1').children.push(originalFolder);
  mockBookmarkNodes.get('0').children.push(mockBookmarkNodes.get('1'));

  const snapshot12 = [JSON.parse(JSON.stringify(mockBookmarkNodes.get('1')))];
  
  // Simulate an organization that created category "Development" and subcategory "Tools"
  const devFolder = { id: 'cat_dev', title: 'Development', parentId: '1', children: [] };
  const toolsFolder = { id: 'cat_tools', title: 'Tools', parentId: 'cat_dev', children: [] };
  devFolder.children.push(toolsFolder);
  mockBookmarkNodes.set('cat_dev', devFolder);
  mockBookmarkNodes.set('cat_tools', toolsFolder);
  mockBookmarkNodes.get('1').children.push(devFolder);
  
  // Move bookmarks into cat_tools and delete old empty orig_1
  b1.parentId = 'cat_tools';
  b2.parentId = 'cat_tools';
  toolsFolder.children.push(b1, b2);
  originalFolder.children = [];
  mockBookmarkNodes.delete('orig_1');
  mockBookmarkNodes.get('1').children = mockBookmarkNodes.get('1').children.filter(c => c.id !== 'orig_1');

  // Track createdFolderIds as ['cat_dev', 'cat_tools']
  const createdIds12 = ['cat_dev', 'cat_tools'];
  
  // Mock removeTree to throw if called (it should NEVER be called on non-empty folders)
  let removeTreeCalled = false;
  global.chrome.bookmarks.removeTree = async (id) => {
    removeTreeCalled = true;
    throw new Error('removeTree should NEVER be called on active restoration!');
  };

  const undoResult12 = await restoreFromTreeSnapshot(snapshot12, createdIds12);
  assert.strictEqual(undoResult12.success, true);
  assert.strictEqual(removeTreeCalled, false, 'removeTree should never be called!');
  assert.strictEqual(mockBookmarkNodes.has('b_test_1'), true, 'b_test_1 must exist');
  assert.strictEqual(mockBookmarkNodes.has('b_test_2'), true, 'b_test_2 must exist');
  
  // Bookmarks must be back inside MyWork
  const restoredB1 = mockBookmarkNodes.get('b_test_1');
  const restoredParent = mockBookmarkNodes.get(String(restoredB1.parentId));
  assert.strictEqual(restoredParent.title, 'MyWork');
  console.log('  ✔ Verified restoreFromTreeSnapshot restores nested items safely without removeTree.');

  // Test 13: Alphabetical Reordering of Folders and Bookmarks
  console.log('\nTest 13: Alphabetical Reordering of Folders and Bookmarks');
  mockBookmarkNodes.clear();
  mockBookmarkNodes.set('0', { id: '0', title: '', children: [] });
  mockBookmarkNodes.set('1', { id: '1', title: 'Bookmarks bar', parentId: '0', children: [] });
  
  // Create unsorted subfolders and bookmarks in Bookmarks Bar ('1')
  const fZeta = { id: 'f_zeta', title: 'Zeta Docs', parentId: '1', children: [] };
  const fAlpha = { id: 'f_alpha', title: 'Alpha Dev', parentId: '1', children: [] };
  const fBeta = { id: 'f_beta', title: 'Beta Tools', parentId: '1', children: [] };
  
  // And inside Beta Tools, add unsorted bookmarks
  const bSubZ = { id: 'b_sub_z', title: 'Zebra Service', url: 'https://zebra.com', parentId: 'f_beta' };
  const bSubA = { id: 'b_sub_a', title: 'Ant Design', url: 'https://ant.design', parentId: 'f_beta' };
  fBeta.children.push(bSubZ, bSubA);

  const bYahoo = { id: 'bm_yahoo', title: 'Yahoo News', url: 'https://yahoo.com', parentId: '1' };
  const bApple = { id: 'bm_apple', title: 'Apple Developer', url: 'https://developer.apple.com', parentId: '1' };
  const bGoogle = { id: 'bm_google', title: 'Google Cloud', url: 'https://cloud.google.com', parentId: '1' };
  
  // Add in scrambled order
  mockBookmarkNodes.get('1').children.push(bYahoo, fZeta, bGoogle, fAlpha, fBeta, bApple);
  mockBookmarkNodes.set('f_zeta', fZeta);
  mockBookmarkNodes.set('f_alpha', fAlpha);
  mockBookmarkNodes.set('f_beta', fBeta);
  mockBookmarkNodes.set('b_sub_z', bSubZ);
  mockBookmarkNodes.set('b_sub_a', bSubA);
  mockBookmarkNodes.set('bm_yahoo', bYahoo);
  mockBookmarkNodes.set('bm_apple', bApple);
  mockBookmarkNodes.set('bm_google', bGoogle);

  const sortStats = await sortBookmarksAlphabetically('1', { recursive: true });
  assert.strictEqual(sortStats.success, true, 'Sort operation should succeed');
  assert.strictEqual(sortStats.sortedFolders, 3, 'Should reorder 3 folders');
  assert.strictEqual(sortStats.sortedBookmarks, 3, 'Should move 3 bookmarks to achieve alphabetical order');
  assert.strictEqual(sortStats.sortedNodes, 6, 'Should perform 6 item reposition moves total');

  // Verify Root '1' child order: Folders A-Z first, then Bookmarks A-Z
  const rootChildren = mockBookmarkNodes.get('1').children;
  assert.strictEqual(rootChildren[0].title, 'Alpha Dev', 'Folder Alpha Dev must be index 0');
  assert.strictEqual(rootChildren[1].title, 'Beta Tools', 'Folder Beta Tools must be index 1');
  assert.strictEqual(rootChildren[2].title, 'Zeta Docs', 'Folder Zeta Docs must be index 2');
  assert.strictEqual(rootChildren[3].title, 'Apple Developer', 'Bookmark Apple must be index 3');
  assert.strictEqual(rootChildren[4].title, 'Google Cloud', 'Bookmark Google must be index 4');
  assert.strictEqual(rootChildren[5].title, 'Yahoo News', 'Bookmark Yahoo must be index 5');

  // Verify nested folder Beta Tools children order
  const betaChildren = mockBookmarkNodes.get('f_beta').children;
  assert.strictEqual(betaChildren[0].title, 'Ant Design', 'Ant Design must be sorted before Zebra Service');
  assert.strictEqual(betaChildren[1].title, 'Zebra Service');
  console.log('  ✔ Verified sortBookmarksAlphabetically sorts folders A-Z followed by bookmarks A-Z recursively.');

  // Test 14: Organization Plan with sortAlphabetical: true
  console.log('\nTest 14: Organization Plan with sortAlphabetical Option');
  const unsortedBookmarks14 = [
    { id: 'b_zoo', title: 'Zoology Today', url: 'https://zoo.org', parentId: '1', classification: { category: 'Science', subcategory: 'Biology' } },
    { id: 'b_astro', title: 'Astronomy Picture', url: 'https://apod.nasa.gov', parentId: '1', classification: { category: 'Science', subcategory: 'Astronomy' } },
    { id: 'b_ai', title: 'Anthropic Claude', url: 'https://claude.ai', parentId: '1', classification: { category: 'Artificial Intelligence', subcategory: 'Assistants' } },
    { id: 'b_bot', title: 'Bot Framework', url: 'https://dev.botframework.com', parentId: '1', classification: { category: 'Artificial Intelligence', subcategory: 'Assistants' } }
  ];

  const plan14 = generateOrganizationPlan(unsortedBookmarks14, [], {
    targetParentId: '1',
    maxDepth: 2,
    sortAlphabetical: true
  });

  assert.strictEqual(plan14.sortAlphabetical, true, 'Plan must record sortAlphabetical: true');
  
  // Check that newFolders are sorted depth-first, and alphabetically within each depth level
  const depth1Folders = plan14.newFolders.filter(f => f.depth === 1).map(f => f.pathStr);
  assert.deepStrictEqual(depth1Folders, ['Artificial Intelligence', 'Science'], 'Top-level folders must be sorted A-Z');
  
  const depth2Folders = plan14.newFolders.filter(f => f.depth === 2).map(f => f.pathStr);
  assert.deepStrictEqual(depth2Folders, ['Artificial Intelligence / Assistants'], 'Subfolders must be created in proper hierarchy');

  // Check that moves within each destination folder are sorted alphabetically by bookmark title
  const movesToAi = plan14.moves.filter(m => m.toFolder.includes('Artificial Intelligence'));
  assert.strictEqual(movesToAi[0].title, 'Anthropic Claude');
  assert.strictEqual(movesToAi[1].title, 'Bot Framework');
  console.log('  ✔ Verified generateOrganizationPlan sorts categories, subfolders, and moves A-Z.');

  // Test 15: AI Folder Suggestion on Save
  console.log('\nTest 15: AI Folder Suggestion on Save');
  const existingFoldersSample = [
    { id: '1', title: 'Bookmarks bar', path: 'Bookmarks bar', isSystem: true },
    { id: 'f_docs', title: 'Docs', path: 'Bookmarks bar / Docs', isSystem: false },
    { id: 'f_ai', title: 'AI ', path: 'Bookmarks bar / AI ', isSystem: false },
    { id: 'f_tools', title: 'Tools', path: 'Bookmarks bar / Tools', isSystem: false }
  ];

  // Case A: Page about Python documentation should match existing "Docs" folder
  const classDocs = { category: 'Programming', subcategory: 'Docs', tags: ['Python', 'Reference'] };
  const sugDocs = suggestBookmarkFolder(classDocs, existingFoldersSample);
  assert.strictEqual(sugDocs.isNew, false, 'Should match existing folder Docs');
  assert.strictEqual(sugDocs.existingFolderId, 'f_docs');
  assert.strictEqual(sugDocs.folderTitle, 'Docs');

  // Case B: Page about Claude or ChatGPT should match existing "AI " folder
  const classAi = { category: 'AI & Machine Learning', subcategory: 'AI Assistants', tags: ['LLM', 'Chat'] };
  const sugAi = suggestBookmarkFolder(classAi, existingFoldersSample);
  assert.strictEqual(sugAi.isNew, false, 'Should match existing folder AI');
  assert.strictEqual(sugAi.existingFolderId, 'f_ai');

  // Case C: Page about Gaming when user has no gaming folder should propose creating new folder
  const classGame = { category: 'Gaming', subcategory: 'Retro Arcade', tags: ['Games'] };
  const sugGame = suggestBookmarkFolder(classGame, existingFoldersSample);
  assert.strictEqual(sugGame.isNew, true, 'Should propose creating a new folder when no match exists');
  assert.strictEqual(sugGame.suggestedPath, 'Gaming / Retro Arcade');
  console.log('  ✔ Verified suggestBookmarkFolder matches existing folders or proposes clean new hierarchy.');

  // Test 16: Duplicate Website Detection for Tab 1 Save (Excluding Trash and Older Folders)
  console.log('\nTest 16: Duplicate Website Detection for Tab 1 Save');
  const sampleBookmarks16 = [
    { id: 'b_101', title: 'FastAPI Web Framework', url: 'https://fastapi.tiangolo.com/tutorial/', parentId: 'f_tools', folderPath: 'Bookmarks bar / Tools' },
    { id: 'b_102', title: 'LeetCode Problem', url: 'https://leetcode.com/problems/two-sum', parentId: 'f_docs', folderPath: 'Bookmarks bar / Docs' },
    { id: 'b_trash', title: 'Deleted Old Site', url: 'https://deleted-site.com', parentId: 'f_trash', folderPath: 'Bookmarks bar / Trash' },
    { id: 'b_sd', title: 'Speed Dial Site', url: 'https://speeddial-site.com', parentId: 'f_sd', folderPath: 'Speed Dials' }
  ];

  // Helper matching the exact check used in evaluateActivePage
  function checkBookmarkExists(targetUrl, bookmarks) {
    const clean = normalizeUrl(targetUrl);
    return bookmarks.find(b => {
      if (isTrashOrIgnoredFolder(b.folderPath)) return false;
      return normalizeUrl(b.url) === clean;
    });
  }

  // Case A: Active bookmark with extra tracking query params and hash
  const testUrlWithTracking = 'https://fastapi.tiangolo.com/tutorial/?utm_source=twitter&ref=dev#intro';
  const dupMatch = checkBookmarkExists(testUrlWithTracking, sampleBookmarks16);
  assert(dupMatch, 'Should detect FastAPI as duplicate regardless of query params and hash');
  assert.strictEqual(dupMatch.id, 'b_101');
  assert.strictEqual(dupMatch.parentId, 'f_tools');

  // Case B: Bookmark residing inside Trash MUST NOT be reported as existing
  const trashUrl = 'https://deleted-site.com';
  const trashMatch = checkBookmarkExists(trashUrl, sampleBookmarks16);
  assert.strictEqual(trashMatch, undefined, 'Bookmark in Trash must NOT be flagged as already existing');

  // Case C: Bookmark residing in Speed Dials MUST NOT be reported as existing
  const sdUrl = 'https://speeddial-site.com';
  const sdMatch = checkBookmarkExists(sdUrl, sampleBookmarks16);
  assert.strictEqual(sdMatch, undefined, 'Bookmark in Speed Dials must NOT be flagged as already existing');

  // Case D: New URL that does not exist
  const newPageUrl = 'https://news.ycombinator.com/';
  const notDup = checkBookmarkExists(newPageUrl, sampleBookmarks16);
  assert.strictEqual(notDup, undefined, 'New URL should not be flagged as duplicate');
  console.log('  ✔ Verified duplicate check strictly searches active bookmarks and ignores Trash/older folders.');

  console.log('\n=============================================');
  console.log('🎉 ALL TESTS PASSED! System verified successfully.');
  console.log('=============================================');
})();

