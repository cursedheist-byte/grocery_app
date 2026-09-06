import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User, Customer, Admin
from ..schemas import CustomerRegister, RegisterResponse, AdminLogin, TokenResponse, OtpRequest, OtpVerify, OtpResponse, CustomerTokenResponse, GoogleLogin
from ..auth.security import create_access_token, verify_password
from ..config import settings
from ..services.notifications import send_otp

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/google", response_model=CustomerTokenResponse)
def google_login(data: GoogleLogin, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(503, "Google login is not configured. Please contact the store administrator.")
    try:
        from google.auth.transport import requests
        from google.oauth2 import id_token
        payload = id_token.verify_oauth2_token(data.credential, requests.Request(), settings.google_client_id)
    except Exception:
        raise HTTPException(401, "Invalid Google login credential")
    google_sub = payload.get("sub")
    email = payload.get("email")
    name = data.real_name.strip()
    if not google_sub or not email or payload.get("email_verified") is not True:
        raise HTTPException(401, "Google account email is not verified")
    user = db.query(User).filter(User.google_sub == google_sub, User.role == "CUSTOMER").first()
    if not user:
        user = db.query(User).filter(User.email == email, User.role == "CUSTOMER").first()
    if not user:
        user = User(phone=f"google:{google_sub}", email=email, google_sub=google_sub, role="CUSTOMER")
        user.customer = Customer(name=name, verification_code=f"{secrets.randbelow(10000):04d}", verification_status="pending")
        db.add(user)
    else:
        user.google_sub = google_sub
        user.email = email
    db.commit()
    db.refresh(user)
    return CustomerTokenResponse(access_token=create_access_token(user.id, user.role), customer_id=user.customer.id, name=user.customer.name, phone=user.phone, role=user.role)

def _otp_hash(otp: str) -> str:
    return hashlib.sha256(f"{settings.secret_key}:{otp}".encode()).hexdigest()

@router.post("/request-otp", response_model=OtpResponse)
def request_otp(data: OtpRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == data.phone, User.role == "CUSTOMER").first()
    if not user:
        user = User(phone=data.phone, role="CUSTOMER")
        user.customer = Customer(name=data.name, verification_code=f"{secrets.randbelow(10000):04d}", verification_status="pending")
        db.add(user)
    otp = f"{secrets.randbelow(1000000):06d}"
    user.otp_hash = _otp_hash(otp)
    user.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_expire_minutes)
    user.otp_attempts = 0
    db.commit()
    delivered = send_otp(data.phone, otp)
    if not delivered:
        raise HTTPException(503, "SMS service is not configured or could not deliver the OTP. Please contact the store administrator.")
    return OtpResponse(message="OTP sent successfully")

@router.post("/verify-otp", response_model=CustomerTokenResponse)
def verify_otp(data: OtpVerify, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == data.phone, User.role == "CUSTOMER").first()
    now = datetime.now(timezone.utc)
    expires_at = user.otp_expires_at if user else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not user or not user.customer or not user.otp_hash or not expires_at or expires_at < now:
        raise HTTPException(401, "OTP expired or not requested")
    if user.otp_attempts >= 5:
        raise HTTPException(429, "Too many incorrect OTP attempts")
    if not hmac.compare_digest(user.otp_hash, _otp_hash(data.otp)):
        user.otp_attempts += 1
        db.commit()
        raise HTTPException(401, "Invalid OTP")
    user.otp_hash = None
    user.otp_expires_at = None
    user.otp_attempts = 0
    db.commit()
    return CustomerTokenResponse(access_token=create_access_token(user.id, user.role), customer_id=user.customer.id, name=user.customer.name, phone=user.phone, role=user.role)

@router.post("/register", response_model=RegisterResponse)
def register(data: CustomerRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.phone == data.phone).first():
        raise HTTPException(409, "A user with this phone number already exists")
    user = User(phone=data.phone, role="CUSTOMER")
    customer = Customer(name=data.name, verification_code=f"{secrets.randbelow(10000):04d}", verification_status="pending")
    user.customer = customer
    db.add(user)
    db.commit()
    db.refresh(user)
    return RegisterResponse(access_token=create_access_token(user.id, user.role), customer_id=customer.id, name=customer.name, phone=user.phone, verification_code=customer.verification_code, verification_status=customer.verification_status)

@router.post("/admin/login", response_model=TokenResponse)
def admin_login(data: AdminLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == data.phone, User.role == "ADMIN").first()
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid admin credentials")
    return TokenResponse(access_token=create_access_token(user.id, user.role), role=user.role)
