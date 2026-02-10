import asyncio
import os
import sys

# ---- Diagnostics only (do NOT modify sys.path) ----
if getattr(sys, "frozen", False):
    # Nuitka standalone mode
    print("[Launcher] Frozen mode detected", file=sys.stderr)
    print(f"[Launcher] sys.executable: {sys.executable}", file=sys.stderr)
    print(f"[Launcher] sys.argv: {sys.argv}", file=sys.stderr)
    print(f"[Launcher] sys.path (first 5): {sys.path[:5]}", file=sys.stderr)
    print(f"[Launcher] CWD: {os.getcwd()}", file=sys.stderr)
else:
    # Development mode
    print("[Launcher] Development mode detected", file=sys.stderr)
    print(f"[Launcher] __file__: {__file__}", file=sys.stderr)
    print(f"[Launcher] CWD: {os.getcwd()}", file=sys.stderr)

# ---- Import worker ----
try:
    from scripts.core.worker import main

    print("[Launcher] Successfully imported worker module", file=sys.stderr)
except ImportError as e:
    print(f"[Launcher] FAILED to import worker: {e}", file=sys.stderr)
    print(f"[Launcher] sys.path: {sys.path}", file=sys.stderr)
    print(f"[Launcher] CWD: {os.getcwd()}", file=sys.stderr)

    # Extra visibility in frozen mode
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        try:
            print(
                f"[Launcher] Contents of exe dir: {os.listdir(exe_dir)}",
                file=sys.stderr,
            )
        except Exception as list_err:
            print(f"[Launcher] Could not list exe dir: {list_err}", file=sys.stderr)

    raise

# ---- Entrypoint ----
if __name__ == "__main__":
    asyncio.run(main())
