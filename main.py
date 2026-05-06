import logging
import os
import uuid
from datetime import datetime

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from twilio.rest import Client

from database import get_supabase_client
from schemas import (
    VehicleCreate, VehicleResponse, StatusUpdate, MessageCreate,
    ApprovalCreate, ApprovalResponse, ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES,
)

load_dotenv()

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("shopsync")

# ── Config from env ───────────────────────────────────────────────────────────
PORTAL_URL = os.getenv("PORTAL_URL", "").rstrip("/")
SHOP_NAME = os.getenv("SHOP_NAME", "Summit Trucks")
GOOGLE_REVIEW_URL = os.getenv("GOOGLE_REVIEW_URL", "")
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="ShopSync API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Clients ───────────────────────────────────────────────────────────────────
supabase = get_supabase_client()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE = os.getenv("TWILIO_PHONE_NUMBER")
TWILIO_MESSAGING_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID")

if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
else:
    twilio_client = None
    logger.warning("Twilio credentials not configured — SMS disabled")


# ── Helpers ───────────────────────────────────────────────────────────────────

def send_sms(to_phone: str, message: str) -> bool:
    if not twilio_client:
        logger.info("sms_skipped", extra={"to": to_phone, "reason": "not_configured"})
        return False
    try:
        kwargs = {"body": message, "to": to_phone}
        if TWILIO_MESSAGING_SERVICE_SID:
            kwargs["messaging_service_sid"] = TWILIO_MESSAGING_SERVICE_SID
        else:
            kwargs["from_"] = TWILIO_PHONE
        msg = twilio_client.messages.create(**kwargs)
        logger.info(f"SMS sent sid={msg.sid} to={to_phone}")
        return True
    except Exception as e:
        logger.error(f"SMS failed to={to_phone} error={e}")
        return False


def _shop_sms_name(shop_id: str) -> str:
    """Best-effort shop name lookup; falls back to env var."""
    try:
        resp = supabase.table("shops").select("name").eq("shop_id", shop_id).execute()
        if resp.data:
            return resp.data[0]["name"]
    except Exception:
        pass
    return SHOP_NAME


def get_car_image(make, model, year):
    if not UNSPLASH_ACCESS_KEY:
        return None
    try:
        resp = requests.get(
            "https://api.unsplash.com/search/photos",
            params={"query": f"{year} {make} {model} car", "per_page": 1, "orientation": "landscape"},
            headers={"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"},
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data["results"]:
                return data["results"][0]["urls"]["regular"]
    except Exception as e:
        logger.warning(f"Unsplash fetch failed: {e}")
    return None


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    db_ok = False
    try:
        supabase.table("vehicles").select("vehicle_id").limit(1).execute()
        db_ok = True
    except Exception as e:
        logger.error(f"Health check DB error: {e}")

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "twilio": "configured" if twilio_client else "not_configured",
        "portal_url": PORTAL_URL or "NOT SET — SMS links will be broken",
    }


# ── Root ──────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "ShopSync API is running", "version": "1.0.0"}


# ── Shop endpoints ─────────────────────────────────────────────────────────────

@app.get("/shop/{shop_id}")
async def get_shop(shop_id: str):
    """Return shop branding info. Falls back to env vars if no shops table exists yet."""
    try:
        resp = supabase.table("shops").select("*").eq("shop_id", shop_id).execute()
        if resp.data:
            return resp.data[0]
    except Exception:
        pass
    # Graceful fallback — shops table may not exist yet
    return {
        "shop_id": shop_id,
        "name": SHOP_NAME,
        "google_review_url": GOOGLE_REVIEW_URL,
    }


@app.get("/shop/{shop_id}/vehicles")
async def get_shop_vehicles(shop_id: str):
    try:
        resp = supabase.table("vehicles").select("*").eq("shop_id", shop_id).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_shop_vehicles error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/shop/{shop_id}/dashboard-summary")
