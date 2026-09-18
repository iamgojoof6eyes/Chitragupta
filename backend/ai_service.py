"""
AI Service Module
Integrates NVIDIA NIM / Build API, Google Gemini, and smart local fallbacks.
Generates structured JSON classifications and folder hierarchies.
"""

import sys
import os
import time
import json
import re
from typing import List, Dict, Any, Optional
import httpx
from dotenv import load_dotenv

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

load_dotenv()

# Environment Configurations
AI_PROVIDER = os.getenv("AI_PROVIDER", "auto").lower()  # "nvidia", "gemini", "auto", "heuristic"
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "").strip()

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_NVIDIA_MODEL = "openai/gpt-oss-20b"
DEFAULT_GEMINI_MODEL = "gemini-1.5-flash"

# Circuit Breaker: Prevents hanging on failing/slow providers across batch chunks
_provider_cooldown_until: Dict[str, float] = {}

def is_provider_in_cooldown(provider: str) -> bool:
    """Checks if provider is temporarily suspended due to recent timeout/error."""
    return time.time() < _provider_cooldown_until.get(provider, 0.0)

def set_provider_cooldown(provider: str, duration_sec: float = 60.0):
    """Sets a cooldown period for a failing provider."""
    _provider_cooldown_until[provider] = time.time() + duration_sec
    print(f"[AI Circuit Breaker] ⚡ Marked provider '{provider}' in cooldown for {duration_sec}s.")


def get_active_provider_info() -> Dict[str, Any]:
    """Returns information on configured AI provider and API readiness."""
    has_nvidia = bool(NVIDIA_API_KEY)
    has_gemini = bool(GEMINI_API_KEY)

    active_provider = "Heuristic Engine"
    if AI_PROVIDER == "nvidia" and has_nvidia:
        active_provider = "NVIDIA NIM"
    elif AI_PROVIDER == "gemini" and has_gemini:
        active_provider = "Google Gemini"
    elif has_nvidia:
        active_provider = "NVIDIA NIM (Auto)"
    elif has_gemini:
        active_provider = "Google Gemini (Auto)"

    return {
        "provider": active_provider,
        "ai_configured": has_nvidia or has_gemini,
        "has_nvidia": has_nvidia,
        "has_gemini": has_gemini
    }


def clean_json_response(raw_text: str) -> str:
    """Extracts JSON string from markdown code blocks, reasoning chains, or text wrappers."""
    raw_text = raw_text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    if match:
        return match.group(1).strip()
    
    # Extract outermost JSON array if surrounded by reasoning / thinking text
    arr_match = re.search(r"(\[\s*\{[\s\S]*\}\s*\])", raw_text)
    if arr_match:
        return arr_match.group(1).strip()
    return raw_text


