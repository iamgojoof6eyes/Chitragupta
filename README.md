# Chitragupta — AI Chrome Bookmark Organizer (v1.1.0)

An intelligent, safety-first Chrome extension and FastAPI backend that organizes your Chrome bookmarks into clean, intuitive folder hierarchies using deterministic rules, semantic heuristics, and state-of-the-art AI (NVIDIA NIM / Google Gemini).

> **Source of Truth Principle**: Chrome's native Bookmark Tree is the single source of truth. Chitragupta operates on bookmarks directly—no external database, no telemetry, and zero bookmark deletion.

---

## Key Features

1. **Smart One-Click Save & AI Folder Suggestion**:
   - Detects active tab title, URL, and favicon automatically.
   - **Scoped Duplicate Detection**: Checks if the site already exists in your active bookmarks bar (strictly ignoring Trash, Bin, and Speed Dials).
   - If already saved, hides the "Save Bookmark" button and displays an informative **"Already Exists"** card with its current location and a **"Show in Explorer"** shortcut.
   - If new, the **AI Suggestion Engine** scores and matches the page against your existing folder taxonomy (e.g. `AI`, `Docs`, `Tools`) or proposes a clean new hierarchy, auto-selecting it with an **"✨ AI Suggested"** badge.

2. **Automated Hybrid Classification**:
   - **Tier 1 (Instant Rules Engine)**: 100+ domain and keyword patterns (GitHub, LeetCode, arXiv, YouTube, etc.) for zero-latency, local-only organization.
   - **Tier 2 (AI Classification)**: Ambiguous URLs are routed in batches to the local FastAPI backend powered by NVIDIA NIM (`openai/gpt-oss-20b`) or Google Gemini (`gemini-1.5-flash`).
   - **Tier 3 (Direct Key Fallback)**: If the local server is offline, the extension can call Gemini or NVIDIA APIs directly using the key in extension settings.
   - **Tier 4 (Intelligent Semantic Heuristics)**: If all AI APIs are unavailable or circuit-broken, the built-in heuristic classifier categorizes bookmarks into standard taxonomies in 1–2 milliseconds.

3. **Background Processing & Desktop Notifications**:
   - Reorganization analysis runs in a background Service Worker.
   - Safe to close the extension popup or browse other tabs during analysis.
   - Sends desktop system notifications when analysis or reorganization completes.
   - Chrome extension icon badge alerts (`PLAN`, `DONE`, `STOP`, `SAVED`).

4. **Real-Time Dynamic Progress & Task Cancellation**:
   - Fine-grained progress bar reflecting actual completed vs. remaining items (`X/Y done, Z left`).
   - Dedicated percentage badge and item counter with smooth transitions.
   - **"Stop Arranging" button**: Cancel in-progress analysis or bookmark moving safely with immediate state cleanup.

5. **Tree Baseline Snapshots & Reliable Rollback**:
   - Save your current bookmark structure as a named baseline snapshot.
   - Roll back to the saved baseline anytime with a single click.
   - **Restore Previous Structure**: Dynamic 1-click restore to roll back to the structure immediately preceding the last reorganization.
   - Browser Trash and Speed Dials are strictly excluded from restoration.
   - Export and restore bookmarks from full JSON snapshots.

6. **Strict Safety Gates & Deep Cleanup**:
   - **Visual Diff Preview**: Review proposed folders, moves, and empty folder cleanups *before* applying anything.
   - **Protected / Excluded Folders**: Folders in exceptions (e.g., `CDH`, `Work`) and their child bookmarks are 100% immune from moves, regrouping, or deletion.
   - **Automatic Pre-Execution Backup**: Full bookmark snapshot created before every modification.
   - **Zero Bookmark Deletion**: Chitragupta will *never* delete a bookmark.
   - **Multi-Pass Empty Folder Pruning**: Deep bottom-up cleanup (up to 3 passes) guarantees zero cascading empty folders are left behind.
   - **Configurable Subfolder Merging**: Single-item subfolders can be automatically merged into their parent folder to eliminate clutter (toggleable in settings).
   - **System Folder Protection**: Default roots (`Bookmarks bar`, `Other bookmarks`, `Mobile bookmarks`) are strictly guarded.

7. **Tree Explorer & Duplicate Management**:
   - Search the entire bookmark hierarchy in real-time.
   - Detects duplicate bookmark URLs automatically with count badges.
   - Quick "Reorder A-Z" action to instantly sort folders and bookmarks.

