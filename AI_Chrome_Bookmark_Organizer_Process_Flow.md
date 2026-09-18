# AI-Powered Chrome Bookmark Organizer

## 1. Project Goal

Build a Chrome extension that allows the user to:

1. Save the currently open webpage with one click.
2. Read and manage existing Chrome bookmarks.
3. Automatically analyze bookmarks.
4. Create a clean folder structure based on bookmark content.
5. Move bookmarks into appropriate folders.
6. Delete unnecessary/empty folders when requested.
7. Preview proposed changes before applying them.
8. Undo the last organization operation.
9. Use a free AI API such as NVIDIA Build/NIM or Gemini for ambiguous classification.

The Chrome bookmark tree remains the **source of truth**. No separate bookmark database is required for the first version.

---

# 2. High-Level Architecture

```text
                         Chrome Browser
                              │
                              ▼
                    ┌───────────────────┐
                    │  Chrome Extension │
                    └─────────┬─────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
                 ▼                         ▼
          Save Current Page          Organize Bookmarks
                 │                         │
                 │                         ▼
                 │                chrome.bookmarks API
                 │                         │
                 │                         ▼
                 │                  Bookmark Tree
                 │                         │
                 │                         ▼
                 │                  Classification
                 │                         │
                 │              ┌──────────┴──────────┐
                 │              │                     │
                 │          Rules Engine          AI Model
                 │              │                     │
                 │              └──────────┬──────────┘
                 │                         ▼
                 │                Proposed Structure
                 │                         │
                 │                         ▼
                 │                   Preview Changes
                 │                         │
                 │                         ▼
                 └──────────────────► Apply Changes
                                           │
                                           ▼
                                  Chrome Bookmark Tree
```

---

# 3. Core Features

## 3.1 Save Current Page

When the user is browsing a webpage:

```text
User opens webpage
       ↓
Clicks extension
       ↓
Extension popup opens
       ↓
Shows current page
       ↓
User clicks "Save"
       ↓
Get active tab URL + title
       ↓
Save using Chrome Bookmarks API
```

Example:

```text
Current page:
https://fastapi.tiangolo.com/

Title:
FastAPI
```

The extension can create the bookmark using:

```javascript
chrome.bookmarks.create({
    parentId: "...",
    title: "FastAPI",
    url: "https://fastapi.tiangolo.com/"
});
```

The first version can save everything into a default folder such as:

```text
AI Bookmarks
```

---

# 4. Reading Existing Bookmarks

The extension should be able to read the complete bookmark tree.

Use:

```javascript
chrome.bookmarks.getTree()
```

Conceptually:

```text
Bookmarks Bar
├── Programming
│   ├── GitHub
│   └── FastAPI
├── Random
│   ├── YouTube
│   └── Article
└── Research
    └── AI Paper
```

The extension converts this tree into data that can be analyzed.

Example:

```json
[
  {
    "id": "123",
    "title": "FastAPI",
    "url": "https://fastapi.tiangolo.com/",
    "folder": "Programming"
  },
  {
    "id": "456",
    "title": "Two Sum",
    "url": "https://leetcode.com/problems/two-sum/",
    "folder": "Random"
  }
]
```

---

# 5. Bookmark Classification

The organizer should use a **hybrid classification system**.

```text
                 Bookmark
                     │
                     ▼
               Rules Engine
                     │
            ┌────────┴────────┐
            │                 │
       High confidence     Ambiguous
            │                 │
            ▼                 ▼
       Use rule             AI API
            │                 │
            └────────┬────────┘
                     ▼
                Classification
```

## 5.1 Rule-Based Classification

Some websites can be classified without AI.

Examples:

```text
github.com       → Programming
leetcode.com     → DSA
arxiv.org        → Research
youtube.com      → Video
react.dev        → Web Development
stackoverflow.com → Programming
```

This reduces AI API usage.

## 5.2 AI Classification

For ambiguous bookmarks, send relevant information to an AI model.

Possible inputs:

```text
URL
Page title
Meta description
Existing folder
Optional extracted text
```

The AI should return structured JSON.

Example:

```json
{
  "category": "Programming",
  "subcategory": "Web Development",
  "tags": [
    "Python",
    "FastAPI",
    "Backend"
  ],
  "confidence": 0.94
}
```

---

# 6. AI API Options

Possible free/prototyping options:

- NVIDIA Build / NIM API
- Gemini API
- A local model through Ollama

For the initial implementation, use the user's existing NVIDIA Build API key or Gemini API access.

## Recommended architecture

For a local personal prototype:

```text
Chrome Extension
       ↓
Local FastAPI server
       ↓
NVIDIA / Gemini API
```

Do **not** expose a production API key directly inside a publicly distributed Chrome extension.

---

# 7. AI Output

The AI should not directly modify bookmarks.

Instead, it should produce a **proposed organization plan**.

Example:

