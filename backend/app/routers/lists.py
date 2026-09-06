from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..models import ShoppingList, ShoppingListItem, Product, Address, Order, OrderItem, User, Notification
from ..auth.dependencies import verified_customer
from ..services.notifications import create_notification

router=APIRouter(prefix="/api/lists",tags=["lists"])

class ListItemIn(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=100)

class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    items: list[ListItemIn] = []

class ListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    items: list[ListItemIn] | None = None

class ListOutItem(BaseModel):
    product_id: int
    quantity: int

class ListOut(BaseModel):
    id: int
    name: str
    items: list[ListOutItem]

def _serialize(l:ShoppingList)->ListOut:
    return ListOut(id=l.id,name=l.name,items=[ListOutItem(product_id=i.product_id,quantity=i.quantity) for i in l.items])

@router.get("",response_model=list[ListOut])
def my_lists(c=Depends(verified_customer),db:Session=Depends(get_db)):
    rows=db.query(ShoppingList).options(joinedload(ShoppingList.items)).filter(ShoppingList.customer_id==c.id).order_by(ShoppingList.created_at.desc()).all()
    return [_serialize(l) for l in rows]

@router.post("",response_model=ListOut)
def create_list(data:ListIn,c=Depends(verified_customer),db:Session=Depends(get_db)):
    l=ShoppingList(customer_id=c.id,name=data.name.strip())
    db.add(l); db.flush()
    seen=set()
    for it in data.items:
        if it.product_id in seen: continue
        seen.add(it.product_id)
        db.add(ShoppingListItem(list_id=l.id,product_id=it.product_id,quantity=it.quantity))
    db.commit(); db.refresh(l)
    return _serialize(l)

@router.put("/{list_id}",response_model=ListOut)
def update_list(list_id:int,data:ListUpdate,c=Depends(verified_customer),db:Session=Depends(get_db)):
    l=db.query(ShoppingList).options(joinedload(ShoppingList.items)).filter(ShoppingList.id==list_id,ShoppingList.customer_id==c.id).first()
    if not l: raise HTTPException(404,"List not found")
    if data.name is not None: l.name=data.name.strip()
    if data.items is not None:
        l.items.clear(); db.flush()
        seen=set()
        for it in data.items:
            if it.product_id in seen: continue
            seen.add(it.product_id)
            db.add(ShoppingListItem(list_id=l.id,product_id=it.product_id,quantity=it.quantity))
    db.commit(); db.refresh(l)
    return _serialize(l)

@router.delete("/{list_id}")
def delete_list(list_id:int,c=Depends(verified_customer),db:Session=Depends(get_db)):
    l=db.query(ShoppingList).filter(ShoppingList.id==list_id,ShoppingList.customer_id==c.id).first()
    if not l: raise HTTPException(404,"List not found")
    db.delete(l); db.commit(); return {"ok":True}

@router.post("/{list_id}/order",response_model=ListOut)
def order_list(list_id:int,c=Depends(verified_customer),db:Session=Depends(get_db)):
    """Order every item on a saved list, if all products are available in stock."""
    from .shop import get_settings
    shop=get_settings(db)
    if not shop.home_delivery_enabled: raise HTTPException(400,"Home delivery is currently unavailable")
    if not shop.is_open: raise HTTPException(400,"Shop is currently closed")
    l=db.query(ShoppingList).options(joinedload(ShoppingList.items)).filter(ShoppingList.id==list_id,ShoppingList.customer_id==c.id).first()
    if not l or not l.items: raise HTTPException(400,"List is empty")
    a=db.query(Address).filter(Address.customer_id==c.id).order_by(Address.is_default.desc(),Address.id.desc()).first()
    if not a: raise HTTPException(400,"Add a delivery address in Account first")
    # validate stock first — nothing changes unless the WHOLE list is orderable
    products={}
    total=Decimal("0")
    for it in l.items:
        p=db.get(Product,it.product_id)
        if not p or not p.is_available or not p.in_stock or it.quantity > p.stock_quantity:
            raise HTTPException(400,f"Not enough stock for: {p.name if p else 'product'}")
        products[it.product_id]=(p,it.quantity)
        total += p.price*it.quantity
    if total < shop.minimum_home_delivery_amount:
        raise HTTPException(400,f"Minimum amount for home delivery is ₹{shop.minimum_home_delivery_amount}")
    order=Order(customer_id=c.id,customer_name=c.name,phone=c.user.phone,address_snapshot=a.house_no or a.line1 or "",total=total,status="PLACED")
    db.add(order); db.flush()
    for p,qty in products.values():
        p.stock_quantity-=qty; p.in_stock=p.stock_quantity>0
        db.add(OrderItem(order_id=order.id,product_id=p.id,product_name=p.name,quantity=qty,price_at_order=p.price))
    admins=db.query(User).filter(User.role=="ADMIN").all()
    for auser in admins:
        create_notification(db,auser.id,"New List Order",f"{c.name} ordered their whole list \"{l.name}\". Total: ₹{total}")
    db.commit()
    return _serialize(l)
