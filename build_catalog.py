#!/usr/bin/env python3
"""
build_catalog.py — scan data/ and emit catalog.js for the unified prompt viewer.

Every .jsonl / .json file under data/ is included:
  - flat families   → base file + all extension1..3 variants
  - directory datasets (owner:name) → all their files

Output: catalog.js, loaded via a <script> tag (works on file:// and over HTTP/S3
alike). It defines:
  window.CATALOG = { datasets: [ {id, kind, Name, files:[{name,path,format,size,records}]} ] }
  window.OFFSETS = { "<file path>": {line_count, stride, byte_size, offsets:[...]} }   // files >= 12 MB

The offset map lets the viewer read any page of a multi-GB JSONL by fetching a
single byte window (HTTP Range when served, File.slice when opened from disk).

Reading every file (incl. the multi-GB extensions) is expensive, so results are
cached in .catalog_cache.json keyed by (size, mtime). Unchanged files are not
re-read — so the first build is slow but later ones (e.g. on each server start)
are fast.

Usage:  python3 build_catalog.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CATALOG_JS_PATH = ROOT / "catalog.js"
CACHE_PATH = ROOT / ".catalog_cache.json"

# JSONL files at/above this size get a byte-offset index (must match the
# viewer's LARGE_WHOLE_FILE_LIMIT so indexed == streamed).
LARGE_FILE_BYTES = 12 * 1024 * 1024
OFFSET_STRIDE = 500
DATA_EXTS = {".jsonl", ".json"}
EXT_RE = re.compile(r"-extension\d+$", re.IGNORECASE)

OFFSETS = {}  # file rel-path -> offset index, inlined into catalog.js


def detect_format(path: Path) -> str:
    if path.suffix.lower() == ".jsonl":
        return "jsonl"
    with path.open("rb") as f:
        head = f.read(64).lstrip()
    return "json" if head[:1] in (b"[", b"{") else "jsonl"


def compute_offset_index(path: Path):
    """Stream a large JSONL once: count lines and record the byte offset of
    every OFFSET_STRIDE-th line. Returns (line_count, index dict)."""
    offsets = [0]
    pos = 0
    idx = 0
    with path.open("rb") as f:
        for line in f:
            idx += 1
            pos += len(line)
            if idx % OFFSET_STRIDE == 0:
                offsets.append(pos)
    return idx, {"line_count": idx, "stride": OFFSET_STRIDE, "byte_size": pos, "offsets": offsets}


def count_jsonl_lines(path: Path) -> int:
    n = 0
    with path.open("rb") as f:
        for _ in f:
            n += 1
    return n


def json_array_len(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        data = json.load(f)
    return len(data) if isinstance(data, list) else 1


def file_metadata(path: Path, old_cache: dict, new_cache: dict):
    rel = path.relative_to(ROOT).as_posix()
    st = path.stat()
    size, mtime = st.st_size, int(st.st_mtime)
    fmt = detect_format(path)

    cached = old_cache.get(rel)
    if cached and cached.get("size") == size and cached.get("mtime") == mtime:
        records = cached["records"]
        if cached.get("offsets"):
            OFFSETS[rel] = cached["offsets"]
        new_cache[rel] = cached
    else:
        offsets = None
        if fmt == "jsonl":
            if size >= LARGE_FILE_BYTES:
                print(f"    indexing {rel} ({size // (1024*1024)} MB)…")
                records, offsets = compute_offset_index(path)
                OFFSETS[rel] = offsets
            else:
                records = count_jsonl_lines(path)
        else:
            records = json_array_len(path)
        new_cache[rel] = {"size": size, "mtime": mtime, "records": records, "offsets": offsets}

    return {"name": path.name, "path": rel, "format": fmt, "size": size, "records": records}


def data_files_in(directory: Path):
    return [p for p in sorted(directory.iterdir())
            if p.is_file() and p.suffix.lower() in DATA_EXTS and not p.name.startswith(".")]


def family_of(stem: str) -> str:
    return EXT_RE.sub("", stem)


def main():
    if not DATA_DIR.is_dir():
        raise SystemExit(f"data dir not found: {DATA_DIR}")

    OFFSETS.clear()  # safe to call repeatedly (e.g. from serve.py)
    try:
        old_cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
    except Exception:
        old_cache = {}
    new_cache = {}

    dirs = sorted(p for p in DATA_DIR.iterdir() if p.is_dir())
    flat = sorted(p for p in DATA_DIR.iterdir()
                  if p.is_file() and p.suffix.lower() in DATA_EXTS and not p.name.startswith("."))

    families = {}
    for p in flat:
        families.setdefault(family_of(p.stem), []).append(p)

    entries = []

    for d in dirs:  # directory datasets: all files
        files = data_files_in(d)
        if not files:
            continue
        entries.append({"id": d.name, "kind": "directory", "Name": d.name,
                        "files": [file_metadata(f, old_cache, new_cache) for f in files]})
        print(f"  {d.name}: {len(files)} files")

    for fam in sorted(families):  # flat families: base + all extensions
        members = families[fam]
        base = next((p for p in members if p.stem == fam), None)
        ordered = ([base] if base else []) + sorted(p for p in members if p is not base)
        entries.append({"id": fam, "kind": "family", "Name": fam,
                        "files": [file_metadata(f, old_cache, new_cache) for f in ordered]})
        print(f"  {fam}: {len(ordered)} files")

    entries.sort(key=lambda e: e["Name"].lower())
    payload = {"generated_by": "build_catalog.py", "datasets": entries}

    with CATALOG_JS_PATH.open("w", encoding="utf-8") as f:
        f.write("// Generated by build_catalog.py — do not edit by hand.\n")
        f.write("window.CATALOG = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\nwindow.OFFSETS = ")
        json.dump(OFFSETS, f, ensure_ascii=False)
        f.write(";\n")

    CACHE_PATH.write_text(json.dumps(new_cache))

    total = sum(fm["records"] for e in entries for fm in e["files"])
    print(f"\nWrote {CATALOG_JS_PATH}: {len(entries)} datasets, "
          f"{sum(len(e['files']) for e in entries)} files, {total:,} prompts, {len(OFFSETS)} indexed.")


if __name__ == "__main__":
    main()
