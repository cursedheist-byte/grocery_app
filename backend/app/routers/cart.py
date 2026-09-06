from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Cart, CartItem, Product
from ..schemas import CartItemIn, CartOut
from ..auth.dependencies import verified_customer

router=APIRouter(prefix="/api/cart",tags=["cart"])

def get_cart(db,cid):
    cart=db.query(Cart).filter(Cart.customer_id==cid).first()
    if not cart: cart=Cart(customer_id=cid); db.add(cart); db.commit(); db.refresh(cart)
    return cart

def serialize(cart,db):
    out=[]; subtotal=Decimal("0")
    for item in cart.items:
        p=db.get(Product,item.product_id)
        if p:
            line=p.price*item.quantity; subtotal+=line
            out.append({"product_id":p.id,"product_name":p.name,"quantity":item.quantity,"price":p.price,"line_total":line})
    return {"items":out,"subtotal":subtotal}

@router.get("",response_model=CartOut)
def read_cart(c=Depends(verified_customer),db:Session=Depends(get_db)): return serialize(get_cart(db,c.id),db)
@router.post("/items",response_model=CartOut)
def add_item(data:CartItemIn,c=Depends(verified_customer),db:Session=Depends(get_db)):
    p=db.get(Product,data.product_id)
    if not p or not p.is_available or not p.in_stock or p.stock_quantity < data.quantity: raise HTTPException(400,"Product is unavailable or has insufficient stock")
    cart=get_cart(db,c.id); item=next((i for i in cart.items if i.product_id==p.id),None)
    if item:
        if item.quantity + data.quantity > p.stock_quantity: raise HTTPException(400,"Not enough stock available")
        item.quantity+=data.quantity
    else: db.add(CartItem(cart_id=cart.id,product_id=p.id,quantity=data.quantity))
    db.commit(); db.refresh(cart); return serialize(cart,db)
@router.patch("/items/{product_id}",response_model=CartOut)
def set_item(product_id:int,data:CartItemIn,c=Depends(verified_customer),db:Session=Depends(get_db)):
    p=db.get(Product,product_id)
    if not p or not p.is_available or not p.in_stock or data.quantity > p.stock_quantity: raise HTTPException(400,"Not enough stock available")
    cart=get_cart(db,c.id); item=next((i for i in cart.items if i.product_id==product_id),None)
    if not item: raise HTTPException(404,"Cart item not found")
    item.quantity=data.quantity; db.commit(); db.refresh(cart); return serialize(cart,db)
@router.delete("/items/{product_id}",response_model=CartOut)
def remove_item(product_id:int,c=Depends(verified_customer),db:Session=Depends(get_db)):
    cart=get_cart(db,c.id); item=next((i for i in cart.items if i.product_id==product_id),None)
    if item: db.delete(item); db.commit()
    db.refresh(cart); return serialize(cart,db)
@router.delete("",response_model=CartOut)
def clear(c=Depends(verified_customer),db:Session=Depends(get_db)):
    cart=get_cart(db,c.id)
    for i in list(cart.items): db.delete(i)
    db.commit(); db.refresh(cart); return serialize(cart,db)
