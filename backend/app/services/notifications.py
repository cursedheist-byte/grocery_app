import json
import base64
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from ..config import settings
from ..models import Notification

_firebase_ready = False

def init_firebase():
    global _firebase_ready
    if not settings.firebase_credentials_json:
        return
    try:
        import firebase_admin
        from firebase_admin import credentials
        if not firebase_admin._apps:
            cred = credentials.Certificate(json.loads(settings.firebase_credentials_json))
            firebase_admin.initialize_app(cred)
        _firebase_ready = True
    except Exception:
        _firebase_ready = False

def create_notification(db, user_id: int, title: str, message: str):
    n = Notification(user_id=user_id, title=title, message=message)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n

def try_push(user_id: int, title: str, message: str):
    """Send a real FCM push to every device token registered by the user.

    Creates its own short-lived DB session so callers never need to pass one.
    Silently no-ops when Firebase is not configured or the user has no
    registered devices.
    """
    if not _firebase_ready:
        return False

    try:
        from firebase_admin import messaging
        from ..database import SessionLocal
        from ..models import PushToken
    except Exception:
        return False

    db = SessionLocal()
    try:
        tokens = [
            row.token
            for row in db.query(PushToken)
            .filter(PushToken.user_id == user_id)
            .all()
        ]
    finally:
        db.close()

    if not tokens:
        return False

    payload = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=message),
        data={"title": title, "body": message},
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                title=title,
                body=message,
                tag="store-notification",
            ),
        ),
    )

    try:
        response = messaging.send_each_for_multicast(payload)
        dead = [
            tokens[result.index]
            for result in response.responses
            if not result.success
            and result.exception
            and "registration-token-not-registered" in str(result.exception).lower()
        ]
        if dead:
            db = SessionLocal()
            try:
                db.query(PushToken).filter(PushToken.token.in_(dead)).delete(
                    synchronize_session=False
                )
                db.commit()
            finally:
                db.close()
        return response.success_count > 0
    except Exception:
        return False

def send_otp(phone: str, otp: str) -> bool:
    if not all((settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_phone)):
        return False
    phone = re.sub(r"[^\d+]", "", phone)
    if phone.isdigit() and len(phone) == 10:
        phone = f"+91{phone}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    body = urlencode({"To": phone, "From": settings.twilio_from_phone, "Body": f"Your grocery store login OTP is {otp}. It expires in {settings.otp_expire_minutes} minutes."}).encode()
    request = Request(url, data=body, method="POST")
    credentials = base64.b64encode(f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode()).decode()
    request.add_header("Authorization", f"Basic {credentials}")
    try:
        with urlopen(request, timeout=10):
            return True
    except Exception:
        return False
