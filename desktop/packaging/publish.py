"""Publishes a built Flourishive Desktop so computers that already have it can update themselves.

    uv run python packaging/publish.py --version 0.3.0 \
        --windows FlourishiveDesktop-windows.zip --macos FlourishiveDesktop-macos.zip \
        [--notes "What changed"] [--min-version 0.2.0] [--sentry-dsn https://...]

Reads R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET from the environment.
The manifest is written last, so a half-finished upload is never offered to anyone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(version: str, files: dict[str, Path], notes: str, min_version: str | None, sentry_dsn: str | None) -> dict:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("--version must look like 1.2.3")
    manifest: dict = {"version": version, "files": {}}
    for platform, path in files.items():
        manifest["files"][platform] = {"key": f"releases/desktop/{version}/FlourishiveDesktop-{platform}.zip", "sha256": sha256_of(path)}
    if notes:
        manifest["notes"] = notes
    if min_version:
        manifest["minVersion"] = min_version
    if sentry_dsn:
        manifest["sentryDsn"] = sentry_dsn
    return manifest


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--version", required=True)
    p.add_argument("--windows", type=Path)
    p.add_argument("--macos", type=Path)
    p.add_argument("--notes", default="")
    p.add_argument("--min-version")
    p.add_argument("--sentry-dsn")
    a = p.parse_args()
    files = {k: v for k, v in (("windows", a.windows), ("macos", a.macos)) if v}
    if not files:
        raise SystemExit("Give --windows and/or --macos")
    manifest = build_manifest(a.version, files, a.notes, a.min_version, a.sentry_dsn)

    import boto3  # noqa: PLC0415

    s3 = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )
    bucket = os.environ["R2_BUCKET"]
    for platform, path in files.items():
        s3.upload_file(str(path), bucket, manifest["files"][platform]["key"], ExtraArgs={"ContentType": "application/zip"})
        print(f"uploaded {platform}: {manifest['files'][platform]['key']}")
    s3.put_object(Bucket=bucket, Key="releases/desktop/manifest.json", Body=json.dumps(manifest).encode(), ContentType="application/json")
    print(f"published {a.version}")


if __name__ == "__main__":
    main()
