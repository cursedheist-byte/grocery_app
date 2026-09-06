from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User, Customer
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        payload = decode_token(credentials.credentials)
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not user.is_active:
        raise HTTPException(status_code=403, detail=f"Your account is banned. Reason: {user.ban_reason or 'No reason provided.'}")
    return user

def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

def verified_customer(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Customer:
    if user.role != "CUSTOMER" or not user.customer:
        raise HTTPException(status_code=403, detail="Customer access required")
    if user.customer.verification_status != "verified":
        raise HTTPException(status_code=403, detail="Customer account is not verified")
    return user.customer
