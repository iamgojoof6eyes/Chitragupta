# AI Chrome Bookmark Organizer — Product Specification

## 1. Product

An intelligent Chrome extension that allows users to save active webpages and automatically organize existing Chrome bookmarks into clean, standardized categories and folder hierarchies. Operates directly on the native Chrome Bookmark Tree as the single source of truth.

---

## 2. Core User Flows

### 2.1 Save Current Page
```text
Open webpage
→ Click extension icon
→ Auto-detect title, URL & favicon
→ Auto-suggest category & tags
→ Click "Save Bookmark"
→ Created in native Chrome bookmark bar/folder
```

### 2.2 Background Organization & Safety Gate
```text
Click "Analyze & Propose Structure"
→ Background Service Worker takes over (safe to close popup)
→ Read Bookmarks Bar tree
→ Hybrid 4-tier classification (Rules → Local AI → Direct API → Semantic Heuristic)
→ Real-time progress streaming (done/total items and percentage)
→ Generate folder hierarchy plan
→ Desktop notification & "PLAN" badge on icon
→ User reviews visual diff preview (folders created, moves, empty cleanups)
→ User approves: click "Apply Changes"
→ Automatic pre-move snapshot created in chrome.storage.local
→ Move bookmarks to target folders
→ Multi-pass bottom-up empty folder pruning
→ Desktop notification & "DONE" badge
```

### 2.3 Task Cancellation
```text
During Analysis OR Move Execution
→ User clicks "Stop Arranging"
→ In-flight HTTP calls aborted via AbortController
→ Move loop halts immediately
→ Background states reset cleanly
→ Empty created folders pruned
→ Status returns to idle with user confirmation toast
```

### 2.4 Baseline Save & Rollback
```text
User saves clean tree baseline
→ Saved to persistent local storage with timestamp
→ User reorganizes or experiments freely
→ Click "Roll Back to Saved" anytime
→ System clears current tree and faithfully reconstructs saved baseline
→ Speed Dials and Trash explicitly excluded from restoration
```

---

## 3. Organization Principles

The system adheres to strict safety and UX rules:
- **Zero Bookmark Deletion**: Chitragupta never deletes a bookmark under any circumstance.
- **Chrome Bookmarks API as Source of Truth**: No external bookmark database or shadow state.
- **Standardized Categories**: Organizes bookmarks into clean taxonomies (`Programming`, `AI & Machine Learning`, `Productivity & Tools`, `Reading & News`, etc.) rather than retaining legacy messy folders or creating single-site folders.
- **Multi-Pass Empty Folder Pruning**: Up to 3 recursive passes to guarantee all cascading empty parent folders are cleanly eliminated.
- **Configurable Subfolder Merging**: Single-item subfolders can be merged into parent folders to prevent sparse hierarchies.
- **Guarded System Folders**: System root folders (`0`, `1`, `2`, `3`, `Bookmarks bar`, `Other bookmarks`, `Mobile bookmarks`) are strictly protected from deletion or rename.

---

## 4. Hybrid Classification Engine

```text
Bookmark (URL + Title)
       │
       ▼
[ Tier 1: Rules Engine ] ──────────► Match (Confidence >= 0.80) ──► Apply
       │ Ambiguous
       ▼
[ Tier 2: Local AI Backend ] ──────► NVIDIA NIM / Gemini ─────────► Apply
       │ (7s timeout / Circuit breaker)
       ▼
[ Tier 3: Direct API Key ] ────────► Extension Settings Key ──────► Apply
       │ Offline / No key
       ▼
[ Tier 4: Semantic Heuristic ] ────► Domain & Content Heuristic ──► Apply (1-2ms)
```

---

## 5. Technical Architecture

### Extension (Client)
- **Manifest**: Chrome Manifest V3
- **Background Worker**: `service-worker.js` (handles asynchronous analysis, apply jobs, and notifications)
- **UI Components**:
  - `popup.html` / `popup.js` / `popup.css`: Glassmorphic dark UI with real-time progress bar, item counters, and Stop button
  - `options.html` / `options.js` / `options.css`: Settings panel with direct AI key configuration and constraint toggles
- **Storage**: `chrome.storage.local` for pending plans, baseline snapshots, and user settings

### Backend (Server)
- **Framework**: Python 3.10+ / FastAPI / Uvicorn
- **HTTP Client**: `httpx.AsyncClient` with 7.0s fail-fast timeout
- **Circuit Breaker**: 60s cooldown on provider failure to prevent cascading timeouts across batch chunks
- **Encoding**: UTF-8 reconfigured stdout/stderr on Windows

---

## 6. Permissions

```json
{
  "permissions": [
    "bookmarks",
    "storage",
    "tabs",
    "notifications",
    "contextMenus"
  ]
}
```
Only essential permissions required for native bookmark operations and non-intrusive background notifications are requested.
