import base64, hashlib, hmac, json, os
from datetime import datetime, timedelta, timezone
from ..config import settings

ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    salt=os.urandom(16); digest=hashlib.scrypt(password.encode(),salt=salt,n=2**14,r=8,p=1)
    return "scrypt$"+base64.urlsafe_b64encode(salt).decode()+"$"+base64.urlsafe_b64encode(digest).decode()

def verify_password(password: str, stored: str) -> bool:
    try:
        _,s,d=stored.split("$",2); salt=base64.urlsafe_b64decode(s); expected=base64.urlsafe_b64decode(d)
        return hmac.compare_digest(hashlib.scrypt(password.encode(),salt=salt,n=2**14,r=8,p=1),expected)
    except Exception: return False

def _b64(data: bytes)->str: return base64.urlsafe_b64encode(data).rstrip(b"=").decode()
def create_access_token(user_id: int, role: str) -> str:
    header=_b64(json.dumps({"alg":ALGORITHM,"typ":"JWT"},separators=(",",":")).encode())
    exp=int((datetime.now(timezone.utc)+timedelta(minutes=settings.access_token_expire_minutes)).timestamp())
    payload=_b64(json.dumps({"sub":str(user_id),"role":role,"exp":exp},separators=(",",":")).encode())
    sig=_b64(hmac.new(settings.secret_key.encode(),f"{header}.{payload}".encode(),hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"

def decode_token(token: str) -> dict:
    header,payload,sig=token.split(".")
    expected=_b64(hmac.new(settings.secret_key.encode(),f"{header}.{payload}".encode(),hashlib.sha256).digest())
    if not hmac.compare_digest(sig,expected): raise ValueError("Invalid signature")
    data=json.loads(base64.urlsafe_b64decode(payload+"="*(-len(payload)%4)))
    if int(data["exp"]) < int(datetime.now(timezone.utc).timestamp()): raise ValueError("Expired")
    return data