```json
{
  "folders": [
    {
      "name": "Programming",
      "children": [
        {
          "name": "Python",
          "bookmarks": [
            "FastAPI Documentation",
            "Python Tutorial"
          ]
        },
        {
          "name": "DSA",
          "bookmarks": [
            "LeetCode Two Sum"
          ]
        }
      ]
    },
    {
      "name": "Research",
      "children": [
        {
          "name": "Artificial Intelligence",
          "bookmarks": [
            "Transformer Paper"
          ]
        }
      ]
    }
  ]
}
```

---

# 8. Folder Organization Rules

The organizer should have constraints to prevent a messy folder structure.

Recommended rules:

```text
Maximum folder depth: 3
Maximum new top-level folders: 10
Avoid folders with only one bookmark
Avoid duplicate folders
Reuse existing folders when appropriate
Do not modify Chrome system folders
Do not delete bookmarks
Do not overwrite bookmark URLs
```

The user should be able to configure these later.

---

# 9. Preview Before Applying Changes

This is an important safety feature.

The flow should be:

```text
Analyze
   ↓
Generate proposed changes
   ↓
Show preview
   ↓
User reviews
   ↓
Apply Changes
```

Example UI:

```text
┌──────────────────────────────────────┐
│       Proposed Organization           │
├──────────────────────────────────────┤
│                                      │
│ + Programming                        │
│   + Python                           │
│     → FastAPI                        │
│     → Python Tutorial                │
│                                      │
│   + DSA                              │
│     → LeetCode Two Sum               │
│                                      │
│ + Research                           │
│   + AI                               │
│     → Transformer Paper              │
│                                      │
│ - Random                             │
│                                      │
│ [ Cancel ]          [ Apply Changes ]│
└──────────────────────────────────────┘
```

---

# 10. Applying Changes

After user approval, the extension uses the Chrome Bookmarks API.

Important APIs:

```javascript
chrome.bookmarks.create()
chrome.bookmarks.move()
chrome.bookmarks.update()
chrome.bookmarks.remove()
```

Example:

```text
Existing:

Random
├── FastAPI
├── LeetCode
└── AI Paper

        ↓ Organize

Programming
├── Python
│   └── FastAPI
└── DSA
    └── LeetCode

Research
└── AI
    └── AI Paper
```

The extension creates missing folders and moves bookmarks to them.

---

# 11. Folder Deletion

Folders should only be deleted according to explicit rules.

For example:

```text
Random
└── empty
```

can safely be removed after organization.

But a folder containing bookmarks should not be deleted until its bookmarks have been successfully moved.

Recommended sequence:

```text
Create required folders
       ↓
Move bookmarks
       ↓
Verify moves
       ↓
Delete empty folders
```

---

# 12. Backup and Undo

Before applying a large organization operation:

```text
Current Bookmark Tree
        ↓
Create Backup
        ↓
Apply Organization
```

Store the previous tree/action information in:

```text
chrome.storage.local
```

Then provide:

```text
Undo Last Organization
```

The undo system should restore bookmark locations and recreate folders that were removed.

---

# 13. Suggested Chrome Extension Structure

```text
bookmark-organizer/
│
├── manifest.json
│
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── background/
│   └── service-worker.js
│
├── organizer/
│   ├── bookmark-reader.js
│   ├── classifier.js
│   ├── organizer.js
│   └── backup.js
│
├── api/
│   └── client.js
│
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

# 14. Recommended Permissions

The extension will need appropriate Chrome extension permissions, especially:

```json
{
  "permissions": [
    "bookmarks",
    "storage",
    "tabs"
  ]
}
```

Only request permissions that are actually required.

---

# 15. Backend for the Prototype

A backend is optional for the basic extension.

## Version 1

```text
Chrome Extension
       ↓
Chrome Bookmarks API
       ↓
chrome.storage.local
```

No hosting required.

## Version 2

For AI classification:

```text
Chrome Extension
       ↓
localhost
       ↓
FastAPI
       ↓
NVIDIA / Gemini
```

Example:

```text
http://localhost:8000/classify
```

This keeps the API key outside the extension.

## Version 3

If the project eventually needs to work across devices:

```text
Chrome Extension
       ↓
Hosted API
       ↓
AI API
       ↓
Cloud Database
```

---

# 16. Recommended Technology Stack

## Extension

```text
JavaScript
Chrome Extensions Manifest V3
Chrome Bookmarks API
Chrome Storage API
```

## Backend

```text
Python
FastAPI
httpx
```

## AI

```text
NVIDIA NIM / Build API
or
Gemini API
```

## Database

Not required initially.

Later:

```text
PostgreSQL / MongoDB
```

---

# 17. Development Roadmap

## Phase 1 — Basic Extension

Goal:

```text
Click extension
      ↓
Show current page
      ↓
Click Save
      ↓
Bookmark created
```

No AI and no backend.

---

## Phase 2 — Bookmark Reader

Implement:

```javascript
chrome.bookmarks.getTree()
```

Display:

```text
All bookmarks
Folders
Bookmark count
```

---

## Phase 3 — Organizer Without AI

Implement simple rules:

```text
github.com → Programming
leetcode.com → DSA
youtube.com → Videos
arxiv.org → Research
```

Create/move folders automatically.

---

## Phase 4 — AI Classification

Add:

```text
NVIDIA / Gemini
```

Send ambiguous bookmarks for classification.

Require structured JSON output.

---

## Phase 5 — Preview

Add:

```text
Analyze
   ↓
