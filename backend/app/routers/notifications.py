from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Notification, Customer
from ..schemas import NotificationCreate, NotificationOut, PushTokenIn
from ..auth.dependencies import current_user, admin_user
from ..services.notifications import create_notification, try_push

router=APIRouter(prefix="/api/notifications",tags=["notifications"])

@router.post("/register-token")
def register_token(data:PushTokenIn,user=Depends(current_user),db:Session=Depends(get_db)):
    """Register (or refresh) the FCM device token of the logged-in user.
    Any other row holding the same token is removed first so a token can
    never belong to two accounts."""
    db.query(PushToken).filter(PushToken.token==data.token).delete()
    existing=db.query(PushToken).filter(PushToken.user_id==user.id,PushToken.platform==data.platform).first()
    if existing:
        existing.token=data.token
    else:
        db.add(PushToken(user_id=user.id,token=data.token,platform=data.platform))
    db.commit()
    return {"ok":True}

@router.delete("/register-token")
def unregister_token(data:PushTokenIn,user=Depends(current_user),db:Session=Depends(get_db)):
    db.query(PushToken).filter(PushToken.user_id==user.id,PushToken.token==data.token).delete()
    db.commit()
    return {"ok":True}

@router.get("/me",response_model=list[NotificationOut])
def mine(user=Depends(current_user),db:Session=Depends(get_db)): return db.query(Notification).filter(Notification.user_id==user.id).order_by(Notification.created_at.desc()).all()
@router.post("",response_model=NotificationOut)
def send(data:NotificationCreate,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,data.customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    n=create_notification(db,c.user_id,data.title,data.message); try_push(c.user_id,data.title,data.message); return n
@router.patch("/{notification_id}/read",response_model=NotificationOut)
def read(notification_id:int,user=Depends(current_user),db:Session=Depends(get_db)):
    n=db.get(Notification,notification_id)
    if not n or n.user_id!=user.id: raise HTTPException(404,"Notification not found")
    n.is_read=True; db.commit(); db.refresh(n); return n
