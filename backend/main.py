"""
Chitragupta FastAPI AI Backend
Provides REST endpoints for bookmark classification and hierarchical organization.
"""

import sys
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from ai_service import (
    get_active_provider_info,
    classify_bookmarks,
    organize_hierarchy
)

app = FastAPI(
    title="Chitragupta — AI Bookmark Organizer API",
    description="Local AI Backend for Chrome Extension bookmark classification and organization",
    version="1.1.0"
)

# Enable CORS for Chrome Extensions and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BookmarkItem(BaseModel):
    id: Optional[str] = None
    url: str
    title: Optional[str] = "Untitled"
    folder: Optional[str] = ""


class ClassifyRequest(BaseModel):
    bookmarks: List[BookmarkItem] = Field(..., description="List of bookmarks to classify")


class OrganizeRequest(BaseModel):
    bookmarks: List[BookmarkItem] = Field(..., description="List of bookmarks to organize into hierarchy")


@app.get("/")
def root():
    return {
        "message": "Chitragupta AI Bookmark Organizer Backend is running.",
        "docs_url": "/docs",
        "health_url": "/health"
    }


@app.get("/health")
def health():
    """Health check endpoint to report server and AI provider status."""
    info = get_active_provider_info()
    return {
        "status": "healthy",
        "version": "1.1.0",
        **info
    }


@app.post("/classify")
async def classify_endpoint(payload: ClassifyRequest):
    """Categorizes a batch of bookmarks into structured categories and tags."""
    if not payload.bookmarks:
        raise HTTPException(status_code=400, detail="Bookmark list cannot be empty.")

    print(f"\n==================================================")
    print(f"[API] 📥 INCOMING REQUEST: POST /classify")
    print(f"      Total bookmarks to classify: {len(payload.bookmarks)}")
    for i, b in enumerate(payload.bookmarks[:5], 1):
        print(f"      {i}. \"{b.title}\" ({b.url})")
    if len(payload.bookmarks) > 5:
        print(f"      ... and {len(payload.bookmarks) - 5} more")

    items = [b.model_dump() for b in payload.bookmarks]
    try:
        results = await classify_bookmarks(items)
        print(f"[API] 📤 SENDING RESPONSE: {len(results)} items classified")
        print(f"==================================================\n")
        return {
            "status": "success",
            "count": len(results),
            "results": results
        }
    except Exception as e:
        print(f"[API] ❌ ERROR in /classify: {e}")
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


@app.post("/organize")
async def organize_endpoint(payload: OrganizeRequest):
    """Generates a complete proposed folder structure hierarchy for given bookmarks."""
    if not payload.bookmarks:
        raise HTTPException(status_code=400, detail="Bookmark list cannot be empty.")

    items = [b.model_dump() for b in payload.bookmarks]
    try:
        plan = await organize_hierarchy(items)
        return plan
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Organization planning failed: {str(e)}")