async def classify_with_nvidia(bookmarks: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Classifies bookmarks using NVIDIA NIM / Build API."""
    if not NVIDIA_API_KEY:
        print("[AI] ℹ️ No NVIDIA_API_KEY set, skipping NVIDIA NIM.")
        return None

    model = (AI_MODEL or DEFAULT_NVIDIA_MODEL).strip()
    url = f"{NVIDIA_BASE_URL}/chat/completions"
    print(f"\n[AI] 🚀 Dispatching to NVIDIA NIM:")
    print(f"     Model: {model}")
    print(f"     Items: {len(bookmarks)} bookmarks")

    system_prompt = (
        "You are an expert bookmark categorization engine. "
        "Categorize each bookmark into a clean, standardized taxonomy using categories such as: "
        "'Programming', 'AI & Machine Learning', 'Productivity & Tools', 'Reading & News', 'Shopping', 'Career & Jobs', 'Gaming', 'Entertainment & Media', 'Design & UI', or 'Education & Learning'. "
        "Do NOT retain messy legacy folder names or create isolated single-site folders. "
        "Return ONLY a valid JSON array of objects with keys: "
        "'id', 'category', 'subcategory', 'tags' (array of strings), 'confidence' (float 0-1). "
        "Do not include any conversational markdown or explanation outside the JSON."
    )

    user_content = json.dumps([
        {"id": b.get("id"), "url": b.get("url"), "title": b.get("title")}
        for b in bookmarks
    ], indent=2)

    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Classify these bookmarks:\n{user_content}"}
        ],
        "temperature": 0.2,
        "max_tokens": 1500
    }

    async with httpx.AsyncClient(timeout=7.0) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            clean_json = clean_json_response(content)
            parsed = json.loads(clean_json)
            print(f"[AI] ✨ NVIDIA NIM returned {len(parsed)} classifications successfully!")
            return parsed
        except Exception as e:
            set_provider_cooldown("nvidia", 60.0)
            print(f"[AI] ⚠️ NVIDIA NIM failed or timed out ({e.__class__.__name__}: {e}). Engaging 60s cooldown.")
            return None


async def classify_with_gemini(bookmarks: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Classifies bookmarks using Google Gemini REST API."""
    if not GEMINI_API_KEY:
        return None

    model = AI_MODEL or DEFAULT_GEMINI_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"

    prompt = (
        "You are an expert bookmark organizer. Categorize the following bookmarks into clean, standardized categories such as: "
        "'Programming', 'AI & Machine Learning', 'Productivity & Tools', 'Reading & News', 'Shopping', 'Career & Jobs', 'Gaming', 'Entertainment & Media', 'Design & UI', or 'Education & Learning'. "
        "Do NOT retain messy legacy folder names or create isolated single-site folders. "
        "Return ONLY a JSON array of objects: "
        "[{\"id\": \"...\", \"category\": \"...\", \"subcategory\": \"...\", \"tags\": [\"...\"], \"confidence\": 0.95}].\n\n"
        + json.dumps([{"id": b.get("id"), "url": b.get("url"), "title": b.get("title")} for b in bookmarks])
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }

    async with httpx.AsyncClient(timeout=7.0) as client:
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            clean_json = clean_json_response(text)
            return json.loads(clean_json)
        except Exception as e:
            set_provider_cooldown("gemini", 60.0)
            print(f"[AI] ⚠️ Gemini failed or timed out ({e}). Engaging 60s cooldown.")
            return None


def classify_with_heuristic(bookmark: Dict[str, Any]) -> Dict[str, Any]:
    """Semantic fallback heuristic classifier that categorizes bookmarks into standard taxonomies without preserving old messy folders."""
    url = (bookmark.get("url") or "").lower()
    title = (bookmark.get("title") or "").strip()

    combined = f"{url} {title.lower()}"

    cat, subcat, tags = "Productivity & Tools", "Web Resources", ["Web"]

    if any(k in combined for k in ["suno", "music", "audio", "vocal", "sound", "spotify", "soundcloud", "bandcamp"]):
        cat, subcat, tags = "Entertainment & Media", "Music & Audio", ["Audio"]
    elif any(k in combined for k in ["youtube", "video", "netflix", "twitch", "stream", "movie", "anime", "vimeo"]):
        cat, subcat, tags = "Entertainment & Media", "Video & Streaming", ["Video"]
    elif any(k in combined for k in ["chatgpt", "openai", "claude", "gemini", "deepseek", "replicate", "huggingface", "ai", "llm", "neural", "prompt", "skills.sh", "agent"]):
        cat, subcat, tags = "AI & Machine Learning", "Tools & Models", ["AI"]
    elif any(k in combined for k in ["leetcode", "hackerrank", "codewars", "codechef", "cssbattle", "dsa", "algorithm"]):
        cat, subcat, tags = "Programming", "DSA & Practice", ["DSA"]
    elif any(k in combined for k in ["github", "gitlab", "python", "react", "fastapi", "spring", "docker", "code", "dev", "api", "manim", "freebuff", "script", "w3resource"]):
        cat, subcat, tags = "Programming", "Development & Tools", ["Code"]
    elif any(k in combined for k in ["game", "nitro", "krunker", "skribbl", "repack", "codex", "fitgirl", "play"]):
        cat, subcat, tags = "Gaming", "Games", ["Gaming"]
    elif any(k in combined for k in ["amazon", "flipkart", "myntra", "ajio", "shop", "store", "buy", "cart", "deal", "price"]):
        cat, subcat, tags = "Shopping", "E-Commerce", ["Shopping"]
    elif any(k in combined for k in ["internshala", "indeed", "remotive", "upwork", "career", "job", "hiring", "resume", "work"]):
        cat, subcat, tags = "Career & Jobs", "Job Search", ["Career"]
    elif any(k in combined for k in ["canva", "figma", "icon", "font", "lucide", "tailwind", "ui", "design", "assets"]):
        cat, subcat, tags = "Design & UI", "Assets & Icons", ["Design"]
    elif any(k in combined for k in ["news", "article", "blog", "thesaurus", "dict", "post", "read", "book", "medium", "radar"]):
        cat, subcat, tags = "Reading & News", "Articles & Reference", ["Reference"]
    elif any(k in combined for k in ["convert", "pdf", "password", "proxy", "tool", "appetize", "util", "calc", "download", "osint"]):
        cat, subcat, tags = "Productivity & Tools", "Utilities", ["Tools"]
    elif any(k in combined for k in ["coursera", "udemy", "tutorial", "w3schools", "learn", "course"]):
        cat, subcat, tags = "Education & Learning", "Tutorials", ["Learning"]
    elif any(k in combined for k in ["google", "gmail", "drive", "docs", "sheets"]):
        cat, subcat, tags = "Productivity & Tools", "Google Services", ["Google"]
    else:
        cat, subcat, tags = "Productivity & Tools", "Web Resources", ["Web"]

    return {
        "id": bookmark.get("id"),
        "category": cat,
        "subcategory": subcat,
        "tags": tags,
        "confidence": 0.80,
        "source": "backend-heuristic"
    }


async def classify_bookmarks(bookmarks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Dispatches classification to active AI provider with graceful fallback."""
    # Attempt NVIDIA NIM if configured and not in cooldown
    if NVIDIA_API_KEY and AI_PROVIDER in ["nvidia", "auto"]:
        if not is_provider_in_cooldown("nvidia"):
            try:
                res = await classify_with_nvidia(bookmarks)
                if res and isinstance(res, list):
                    return res
            except Exception as e:
                set_provider_cooldown("nvidia", 60.0)
                print(f"[Warning] NVIDIA NIM classification failed: {e}")
        else:
            print("[AI Circuit Breaker] ⚡ Skipping NVIDIA NIM (cooldown active).")

    # Attempt Gemini if configured and not in cooldown
    if GEMINI_API_KEY and AI_PROVIDER in ["gemini", "auto"]:
        if not is_provider_in_cooldown("gemini"):
            try:
                res = await classify_with_gemini(bookmarks)
                if res and isinstance(res, list):
                    return res
            except Exception as e:
                set_provider_cooldown("gemini", 60.0)
                print(f"[Warning] Gemini API classification failed: {e}")
        else:
            print("[AI Circuit Breaker] ⚡ Skipping Gemini (cooldown active).")

    # Instant Fallback to smart heuristic classifier
    print(f"[AI] ⚙️ Applying smart heuristic classifier for {len(bookmarks)} bookmarks.")
    return [classify_with_heuristic(b) for b in bookmarks]


async def organize_hierarchy(bookmarks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generates structured folder hierarchy plan."""
    classified = await classify_bookmarks(bookmarks)

    # Group by category and subcategory
    folders_dict: Dict[str, Dict[str, List[Any]]] = {}

    for item in classified:
        cat = item.get("category", "General")
        sub = item.get("subcategory", "General")
        if cat not in folders_dict:
            folders_dict[cat] = {}
        if sub not in folders_dict[cat]:
            folders_dict[cat][sub] = []
        folders_dict[cat][sub].append(item)

    folders_list = []
    for cat_name, subcats in folders_dict.items():
        children = []
        for sub_name, items in subcats.items():
            children.append({
                "name": sub_name,
                "bookmarkCount": len(items),
                "bookmarkIds": [b.get("id") for b in items]
            })
        folders_list.append({
            "name": cat_name,
            "children": children
        })

    return {
        "status": "success",
        "totalBookmarks": len(bookmarks),
        "folders": folders_list,
        "classifications": classified
    }
