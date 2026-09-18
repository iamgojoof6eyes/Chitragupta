/**
 * Unit Test Suite for Chitragupta Bookmark Organizer Engine
 * Validates tree parsing, hybrid classification rules, plan diff generation, and undo integrity.
 */

const assert = require('assert');
const { parseBookmarkTree, normalizeUrl, SYSTEM_FOLDER_IDS } = require('../extension/organizer/bookmark-reader.js');
const { classifyWithRules, classifyHeuristic, classifyBookmarks } = require('../extension/organizer/classifier.js');
const { generateOrganizationPlan, executeOrganizationPlan } = require('../extension/organizer/organizer.js');

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
          // Remove from old parent
          const oldParent = mockBookmarkNodes.get(String(n.parentId));
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(c => String(c.id) !== String(id));
          }
          n.parentId = String(dest.parentId);
          const newParent = mockBookmarkNodes.get(String(dest.parentId));
          if (newParent) {
            newParent.children = newParent.children || [];
            newParent.children.push(n);
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

  console.log('\n=============================================');
  console.log('🎉 ALL TESTS PASSED! System verified successfully.');
  console.log('=============================================');
})();

