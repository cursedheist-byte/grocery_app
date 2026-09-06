from fastapi import APIRouter, Depends, HTTPException
from decimal import Decimal
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Product, Category, OfflineSale, ShopSetting
from ..schemas import ProductIn, ProductOut
from ..auth.dependencies import admin_user

router = APIRouter(prefix="/api/products", tags=["products"])

@router.get("", response_model=list[ProductOut])
def products(search: str | None = None, category_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Product).filter(Product.is_available == True)
    if search: q = q.filter(Product.name.ilike(f"%{search}%"))
    if category_id: q = q.filter(Product.category_id == category_id)
    return q.order_by(Product.name).all()

@router.get("/admin", response_model=list[ProductOut])
def admin_products(db: Session = Depends(get_db), _=Depends(admin_user)): return db.query(Product).order_by(Product.name).all()

@router.post("", response_model=ProductOut)
def create_product(data: ProductIn, db: Session = Depends(get_db), _=Depends(admin_user)):
    if data.category_id and not db.get(Category, data.category_id): raise HTTPException(404,"Category not found")
    p=Product(**data.model_dump()); db.add(p); db.commit(); db.refresh(p); return p

@router.put("/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductIn, db: Session = Depends(get_db), _=Depends(admin_user)):
    p=db.get(Product,product_id)
    if not p: raise HTTPException(404,"Product not found")
    sale_mode = bool(db.query(ShopSetting.sale_mode).scalar())
    price_changed = Decimal(str(data.price)) != p.price
    if sale_mode and price_changed and p.original_price is None and data.original_price is None:
        # First price change while sale mode is on: remember the normal price.
        p.original_price = p.price
    for k,v in data.model_dump().items():
        # An explicitly provided normal price (original_price) wins over the auto snapshot.
        if k == "original_price" and v is None:
            # Empty normal-price field: leave the existing snapshot untouched.
            continue
        setattr(p,k,v)
    # Outside sale mode there are no discounts: clear any stale snapshot.
    if not sale_mode:
        p.original_price = None
    db.commit(); db.refresh(p); return p

@router.delete("/{product_id}")
def delete_product(product_id:int, db:Session=Depends(get_db), _=Depends(admin_user)):
    p=db.get(Product,product_id)
    if not p: raise HTTPException(404,"Product not found")
    db.delete(p); db.commit(); return {"message":"Product deleted"}

class StockAdjust(BaseModel):
    delta: int = Field(description="+ve adds stock, -ve is an offline sale")

class StockAdjustOut(BaseModel):
    id: int
    stock_quantity: int
    in_stock: bool
    sale_recorded: bool = False

@router.patch("/{product_id}/stock", response_model=StockAdjustOut)
def adjust_stock(product_id:int, data:StockAdjust, db:Session=Depends(get_db), _=Depends(admin_user)):
    """Instantly change stock from the offline-sales page. Negative delta = offline sale."""
    p=db.get(Product,product_id)
    if not p: raise HTTPException(404,"Product not found")
    if data.delta < 0 and p.stock_quantity + data.delta < 0:
        raise HTTPException(400,"Not enough stock")
    p.stock_quantity += data.delta
    p.in_stock = p.stock_quantity > 0
    sale=False
    if data.delta < 0:
        db.add(OfflineSale(product_id=p.id,product_name=p.name,quantity=-data.delta,total=p.price*(-data.delta)))
        sale=True
    db.commit(); db.refresh(p)
    return StockAdjustOut(id=p.id,stock_quantity=p.stock_quantity,in_stock=p.in_stock,sale_recorded=sale)
