import os
import secrets
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ShopSetting
from ..schemas import ShopSettingsIn, ShopSettingsOut
from ..auth.dependencies import admin_user
from fastapi import HTTPException

router = APIRouter(prefix="/api/shop", tags=["shop"])

def get_settings(db):
    s = db.query(ShopSetting).first()
    if not s:
        s = ShopSetting(); db.add(s); db.commit(); db.refresh(s)
    return s

import json
@router.get("", response_model=ShopSettingsOut)
def read_shop(db: Session = Depends(get_db)):
    s = get_settings(db)
    if s.image_styles and isinstance(s.image_styles, str):
        try: s.image_styles = json.loads(s.image_styles)
        except ValueError: s.image_styles = None
    return s

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload-image")
def upload_image(request: Request, file: UploadFile = File(...), _=Depends(admin_user)):
    data = file.file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 5 MB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        kind = "png"
    elif data.startswith(b"\xff\xd8\xff"):
        kind = "jpeg"
    elif data[:6] in (b"GIF87a", b"GIF89a"):
        kind = "gif"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = "webp"
    else:
        kind = None

    if kind not in ("png", "jpeg", "gif", "webp"):
        raise HTTPException(400, "Only PNG, JPEG, GIF or WebP images are allowed")
    name = f"{secrets.token_hex(8)}.{kind}"
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(data)
    return {"url": str(request.base_url).rstrip("/") + f"/api/shop/static/uploads/{name}"}

@router.put("", response_model=ShopSettingsOut)
def update_shop(data: ShopSettingsIn, db: Session = Depends(get_db), _=Depends(admin_user)):
    from ..models import Product
    s = get_settings(db)
    turning_off = s.sale_mode and not data.sale_mode
    for k,v in data.model_dump().items():
        if k == "image_styles" and v is not None: v = json.dumps(v)
        setattr(s,k,v)
    if turning_off:
        # Sale ended: restore every product's pre-sale price.
        for p in db.query(Product).filter(Product.original_price.isnot(None)).all():
            p.price = p.original_price
            p.original_price = None
    db.commit(); db.refresh(s); return s
