from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime

VALID_STATUSES = {
    "checked_in", "inspection", "waiting_parts", "in_progress",
    "awaiting_warranty", "quality_check", "ready", "completed"
}

VALID_SENDER_TYPES = {"customer", "advisor"}

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


class VehicleCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    estimated_completion: Optional[str] = None

    @field_validator("customer_phone")
    @classmethod
    def phone_not_empty(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("customer_phone cannot be empty")
        return v

    @field_validator("year")
    @classmethod
    def year_sane(cls, v):
        if v is not None and not (1900 <= v <= 2100):
            raise ValueError("year must be between 1900 and 2100")
        return v


class StatusUpdate(BaseModel):
    new_status: str
    message: Optional[str] = None

    @field_validator("new_status")
    @classmethod
    def status_must_be_valid(cls, v):
        if v not in VALID_STATUSES:
            raise ValueError(f"new_status must be one of: {', '.join(sorted(VALID_STATUSES))}")
        return v


class MessageCreate(BaseModel):
    message_text: str
    sender_type: str

    @field_validator("sender_type")
    @classmethod
    def sender_type_must_be_valid(cls, v):
        if v not in VALID_SENDER_TYPES:
            raise ValueError("sender_type must be 'customer' or 'advisor'")
        return v

    @field_validator("message_text")
    @classmethod
    def message_not_empty(cls, v):
        if not v.strip():
            raise ValueError("message_text cannot be empty")
        return v


class ApprovalCreate(BaseModel):
    description: str
    cost: float

    @field_validator("cost")
    @classmethod
    def cost_non_negative(cls, v):
        if v < 0:
            raise ValueError("cost cannot be negative")
        return v

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v):
        if not v.strip():
            raise ValueError("description cannot be empty")
        return v


class ApprovalResponse(BaseModel):
    approved: bool


class VehicleResponse(BaseModel):
    vehicle_id: str
    customer_name: str
    customer_phone: str
    make: Optional[str]
    model: Optional[str]
    year: Optional[int]
    status: str
    estimated_completion: Optional[datetime]
    unique_link: str
    checked_in_at: datetime


class StatusResponse(BaseModel):
    success: bool
    message: str


class AppointmentCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    service_type: Optional[str] = None
    notes: Optional[str] = None
    scheduled_at: str
    duration_minutes: int = 60

    @field_validator("customer_name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("customer_name cannot be empty")
        return v.strip()

    @field_validator("customer_phone")
    @classmethod
    def apt_phone_not_empty(cls, v):
        if not v.strip():
            raise ValueError("customer_phone cannot be empty")
        return v.strip()

    @field_validator("duration_minutes")
    @classmethod
    def duration_positive(cls, v):
        if not (1 <= v <= 480):
            raise ValueError("duration_minutes must be 1–480")
        return v


class AppointmentStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def status_valid(cls, v):
        valid = {"scheduled", "confirmed", "cancelled", "completed", "no_show"}
        if v not in valid:
            raise ValueError(f"status must be one of: {', '.join(sorted(valid))}")
        return v


class ShopHourEntry(BaseModel):
    day_of_week: int  # 0=Sun, 1=Mon, …, 6=Sat
    open_time: str    # "08:00"
    close_time: str   # "17:00"
    slot_duration_minutes: int = 60
    max_concurrent: int = 3

    @field_validator("day_of_week")
    @classmethod
    def dow_valid(cls, v):
        if not 0 <= v <= 6:
            raise ValueError("day_of_week must be 0–6")
        return v


class BlockDateCreate(BaseModel):
    blocked_date: str   # YYYY-MM-DD
    reason: Optional[str] = None


class ShopCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    google_review_url: Optional[str] = None
    timezone: str = "America/Denver"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("name cannot be empty")
        return v


class UserInvite(BaseModel):
    email: str
    full_name: Optional[str] = None
    role: str = "advisor"
    shop_id: Optional[str] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v):
        if v not in {"admin", "advisor"}:
            raise ValueError("role must be 'admin' or 'advisor'")
        return v

    @field_validator("email")
    @classmethod
    def email_not_empty(cls, v):
        if not v.strip():
            raise ValueError("email cannot be empty")
        return v.strip().lower()


class UserUpdate(BaseModel):
    role: Optional[str] = None
    shop_id: Optional[str] = None
    active: Optional[bool] = None
    full_name: Optional[str] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v):
        if v is not None and v not in {"admin", "advisor"}:
            raise ValueError("role must be 'admin' or 'advisor'")
        return v
