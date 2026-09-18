"""
Runner script for Chitragupta FastAPI Backend
Can run either as a persistent server or as a self-test.
"""

import sys
import os
import argparse

# Ensure current directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def run_self_test():
    """Runs synchronous in-memory self-test using Starlette TestClient."""
    try:
        from fastapi.testclient import TestClient
        from main import app
    except ImportError:
        print("[!] Installing missing dependencies for test...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        from fastapi.testclient import TestClient
        from main import app

    client = TestClient(app)
    print("== Testing GET /health ==")
    resp = client.get("/health")
    print("Status:", resp.status_code)
    print("Body:", resp.json())
    assert resp.status_code == 200, "Health check failed"

    print("\n== Testing POST /classify ==")
    payload = {
        "bookmarks": [
            {"id": "b1", "url": "https://fastapi.tiangolo.com/", "title": "FastAPI Documentation"},
            {"id": "b2", "url": "https://arxiv.org/abs/1706.03762", "title": "Attention Is All You Need"}
        ]
    }
    resp = client.post("/classify", json=payload)
    print("Status:", resp.status_code)
    print("Results:", resp.json())
    assert resp.status_code == 200, "Classify failed"

    print("\n== Testing POST /organize ==")
    resp = client.post("/organize", json=payload)
    print("Status:", resp.status_code)
    print("Folders:", resp.json().get("folders"))
    assert resp.status_code == 200, "Organize failed"

    print("\n[SUCCESS] All backend API self-tests passed cleanly!")


def run_server(host: str = "127.0.0.1", port: int = 8000, reload: bool = True):
    import uvicorn
    print(f"[*] Launching Chitragupta AI Backend on http://{host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chitragupta Backend Runner")
    parser.add_argument("--test", action="store_true", help="Run in-memory API self-test")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--no-reload", action="store_true", help="Disable auto-reload")

    args = parser.parse_args()

    if args.test:
        run_self_test()
    else:
        run_server(host=args.host, port=args.port, reload=not args.no_reload)
