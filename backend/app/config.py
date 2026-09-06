from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

class Settings(BaseSettings):
    database_url: str = "sqlite:///./grocery.db"
    secret_key: str = "change-this-development-secret"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: str = "http://localhost:5173,http://localhost:5174"
    admin_name: str = "Store Admin"
    admin_phone: str = "9999999999"
    admin_password: str = "ChangeMe123!"
    firebase_credentials_json: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_phone: str | None = None
    otp_expire_minutes: int = 5
    google_client_id: str | None = None
    google_ai_api_key: str | None = None
    google_ai_model: str = "gemma-4-31b-it"
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

settings = Settings()