async def get_dashboard_summary(shop_id: str):
    """
    Single endpoint that replaces the N+1 polling pattern in the advisor dashboard.
    Returns all active vehicles with their message counts, approvals, and vehicle photos.
    """
    try:
        vehicles_resp = supabase.table("vehicles").select("*").eq("shop_id", shop_id).neq("status", "completed").execute()
        vehicles = vehicles_resp.data

        if not vehicles:
            return {"vehicles": [], "message_counts": {}, "approvals": {}, "photos": {}}

        vehicle_ids = [v["vehicle_id"] for v in vehicles]

        messages_resp = supabase.table("messages").select("vehicle_id,sender_type").in_("vehicle_id", vehicle_ids).execute()
        approvals_resp = supabase.table("approvals").select("*").in_("vehicle_id", vehicle_ids).execute()
        photos_resp = supabase.table("media").select("vehicle_id,media_url,caption").in_("vehicle_id", vehicle_ids).eq("caption", "vehicle_photo").execute()

        message_counts: dict = {}
        for msg in messages_resp.data:
            if msg["sender_type"] == "customer":
                vid = msg["vehicle_id"]
                message_counts[vid] = message_counts.get(vid, 0) + 1

        approvals_by_vehicle: dict = {}
        for approval in approvals_resp.data:
            vid = approval["vehicle_id"]
            approvals_by_vehicle.setdefault(vid, []).append(approval)

        photos: dict = {p["vehicle_id"]: p["media_url"] for p in photos_resp.data}

        return {
            "vehicles": vehicles,
            "message_counts": message_counts,
            "approvals": approvals_by_vehicle,
            "photos": photos,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_dashboard_summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Vehicle endpoints ──────────────────────────────────────────────────────────

@app.post("/vehicles/", response_model=VehicleResponse)
async def create_vehicle(vehicle: VehicleCreate, shop_id: str):
    try:
        unique_link = str(uuid.uuid4())

        resp = supabase.table("vehicles").insert({
            "shop_id": shop_id,
            "customer_name": vehicle.customer_name,
            "customer_phone": vehicle.customer_phone,
            "customer_email": vehicle.customer_email,
            "make": vehicle.make,
            "model": vehicle.model,
            "year": vehicle.year,
            "vin": vehicle.vin,
            "license_plate": vehicle.license_plate,
            "unique_link": unique_link,
            "status": "checked_in",
            "estimated_completion": vehicle.estimated_completion,
        }).execute()

        if not resp.data:
            raise HTTPException(status_code=400, detail="Failed to create vehicle")

        vehicle_data = resp.data[0]

        if PORTAL_URL:
            tracking_url = f"{PORTAL_URL}/track/{unique_link}"
            shop_name = _shop_sms_name(shop_id)
            sms_message = (
                f"Hi {vehicle.customer_name}! Your vehicle is checked in at {shop_name}. "
                f"Track its status here: {tracking_url}"
            )
            send_sms(vehicle.customer_phone, sms_message)
        else:
            logger.warning("PORTAL_URL not set — skipping check-in SMS")

        return VehicleResponse(**vehicle_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_vehicle error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{unique_link}")
async def get_vehicle_by_link(unique_link: str):
    try:
        resp = supabase.table("vehicles").select("*").eq("unique_link", unique_link).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_vehicle_by_link error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/vehicles/{vehicle_id}/status")
async def update_vehicle_status(vehicle_id: str, status_update: StatusUpdate, user_id: str):
    try:
        vehicle_resp = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        if not vehicle_resp.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")

        current_vehicle = vehicle_resp.data[0]
        old_status = current_vehicle["status"]

        supabase.table("vehicles").update({"status": status_update.new_status}).eq("vehicle_id", vehicle_id).execute()

        try:
            supabase.table("updates").insert({
                "vehicle_id": vehicle_id,
                "user_id": user_id,
                "old_status": old_status,
                "new_status": status_update.new_status,
                "message": status_update.message,
            }).execute()
        except Exception as update_err:
            logger.warning(f"Non-critical: failed to insert status update record: {update_err}")

        # No SMS when archiving
        if status_update.new_status == "completed":
            return {"success": True, "message": "Status updated successfully"}

        customer_phone = current_vehicle.get("customer_phone")
        customer_name = current_vehicle.get("customer_name", "Customer")
        shop_id = current_vehicle.get("shop_id", "")

        if customer_phone:
            shop_name = _shop_sms_name(shop_id)
            status_messages = {
                "checked_in": f"Hi {customer_name}! Your vehicle has been checked in at {shop_name}.",
                "inspection": "Update: Your vehicle is now being inspected.",
                "waiting_parts": "Update: Your vehicle is awaiting parts. We'll notify you when work resumes.",
                "in_progress": "Update: Your vehicle service is now in progress.",
                "awaiting_warranty": "Update: Your vehicle is awaiting warranty approval. We'll keep you posted.",
                "quality_check": "Update: Your vehicle is undergoing a final quality check.",
                "ready": f"Great news! Your vehicle is ready for pickup at {shop_name}. Thank you for your business!",
            }
            sms_body = status_messages.get(
                status_update.new_status,
                f"Update on your vehicle: {status_update.new_status.replace('_', ' ').title()}",
            )
            if status_update.message:
                sms_body += f"\n{status_update.message}"
            send_sms(customer_phone, sms_body)

        return {"success": True, "message": "Status updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_vehicle_status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/vehicles/{vehicle_id}/toggle-warranty")
async def toggle_warranty_status(vehicle_id: str):
    try:
        vehicle_resp = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        if not vehicle_resp.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")

        current_vehicle = vehicle_resp.data[0]
        new_warranty_status = not current_vehicle.get("awaiting_warranty", False)

        update_data = {
            "awaiting_warranty": new_warranty_status,
            "status": "awaiting_warranty" if new_warranty_status else "in_progress",
        }
        supabase.table("vehicles").update(update_data).eq("vehicle_id", vehicle_id).execute()

        customer_phone = current_vehicle.get("customer_phone")
        if customer_phone and new_warranty_status:
            send_sms(
                customer_phone,
                "Update: Your vehicle is awaiting warranty approval. We'll notify you once approved and work can continue.",
            )

        return {"success": True, "awaiting_warranty": new_warranty_status, "new_status": update_data["status"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"toggle_warranty_status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Message endpoints ──────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/messages")
async def create_message(vehicle_id: str, message: MessageCreate):
    try:
        resp = supabase.table("messages").insert({
            "vehicle_id": vehicle_id,
            "sender_type": message.sender_type,
            "message_text": message.message_text,
        }).execute()
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_message error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/messages")
async def get_messages(vehicle_id: str):
    try:
        resp = supabase.table("messages").select("*").eq("vehicle_id", vehicle_id).order("sent_at").execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_messages error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Media endpoints ────────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/media")
async def upload_media(
    vehicle_id: str,
    file: UploadFile = File(...),
    user_id: str = None,
    caption: str = None,
):
    try:
        # MIME-type guard
        if file.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"File type '{file.content_type}' is not allowed.",
            )

        # Size guard — read one byte past the limit to detect oversized files
        file_content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(file_content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the 50 MB upload limit.")

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        unique_filename = f"{vehicle_id}_{uuid.uuid4()}.{ext}"

        supabase.storage.from_("vehicle-photos").upload(
            unique_filename,
            file_content,
            {"content-type": file.content_type or "application/octet-stream"},
        )

        public_url = supabase.storage.from_("vehicle-photos").get_public_url(unique_filename)

        media_resp = supabase.table("media").insert({
            "vehicle_id": vehicle_id,
            "user_id": user_id,
            "media_type": "photo" if (file.content_type or "").startswith("image") else "video",
            "media_url": public_url,
            "caption": caption,
        }).execute()

        logger.info(f"Media uploaded: {public_url}")
        return {"success": True, "media_url": public_url, "media_id": media_resp.data[0]["media_id"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"upload_media error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/media")
async def get_media(vehicle_id: str):
    try:
        resp = supabase.table("media").select("*").eq("vehicle_id", vehicle_id).order("uploaded_at", desc=True).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_media error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Approval endpoints ─────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/approvals")
async def create_approval(vehicle_id: str, approval: ApprovalCreate):
    try:
        resp = supabase.table("approvals").insert({
            "vehicle_id": vehicle_id,
            "description": approval.description,
            "cost": approval.cost,
        }).execute()
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_approval error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/approvals/{approval_id}")
async def respond_to_approval(approval_id: str, response_data: ApprovalResponse):
    try:
        resp = supabase.table("approvals").update({
            "approved": response_data.approved,
            "approved_at": datetime.now().isoformat(),
        }).eq("approval_id", approval_id).execute()
        return {"success": True, "approved": response_data.approved}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"respond_to_approval error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/approvals")
async def get_approvals(vehicle_id: str):
    try:
        resp = supabase.table("approvals").select("*").eq("vehicle_id", vehicle_id).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_approvals error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
