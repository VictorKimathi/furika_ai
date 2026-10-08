"""Raw file storage. Originals are written once, hashed, and never modified."""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import BinaryIO

EXTRACTORS = {".csv": "csv", ".xlsx": "excel", ".pdf": "pdf_text", ".txt": "text", ".md": "text"}
HEAD_BYTES = 8192


class StorageError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def save_stream(stream: BinaryIO, tmp_dir: Path, max_bytes: int) -> tuple[Path, str, int, bytes]:
    """Stream to a temporary file while hashing. Returns (path, sha256, size, first bytes)."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    head = b""
    with tempfile.NamedTemporaryFile(dir=tmp_dir, delete=False) as handle:
        path = Path(handle.name)
        try:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise StorageError("too_large", f"Files are limited to {max_bytes // (1024 * 1024)} MB.")
                if len(head) < HEAD_BYTES:
                    head += chunk[: HEAD_BYTES - len(head)]
                digest.update(chunk)
                handle.write(chunk)
        except Exception:
            handle.close()
            path.unlink(missing_ok=True)
            raise
    return path, digest.hexdigest(), size, head


def detect_extractor(filename: str, head: bytes) -> str:
    """Check the extension and the file's leading bytes agree before anything parses it."""
    extension = Path(filename).suffix.lower()
    extractor = EXTRACTORS.get(extension)
    if extractor is None:
        raise StorageError("wrong_type", f"Unsupported file type '{extension or filename}'. Use CSV, XLSX, PDF, TXT, or MD.")
    if extractor == "excel" and not head.startswith(b"PK\x03\x04"):
        raise StorageError("wrong_type", "The file has an .xlsx extension but is not an Excel workbook.")
    if extractor == "pdf_text" and not head.startswith(b"%PDF-"):
        raise StorageError("wrong_type", "The file has a .pdf extension but is not a PDF.")
    if extractor in ("csv", "text") and b"\x00" in head:
        raise StorageError("wrong_type", "The file looks binary, not text.")
    return extractor
