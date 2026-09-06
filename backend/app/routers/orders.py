from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from ..models import Order, OrderItem, Product, Address, Cart, Notification, User, Customer
from ..schemas import OrderCreate, OrderOut, StatusUpdate, ReplyIn
from ..auth.dependencies import verified_customer, admin_user, current_user
from ..services.notifications import create_notification, try_push

router=APIRouter(prefix="/api/orders",tags=["orders"])
ALLOWED={"PLACED","ACCEPTED","PREPARING","OUT_FOR_DELIVERY","DELIVERED","REJECTED","CANCELLED"}

def _restore_stock(db:Session,order:Order):
    """Return reserved stock back to inventory (used on reject/cancel)."""
    for item in order.items:
        p=db.get(Product,item.product_id)
        if p:
            p.stock_quantity += item.quantity
            p.in_stock = p.stock_quantity > 0

@router.post("",response_model=OrderOut)
def create_order(data:OrderCreate,c=Depends(verified_customer),db:Session=Depends(get_db)):
    from .shop import get_settings
    shop=get_settings(db)
    if not shop.home_delivery_enabled: raise HTTPException(400,"Home delivery is currently unavailable")
    if not shop.is_open: raise HTTPException(400,"Shop is currently closed")
    a=db.get(Address,data.address_id)
    if not a or a.customer_id!=c.id: raise HTTPException(400,"Valid delivery address required")
    cart=db.query(Cart).options(joinedload(Cart.items)).filter(Cart.customer_id==c.id).first()
    if not cart or not cart.items: raise HTTPException(400,"Cart is empty")
    total=Decimal("0"); order=Order(customer_id=c.id,customer_name=c.name,phone=c.user.phone,address_snapshot=a.house_no or a.line1 or "",total=0,status="PLACED",special_request=(data.special_request or "").strip() or None)
    db.add(order); db.flush()
    for ci in cart.items:
        p=db.get(Product,ci.product_id)
        if not p or not p.is_available or not p.in_stock or ci.quantity > p.stock_quantity: raise HTTPException(400,f"Product unavailable or insufficient stock: {ci.product_id}")
        line=p.price*ci.quantity; total+=line
        p.stock_quantity -= ci.quantity
        p.in_stock = p.stock_quantity > 0
        db.add(OrderItem(order_id=order.id,product_id=p.id,product_name=p.name,quantity=ci.quantity,price_at_order=p.price))
    if total < shop.minimum_home_delivery_amount:
        raise HTTPException(400,f"Minimum amount for home delivery is ₹{shop.minimum_home_delivery_amount}. Please add more items or direct pickup from shop.")
    order.total=total
    for ci in list(cart.items): db.delete(ci)
    db.commit(); db.refresh(order)
    admins=db.query(User).filter(User.role=="ADMIN").all()
    for auser in admins: create_notification(db,auser.id,"New Delivery Order",f"{c.name} placed a new order. Total: ₹{total}" + (f" Special request: {order.special_request}" if order.special_request else ""))
    return order

@router.get("/me",response_model=list[OrderOut])
def my_orders(c=Depends(verified_customer),db:Session=Depends(get_db)):
    return db.query(Order).options(joinedload(Order.items)).filter(Order.customer_id==c.id).order_by(Order.created_at.desc()).all()

@router.get("/admin",response_model=list[OrderOut])
def admin_orders(db:Session=Depends(get_db),_=Depends(admin_user)):
    return db.query(Order).options(joinedload(Order.items)).order_by(Order.created_at.desc()).all()

@router.patch("/{order_id}/reply",response_model=OrderOut)
def reply(order_id:int,data:ReplyIn,db:Session=Depends(get_db),_=Depends(admin_user)):
    o=db.query(Order).options(joinedload(Order.items)).filter(Order.id==order_id).first()
    if not o: raise HTTPException(404,"Order not found")
    o.owner_reply=data.message.strip()
    user=db.get(Customer,o.customer_id).user
    create_notification(db,user.id,"Store Reply",f"Reply to order #{o.id}: {o.owner_reply}"); try_push(user.id,"Store Reply",f"Reply to order #{o.id}: {o.owner_reply}")
    db.commit(); db.refresh(o); return o

@router.patch("/{order_id}/status",response_model=OrderOut)
def status(order_id:int,data:StatusUpdate,db:Session=Depends(get_db),_=Depends(admin_user)):
    if data.status not in ALLOWED: raise HTTPException(400,"Invalid order status")
    o=db.query(Order).options(joinedload(Order.items)).filter(Order.id==order_id).first()
    if not o: raise HTTPException(404,"Order not found")
    if data.status in ("REJECTED","CANCELLED") and o.status not in ("REJECTED","CANCELLED","DELIVERED"):
        _restore_stock(db,o)
    o.status=data.status
    user=db.get(Customer,o.customer_id).user
    messages={"ACCEPTED":"Your order has been accepted.","PREPARING":"Your order is being prepared.","OUT_FOR_DELIVERY":"Your order is out for delivery.","DELIVERED":"Your order has been delivered.","REJECTED":"Your order was rejected.","CANCELLED":"Your order was cancelled."}
    if data.status in messages: create_notification(db,user.id,"Order Update",messages[data.status]); try_push(user.id,"Order Update",messages[data.status])
    db.commit(); db.refresh(o); return o

@router.patch("/{order_id}/cancel",response_model=OrderOut)
def cancel_order(order_id:int,c=Depends(verified_customer),db:Session=Depends(get_db)):
    o=db.query(Order).options(joinedload(Order.items)).filter(Order.id==order_id,Order.customer_id==c.id).first()
    if not o: raise HTTPException(404,"Order not found")
    if o.status!="PLACED": raise HTTPException(400,"Only pending orders can be cancelled")
    _restore_stock(db,o)
    o.status="CANCELLED"
    admins=db.query(User).filter(User.role=="ADMIN").all()
    for auser in admins: create_notification(db,auser.id,"Order Cancelled",f"{c.name} cancelled order #{o.id} (₹{o.total}).")
    db.commit(); db.refresh(o); return o