Preview
   ↓
Approve
   ↓
Apply
```

---

## Phase 6 — Backup / Undo

Implement:

```text
Backup
Undo
Restore
```

---

## Phase 7 — Smart Organization

Add:

- Duplicate detection
- Automatic tags
- Page summaries
- Semantic search
- Related bookmarks
- Old/unused bookmark detection
- Custom organization rules
- Category suggestions
- "Organize only this folder"
- "Organize only new bookmarks"

---

# 18. Final User Flow

The final extension should provide two main actions.

## Save

```text
User is on webpage
       ↓
Click extension
       ↓
Click "Save"
       ↓
Bookmark saved
```

## Organize

```text
Click extension
       ↓
Click "Organize Bookmarks"
       ↓
Service Worker starts background analysis
       ↓
Live proportional progress reported (X/Y done, Z left)
       ↓
Rules classify obvious links (Tier 1)
       ↓
FastAPI Backend / AI classifies ambiguous links (Tier 2/3) with 7s timeout & circuit breaker
       ↓
Fallback heuristic classifies remaining items in 1ms (Tier 4)
       ↓
Generate proposed folder hierarchy plan
       ↓
Desktop system notification + "PLAN" badge on icon
       ↓
User reviews visual diff preview
       ↓
User clicks "Apply Changes"
       ↓
Automatic pre-move snapshot saved
       ↓
Create required folders
       ↓
Move bookmarks to destination folders
       ↓
Multi-pass bottom-up pruning sweeps empty folders (up to 3 passes)
       ↓
Desktop system notification + "DONE" badge on icon
```

---

# 19. Background Worker & Task Cancellation Flow

### 19.1 Asynchronous Background Arranging

```text
Popup UI                          Service Worker (Background)                   FastAPI Backend / AI
   │                                           │                                          │
   │─── START_ANALYSIS ───────────────────────►│                                          │
   │                                           │─── Read Bookmarks Bar                    │
   │                                           │─── Batch POST /classify ────────────────►│
   │                                           │◄── 25 items classified in ~1.5s ─────────│
   │◄── ANALYSIS_PROGRESS (X/Y done) ──────────│                                          │
   │                                           │─── Generate Hierarchy Plan               │
   │                                           │─── chrome.storage.local.set(plan)        │
   │                                           │─── chrome.notifications.create()         │
   │◄── ANALYSIS_COMPLETE ─────────────────────│                                          │
   ▼                                           ▼                                          ▼
Popup closes/opens seamlessly ───────────────► State persisted in storage across sessions
```

### 19.2 Stop / Cancel Process Flow

```text
User clicks "Stop Arranging"
        │
        ├──────────────────────────────────────────────┐
        ▼ (During Analysis)                            ▼ (During Bookmark Moves)
AbortController.abort()                        isCancelled() check triggers in move loop
        │                                              │
In-flight fetch cancelled                      Move loop breaks immediately
        │                                              │
Background analysis halted                     Prune newly created empty folders
        │                                              │
Clear pending storage state                    Preserve moved bookmarks safely
        │                                              │
Reset UI to idle controls                      Broadcast APPLY_CANCELLED (moves done)
        │                                              │
Toast: "Arranging cancelled"                   Toast: "Organization stopped after X moves"
```

---

# 20. Backend Resilience & Circuit Breaker Flow

```text
Incoming Batch of Ambiguous Bookmarks (25 items)
                    │
                    ▼
          Is Provider in Cooldown?
          ┌─────────┴─────────┐
      YES │                   │ NO
          ▼                   ▼
    Skip Cloud API        Call Cloud NIM / Gemini
          │                   │ (7-second timeout)
          │                   ├─────────────────────┬─────────────────────┐
          │               Success (200)         ReadTimeout           HTTP Error
          │                   │                     │                     │
          │             Return JSON          Engage 60s Cooldown   Engage 60s Cooldown
          │                   │                     │                     │
          └───────────────────┼─────────────────────┴─────────────────────┘
                              ▼
                Instant Semantic Heuristic Engine (1-2 ms)
                              │
                    Categorize into:
                    • Programming
                    • AI & Machine Learning
                    • Productivity & Tools
                    • Reading & News
                    • Shopping
                    • Career & Jobs
                    • Entertainment & Media
                              │
                              ▼
                Complete Classification Response
```

---

# 21. Core Principle

The most important architectural decision is:

> **Chrome Bookmarks remain the source of truth.**

The extension should organize Chrome's actual bookmarks rather than maintaining a second independent bookmark system.

This gives the project a simple, robust foundation:

```text
Chrome Bookmarks
       ▲
       │
       │ read / create / move / delete
       │
Chrome Extension (Service Worker + Glassmorphic Popup)
       │
       ▼
AI & Heuristic Classification
```

The AI and heuristic rules decide **where things belong**.

The Chrome Bookmarks API performs **the actual organization**.

The user remains in full control through **diff preview, stop controls, backups, and baseline rollback**.
