from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from database import get_supabase_client
from schemas import *
from typing import List
import uuid
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
from twilio.rest import Client
import requests

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="ShopSync API", version="1.0.0")

# Enable CORS (so frontend can talk to backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get Supabase client
supabase = get_supabase_client()

# Initialize Twilio client
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE = os.getenv("TWILIO_PHONE_NUMBER")

if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
else:
    twilio_client = None

# Feature flag: enable/disable status-change SMS notifications
# Set ENABLE_STATUS_SMS=true in your Render env once A2P is approved
ENABLE_STATUS_SMS = os.getenv("ENABLE_STATUS_SMS", "false").lower() == "true"


def send_sms(to_phone: str, message: str):
    """Send SMS notification to customer"""
    if not twilio_client:
        print(f"Twilio not configured. Would send: {message} to {to_phone}")
        return False
    
    try:
        msg = twilio_client.messages.create(
            body=message,
            from_=TWILIO_PHONE,
            to=to_phone
        )
        print(f"SMS sent successfully! SID: {msg.sid}")
        return True
    except Exception as e:
        print(f"Failed to send SMS: {e}")
        return False

# Get Unsplash API key
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")

def get_car_image(make, model, year):
    """Fetch car image from Unsplash based on make/model"""
    if not UNSPLASH_ACCESS_KEY:
        return None
    
    try:
        # Search query
        query = f"{year} {make} {model} car"
        
        url = "https://api.unsplash.com/search/photos"
        params = {
            "query": query,
            "per_page": 1,
            "orientation": "landscape"
        }
        headers = {
            "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"
        }
        
        response = requests.get(url, params=params, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            if data["results"]:
                return data["results"][0]["urls"]["regular"]
        
        return None
    except Exception as e:
        print(f"Error fetching car image: {e}")
        return None

# ==================== SHOP ENDPOINTS ====================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "ShopSync API is running", "version": "1.0.0"}

@app.get("/health")
async def health():
    """Health check endpoint for monitoring"""
    return {"status": "healthy"}

# ==================== VEHICLE ENDPOINTS ====================

@app.post("/vehicles/", response_model=VehicleResponse)
async def create_vehicle(vehicle: VehicleCreate, shop_id: str):
    """
    Create a new vehicle and send SMS notification to customer
    """
    try:
        # Generate unique link for customer portal
        unique_link = str(uuid.uuid4())
        
        # Insert vehicle into database
        response = supabase.table("vehicles").insert({
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
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create vehicle")
        
        vehicle_data = response.data[0]
        
        # Send SMS notification to customer
        portal_url = f"https://frontend-dusky-omega-j8xii0qafc.vercel.app/track/{unique_link}"
        sms_message = f"Hi {vehicle.customer_name}! Your vehicle is checked in at Summit Trucks. Track its status here: {portal_url}"
        print(f"DEBUG: Attempting to send SMS to {vehicle.customer_phone}")
        print(f"DEBUG: Message: {sms_message}")
        result = send_sms(vehicle.customer_phone, sms_message)
        print(f"DEBUG: SMS send result: {result}")
        
        return VehicleResponse(**vehicle_data)
    
    except Exception as e:
        print(f"ERROR creating vehicle: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{unique_link}")
async def get_vehicle_by_link(unique_link: str):
    """
    Get vehicle details by unique link (for customer portal)
    """
    try:
        response = supabase.table("vehicles").select("*").eq("unique_link", unique_link).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/shop/{shop_id}/vehicles")
async def get_shop_vehicles(shop_id: str):
    """
    Get all vehicles for a shop (for service advisor dashboard)
    """
    try:
        response = supabase.table("vehicles").select("*").eq("shop_id", shop_id).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/vehicles/{vehicle_id}/status")
async def update_vehicle_status(vehicle_id: str, status_update: StatusUpdate, user_id: str):
    """
    Update vehicle status and create an update record.

    - Core DB update should ALWAYS succeed/return correctly if possible.
    - SMS notifications are optional and controlled by ENABLE_STATUS_SMS.
    - SMS failures must NEVER break the request.
    """
    # --- DB work first ---
    try:
        # Get current vehicle data
        vehicle_response = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        
        if not vehicle_response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        current_vehicle = vehicle_response.data[0]
        old_status = current_vehicle["status"]
        
        # Update vehicle status
        supabase.table("vehicles").update({
            "status": status_update.new_status
        }).eq("vehicle_id", vehicle_id).execute()
        
        # Create update record
        supabase.table("updates").insert({
            "vehicle_id": vehicle_id,
            "user_id": user_id,
            "old_status": old_status,
            "new_status": status_update.new_status,
            "message": status_update.message
        }).execute()
    
    except HTTPException:
        # Preserve explicit HTTP errors (like 404)
        raise
    except Exception as e:
        print(f"ERROR updating vehicle status: {e}")
        raise HTTPException(status_code=500, detail="Failed to update vehicle status")
    
    # --- Optional: SMS, gated + non-fatal ---
    if ENABLE_STATUS_SMS:
        try:
            sms_message = f"Update on your vehicle: {status_update.new_status.replace('_', ' ').title()}"
            if status_update.message:
                sms_message += f" - {status_update.message}"
            
            customer_phone = current_vehicle.get("customer_phone", "")
            sms_result = send_sms(customer_phone, sms_message)
            print(f"DEBUG: Status SMS result for vehicle {vehicle_id}: {sms_result}")
        except Exception as sms_error:
            # SMS errors are logged but do not affect the API response
            print(f"SMS notification failed for vehicle {vehicle_id}: {sms_error}")
    
    return {"success": True, "message": "Status updated successfully"}

@app.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str):
    """
    Delete a vehicle from the system
    """
    try:
        # Delete related records first (messages, media, approvals, service records)
        supabase.table("messages").delete().eq("vehicle_id", vehicle_id).execute()
        supabase.table("media").delete().eq("vehicle_id", vehicle_id).execute()
        supabase.table("approvals").delete().eq("vehicle_id", vehicle_id).execute()
        supabase.table("service_records").delete().eq("vehicle_id", vehicle_id).execute()
        
        # Delete the vehicle
        response = supabase.table("vehicles").delete().eq("vehicle_id", vehicle_id).execute()
        
        return {"success": True, "message": "Vehicle deleted successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== MESSAGE ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/messages")
async def create_message(vehicle_id: str, message: MessageCreate):
    """
    Create a new message (from customer or advisor)
    """
    try:
        response = supabase.table("messages").insert({
            "vehicle_id": vehicle_id,
            "sender_type": message.sender_type,
            "message_text": message.message_text
        }).execute()
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/messages")
async def get_messages(vehicle_id: str):
    """
    Get all messages for a vehicle
    """
    try:
        response = supabase.table("messages").select("*").eq("vehicle_id", vehicle_id).order("sent_at").execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== MEDIA ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/media")
async def upload_media(
    vehicle_id: str, 
    file: UploadFile = File(...), 
    user_id: str = None, 
    caption: str = None
):
    """
    Upload photo or video for a vehicle to Supabase Storage
    """
    try:
        # Read file content
        file_content = await file.read()
        
        # Generate unique filename
        file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        unique_filename = f"{vehicle_id}_{uuid.uuid4()}.{file_extension}"
        
        # Upload to Supabase Storage
        storage_response = supabase.storage.from_('vehicle-photos').upload(
            unique_filename,
            file_content,
            {
                'content-type': file.content_type or 'image/jpeg'
            }
        )
        
        # Get public URL
        public_url = supabase.storage.from_('vehicle-photos').get_public_url(unique_filename)
        
        # Save media record to database
        media_response = supabase.table("media").insert({
            "vehicle_id": vehicle_id,
            "user_id": user_id,
            "media_type": "photo" if file.content_type and file.content_type.startswith("image") else "video",
            "media_url": public_url,
            "caption": caption
        }).execute()
        
        print(f"Media uploaded successfully: {public_url}")
        
        return {
            "success": True,
            "media_url": public_url,
            "media_id": media_response.data[0]["media_id"]
        }
    
    except Exception as e:
        print(f"Error uploading media: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/media")
async def get_media(vehicle_id: str):
    """
    Get all media for a vehicle
    """
    try:
        response = supabase.table("media").select("*").eq("vehicle_id", vehicle_id).order("uploaded_at", desc=True).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== APPROVAL ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/approvals")
async def create_approval(vehicle_id: str, approval: ApprovalCreate):
    """
    Create an approval request for additional work
    """
    try:
        response = supabase.table("approvals").insert({
            "vehicle_id": vehicle_id,
            "description": approval.description,
            "cost": approval.cost
        }).execute()
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/approvals/{approval_id}")
async def respond_to_approval(approval_id: str, response_data: ApprovalResponse):
    """
    Customer approves or declines additional work
    """
    try:
        response = supabase.table("approvals").update({
            "approved": response_data.approved,
            "approved_at": datetime.now().isoformat()
        }).eq("approval_id", approval_id).execute()
        
        return {"success": True, "approved": response_data.approved}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/approvals")
async def get_approvals(vehicle_id: str):
    """
    Get all approval requests for a vehicle
    """
    try:
        response = supabase.table("approvals").select("*").eq("vehicle_id", vehicle_id).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== SERVICE RECORD ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/service")
async def create_service_record(vehicle_id: str, service: ServiceRecordCreate):
    """
    Log a service record (like oil change) and schedule reminder
    """
    try:
        # Get vehicle data for customer info
        vehicle_response = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        
        if not vehicle_response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        vehicle = vehicle_response.data[0]
        
        # Calculate next reminder date if interval provided
        next_reminder_date = None
        if service.reminder_interval_months:
            next_reminder_date = (datetime.now() + timedelta(days=30 * service.reminder_interval_months)).isoformat()
        
        # Insert service record
        response = supabase.table("service_records").insert({
            "vehicle_id": vehicle_id,
            "service_type": service.service_type,
            "current_mileage": service.current_mileage,
            "next_service_mileage": service.next_service_mileage,
            "reminder_interval_months": service.reminder_interval_months,
            "next_reminder_date": next_reminder_date,
            "notes": service.notes,
            "reminder_sent": False
        }).execute()
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create service record")
        
        service_data = response.data[0]
        
        # Send confirmation SMS to customer
        service_type_readable = service.service_type.replace('_', ' ').title()
        sms_message = f"Service completed: {service_type_readable} at {service.current_mileage:,} miles."
        
        if service.next_service_mileage:
            sms_message += f" Next service due at {service.next_service_mileage:,} miles"
        
        if service.reminder_interval_months:
            sms_message += f" or in {service.reminder_interval_months} months"
        
        sms_message += ". We'll remind you when it's time! - Summit Trucks"
        
        send_sms(vehicle["customer_phone"], sms_message)
        
        return ServiceRecordResponse(**service_data)
    
    except Exception as e:
        print(f"ERROR creating service record: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/service")
async def get_service_records(vehicle_id: str):
    """
    Get all service records for a vehicle
    """
    try:
        response = supabase.table("service_records").select("*").eq("vehicle_id", vehicle_id).order("performed_at", desc=True).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/service-reminders/due")
async def get_due_reminders():
    """
    Get all service reminders that are due (for cron job)
    """
    try:
        # Get records where next_reminder_date is today or earlier and reminder not sent
        today = datetime.now().isoformat()
        
        response = supabase.table("service_records").select("*, vehicles(*)").lte("next_reminder_date", today).eq("reminder_sent", False).execute()
        
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/service-reminders/send")
async def send_service_reminders():
    """
    Send SMS reminders for all due services (called by cron job)
    """
    try:
        # Get due reminders
        due_reminders = await get_due_reminders()
        
        sent_count = 0
        
        for record in due_reminders:
            vehicle = record.get("vehicles")
            if not vehicle:
                continue
            
            # Build reminder message
            service_type = record["service_type"].replace('_', ' ').title()
            message = f"Reminder: Your {vehicle['year']} {vehicle['make']} {vehicle['model']} "
            
            if record["next_service_mileage"]:
                message += f"is due for {service_type} at {record['next_service_mileage']:,} miles. "
            else:
                message += f"is due for {service_type}. "
            
            message += "Reply YES to schedule or call Summit Trucks!"
            
            # Send SMS
            if send_sms(vehicle["customer_phone"], message):
                # Mark reminder as sent
                supabase.table("service_records").update({
                    "reminder_sent": True
                }).eq("service_id", record["service_id"]).execute()
                
                sent_count += 1
        
        return {"success": True, "reminders_sent": sent_count}
    
    except Exception as e:
        print(f"ERROR sending reminders: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== RUN THE APP ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

