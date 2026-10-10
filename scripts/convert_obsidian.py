#!/usr/bin/env python3
"""
Convert an Obsidian writeup (![[Pasted image ...]] embeds) into a Jekyll-ready
collection entry: rewrites embeds to standard Markdown/HTML image tags and
copies every referenced image into assets/<machines|engagements>/<slug>/.

Usage:
    python scripts/convert_obsidian.py SOURCE.md --type machine --slug fireflow
    python scripts/convert_obsidian.py SOURCE.md --type engagement --slug lab-a --images-dir "C:\\path\\to\\Imagenes"

See README.md for the full walkthrough.
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

EMBED_RE = re.compile(r"!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
SANITIZE_RE = re.compile(r"[^a-zA-Z0-9._-]+")

MACHINE_FRONT_MATTER = """---
title: "TODO"
date: 2026-01-01
os: Linux          # Linux | Windows
difficulty: Medium # Easy | Medium | Hard
tags: []
summary: "TODO: one or two sentences for the home page card."
platform: HTB
---

"""

ENGAGEMENT_FRONT_MATTER = """---
title: "TODO"
date: 2026-01-01
summary: "TODO: scenario summary for the home page card."
hosts:
  - name: HOST01
    os: Linux
    role: TODO
    ip: 10.10.10.10
---

"""


def find_image(filename: str, search_root: Path) -> Path | None:
    basename = Path(filename).name
    direct = search_root / filename
    if direct.is_file():
        return direct
    for candidate in search_root.rglob(basename):
        if candidate.is_file():
            return candidate
    return None


def sanitize_filename(name: str) -> str:
    """Markdown image destinations can't safely contain spaces, so normalize
    Obsidian's 'Pasted image 2026....png' into web-friendly names."""
    stem, suffix = Path(name).stem, Path(name).suffix.lower()
    stem = SANITIZE_RE.sub("-", stem).strip("-").lower()
    return f"{stem or 'image'}{suffix}"


def unique_destination(dest_dir: Path, basename: str) -> Path:
    candidate = dest_dir / basename
    if not candidate.exists():
        return candidate
    stem, suffix = Path(basename).stem, Path(basename).suffix
    i = 2
    while True:
        candidate = dest_dir / f"{stem}-{i}{suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def convert(source_md: Path, content_type: str, slug: str, images_dir: Path | None,
            repo_root: Path, dry_run: bool) -> None:
    text = source_md.read_text(encoding="utf-8")
    search_root = images_dir if images_dir else source_md.parent
    assets_dir = repo_root / "assets" / f"{content_type}s" / slug

    copied, missing, seen = [], [], {}

    def replace(match: re.Match) -> str:
        raw_name, pipe = match.group(1).strip(), match.group(2)
        basename = sanitize_filename(Path(raw_name).name)

        if raw_name not in seen:
            src = find_image(raw_name, search_root)
            if src is None:
                missing.append(raw_name)
                seen[raw_name] = None
            else:
                dest = unique_destination(assets_dir, basename)
                if not dry_run:
                    assets_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                copied.append((src, dest))
                seen[raw_name] = f"/assets/{content_type}s/{slug}/{dest.name}"

        new_path = seen[raw_name]
        if new_path is None:
            return match.group(0)  # leave untouched, flagged in `missing`

        if pipe and pipe.strip().isdigit():
            return f'<img src="{new_path}" alt="" width="{pipe.strip()}">'
        alt = pipe.strip() if pipe else ""
        return f"![{alt}]({new_path})"

    converted = EMBED_RE.sub(replace, text)

    front_matter = MACHINE_FRONT_MATTER if content_type == "machine" else ENGAGEMENT_FRONT_MATTER
    if not converted.lstrip().startswith("---"):
        converted = front_matter + converted

    dest_collection_dir = repo_root / f"_{content_type}s"
    dest_md = dest_collection_dir / f"{slug}.md"

    print(f"Images found & copied: {len(copied)}")
    for src, dest in copied:
        print(f"  {src.name}  ->  assets/{content_type}s/{slug}/{dest.name}")
    if missing:
        print(f"Images NOT found ({len(missing)}) — embed left as-is, fix manually:")
        for name in missing:
            print(f"  {name}")

    if dry_run:
        print(f"\n[dry run] would write: {dest_md}")
        return

    dest_collection_dir.mkdir(parents=True, exist_ok=True)
    dest_md.write_text(converted, encoding="utf-8")
    print(f"\nWritten: {dest_md}")
    print("Remember to fill in the TODO fields in the front matter.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_md", type=Path, help="Path to the original Obsidian .md file")
    parser.add_argument("--type", required=True, choices=["machine", "engagement"],
                         help="Content type / target collection")
    parser.add_argument("--slug", required=True,
                         help="URL slug, e.g. 'fireflow' -> _machines/fireflow.md")
    parser.add_argument("--images-dir", type=Path, default=None,
                         help="Folder to search for images (defaults to the .md file's own folder, searched recursively)")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parent.parent,
                         help="Repo root (defaults to the parent of this script's folder)")
    parser.add_argument("--dry-run", action="store_true",
                         help="Preview what would happen without writing/copying anything")
    args = parser.parse_args()

    if not args.source_md.is_file():
        sys.exit(f"Not a file: {args.source_md}")

    convert(args.source_md, args.type, args.slug, args.images_dir, args.repo_root, args.dry_run)


if __name__ == "__main__":
    main()