8. **Live Bookmark Search in Settings**:
   - Dedicated search engine in Extension Settings (Options page).
   - Search across **All Fields**, **Page Title**, **URL**, or **Tags / Category**.
   - Interactive tag pills with instant click-to-filter capability.
   - Quick actions to copy bookmark URL to clipboard or open in a new tab.

9. **Alphabetical (A-Z) Reordering & Persistent Auto-Sort**:
   - One-click "Reorder A-Z" in Organize toolbar and Explorer tab to recursively sort folders A-Z followed by bookmarks A-Z.
   - User preference setting: **"Always organize bookmarks in alphabetical order (A-Z)"** to ensure every automated organization arranges folders and bookmarks cleanly A-Z.

---

## Installation & Setup

### 1. Load the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle switch in the top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder inside `c:\Dev\Chitragupta\extension`.
5. The Chitragupta icon will appear in your Chrome toolbar.

### 2. (Optional) Run the Local AI Backend

The extension works **100% standalone** with its built-in rules and heuristics. To enable local AI classification for ambiguous bookmarks:

```powershell
# Option A: Run convenience script
.\start_backend.ps1   # or start_backend.bat

# Option B: Run via terminal
cd backend
python -m pip install -r requirements.txt
python run_server.py
```

The server starts at `http://localhost:8000`.

#### Configure AI Provider (.env)

Create or edit `backend/.env`:

```ini
# AI Provider: auto, nvidia, gemini, heuristic
AI_PROVIDER=auto

# NVIDIA Build / NIM API Key (https://build.nvidia.com)
NVIDIA_API_KEY=nvapi-...

# Google Gemini API Key (https://aistudio.google.com)
GEMINI_API_KEY=AIzaSy...

# Active fast model identifier (recommended: openai/gpt-oss-20b)
AI_MODEL=openai/gpt-oss-20b
```

#### Backend Resilience Features:
- **Circuit Breaker**: If NVIDIA or Gemini times out (7s limit) or returns an error, the provider is placed on a 60-second cooldown. All remaining batches immediately fall back to the instant local heuristic engine with zero delay.
- **Batching**: Ambiguous bookmarks are processed in chunks of 25 items to minimize HTTP overhead.
- **Windows UTF-8 Support**: Automatic stdout/stderr reconfiguration prevents charmap encoding crashes.

---

## Extension Structure

```
Chitragupta/
├── .gitignore                     # Git exclusion rules (secrets, venv, cache)
├── README.md                      # Complete system documentation
├── product.md                     # Product specifications & requirements
├── Process_flow.md                # Architectural flow & diagrams
├── LICENSE                        # MIT License
├── start_backend.bat              # Windows batch launcher
├── start_backend.ps1              # Windows PowerShell launcher
├── extension/
│   ├── manifest.json              # Chrome Manifest V3
│   ├── popup/
│   │   ├── popup.html             # UI with Save, Organize, Explorer tabs & Stop button
│   │   ├── popup.css              # Glassmorphic dark design system
│   │   └── popup.js               # Reactive popup controller & progress tracker
│   ├── organizer/
│   │   ├── bookmark-reader.js     # Tree traversal, sanitization & duplicate detection
│   │   ├── classifier.js          # Hybrid rule engine + heuristic fallback
│   │   ├── organizer.js           # Safe plan diff generator, execution & multi-pass pruner
│   │   └── backup.js              # Pre-change snapshots, baseline save & rollback
│   ├── api/
│   │   └── client.js              # FastAPI client, batching, abort signal & direct API keys
│   ├── background/
│   │   └── service-worker.js      # Background analysis, apply execution & system notifications
│   ├── options/
│   │   ├── options.html           # Settings & configuration UI
│   │   ├── options.css            # Settings styling & custom switches
│   │   └── options.js             # Settings persistence to chrome.storage.local
│   └── icons/                     # 16px, 48px, 128px extension icons
├── backend/
│   ├── main.py                    # FastAPI application & REST endpoints
│   ├── ai_service.py              # NVIDIA NIM / Gemini integration & circuit breaker
│   ├── requirements.txt           # Python dependencies
│   ├── run_server.py              # Server runner & self-test suite
│   ├── .env.example               # Template environment configuration
│   └── .env                       # Local secrets (gitignored)
└── tests/
    └── test_organizer.js          # Automated Node.js unit test suite (16 test cases)
```

---

## Running Automated Tests

```bash
# Run Extension Logic Tests (Node.js)
node tests/test_organizer.js

# Run Backend API Self-Tests (Python)
python backend/run_server.py --test
```

---

## License

This project is licensed under the terms of the [MIT License](./LICENSE).
