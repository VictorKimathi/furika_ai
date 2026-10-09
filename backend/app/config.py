import os
from pathlib import Path


def _database_url() -> str:
    url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://furika:furika@localhost:5432/furika",
    )
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _gemini_model() -> str:
    value = os.getenv("GEMINI_MODEL", "")
    return value if value.startswith("gemini-") else "gemini-3.8-flash"


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "development-only-change-me")
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    RESTX_VALIDATE = True
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    RESTX_MASK_SWAGGER = False
    RESTX_ERROR_404_HELP = False
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]
    AI_PROVIDER = "claude"
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = _gemini_model()
    STORAGE_ROOT = os.getenv("STORAGE_ROOT", str(Path(__file__).resolve().parent.parent / "storage"))
    UPLOAD_MAX_BYTES = 20 * 1024 * 1024
    MAX_CONTENT_LENGTH = UPLOAD_MAX_BYTES + 1024 * 1024
    AI_MAPPING_AUTO_CONFIRM = 0.9
    INGESTION_ASYNC = True  # documents are extracted in a background thread
    REPORT_OWNER_EMAIL = os.getenv("REPORT_OWNER_EMAIL", "")
    REPORT_EMAIL_ENABLED = os.getenv("REPORT_EMAIL_ENABLED", "true").lower() == "true"
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "")
    SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() == "true"


class TestingConfig(Config):
    TESTING = True
    INGESTION_ASYNC = False
    REPORT_EMAIL_ENABLED = False
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
