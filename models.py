from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class Shop(BaseModel):
    shop_id: Optional[str] = None
    shop_name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    logo_url: Optional[str] = None
    created_at: Optional[datetime] = None

class User(BaseModel):
    user_id: Optional[str] = None
    shop_id: str
    email: str
    password_hash: str
    name: str
    role: Optional[str] = "advisor"
    created_at: Optional[datetime] = None

class Vehicle(BaseModel):
    vehicle_id: Optional[str] = None
    shop_id: str
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    unique_link: str
    status: Optional[str] = "checked_in"
    estimated_completion: Optional[datetime] = None
    checked_in_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

class Update(BaseModel):
    update_id: Optional[str] = None
    vehicle_id: str
    user_id: Optional[str] = None
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    message: Optional[str] = None
    timestamp: Optional[datetime] = None

class Media(BaseModel):
    media_id: Optional[str] = None
    vehicle_id: str
    user_id: Optional[str] = None
    media_type: str  # 'photo' or 'video'
    media_url: str
    caption: Optional[str] = None
    uploaded_at: Optional[datetime] = None

class Message(BaseModel):
    message_id: Optional[str] = None
    vehicle_id: str
    sender_type: str  # 'customer' or 'advisor'
    message_text: str
    read: Optional[bool] = False
    sent_at: Optional[datetime] = None

class Approval(BaseModel):
    approval_id: Optional[str] = None
    vehicle_id: str
    description: str
    cost: float
    approved: Optional[bool] = None
    approved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None