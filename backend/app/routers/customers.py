from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Customer, Address, User, CreditTransaction, Order, OrderItem, Cart, CartItem, Notification
from ..schemas import CustomerOut, AddressIn, AddressOut, CreditChange, CreditSet, BanRequest, HiddenRequest
from ..auth.dependencies import current_user, admin_user
from ..services.notifications import create_notification, try_push

router=APIRouter(prefix="/api/customers", tags=["customers"])

def normalize_balances(customer):
    offset=min(customer.credit_balance, customer.debt_balance)
    customer.credit_balance-=offset
    customer.debt_balance-=offset

def customer_payload(c):
    return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at,"is_active":c.user.is_active,"ban_reason":c.user.ban_reason,"is_hidden":c.is_hidden}

def customer_for(user, db):
    if user.role != "CUSTOMER" or not user.customer: raise HTTPException(403,"Customer access required")
    return user.customer

@router.get("/me", response_model=CustomerOut)
def me(user=Depends(current_user), db:Session=Depends(get_db)):
    c=customer_for(user,db)
    return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at,"is_active":c.user.is_active,"ban_reason":c.user.ban_reason}

@router.get("/me/addresses", response_model=list[AddressOut])
def addresses(user=Depends(current_user),db:Session=Depends(get_db)): return customer_for(user,db).addresses

@router.post("/me/addresses", response_model=AddressOut)
def add_address(data:AddressIn,user=Depends(current_user),db:Session=Depends(get_db)):
    c=customer_for(user,db)
    if c.verification_status != "verified": raise HTTPException(403,"Customer account is not verified")
    for a in c.addresses: a.is_default=False
    a=Address(customer_id=c.id, house_no=data.house_no.strip(), line1=data.house_no.strip()); db.add(a); db.commit(); db.refresh(a); return a

@router.put("/me/addresses/{address_id}", response_model=AddressOut)
def edit_address(address_id:int,data:AddressIn,user=Depends(current_user),db:Session=Depends(get_db)):
    c=customer_for(user,db); a=db.get(Address,address_id)
    if not a or a.customer_id != c.id: raise HTTPException(404,"Address not found")
    for other in c.addresses: other.is_default=False
    a.house_no = data.house_no.strip()
    a.line1 = a.house_no
    db.commit(); db.refresh(a); return a

@router.get("/admin", response_model=list[CustomerOut])
def all_customers(db:Session=Depends(get_db),_=Depends(admin_user)):
    rows=db.query(Customer).join(User).order_by(User.created_at.desc()).all()
    return [{"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at,"is_active":c.user.is_active,"ban_reason":c.user.ban_reason,"is_hidden":c.is_hidden} for c in rows]

@router.patch("/{customer_id}/ban", response_model=CustomerOut)
def ban_customer(customer_id:int,data:BanRequest,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    reason=data.reason.strip() if data.reason else ""
    if data.banned and not reason: raise HTTPException(400,"A reason is required when banning a customer")
    c.user.is_active=not data.banned
    c.user.ban_reason=reason if data.banned else None
    db.commit(); db.refresh(c)
    return customer_payload(c)

@router.patch("/{customer_id}/hidden", response_model=CustomerOut)
def set_hidden_customer(customer_id:int,data:HiddenRequest,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    c.is_hidden=bool(data.hidden)
    db.commit(); db.refresh(c)
    return customer_payload(c)

@router.delete("/{customer_id}")
def delete_customer(customer_id:int,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer, customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    for order in db.query(Order).filter(Order.customer_id==c.id).all():
        db.query(OrderItem).filter(OrderItem.order_id==order.id).delete(synchronize_session=False)
        db.delete(order)
    cart=db.query(Cart).filter(Cart.customer_id==c.id).first()
    if cart:
        db.query(CartItem).filter(CartItem.cart_id==cart.id).delete(synchronize_session=False)
        db.delete(cart)
    db.query(CreditTransaction).filter(CreditTransaction.customer_id==c.id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.user_id==c.user_id).delete(synchronize_session=False)
    db.delete(c)
    db.delete(c.user)
    db.commit()
    return {"message":"Customer deleted"}

@router.patch("/{customer_id}/verification", response_model=CustomerOut)
def verify_customer(customer_id:int,status:str,db:Session=Depends(get_db),_=Depends(admin_user)):
    if status not in {"verified","unverified"}: raise HTTPException(400,"Status must be verified or unverified")
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    c.verification_status=status; db.commit(); db.refresh(c); return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at}

@router.post("/{customer_id}/credit/change", response_model=CustomerOut)
def change_credit(customer_id:int,data:CreditChange,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    new=c.credit_balance + data.amount
    if new < 0: raise HTTPException(400,"Credit cannot become negative")
    c.credit_balance=new
    normalize_balances(c)
    db.add(CreditTransaction(customer_id=c.id,amount=data.amount,balance_after=c.credit_balance,transaction_type="CREDIT" if data.amount>=0 else "DEBIT",note=data.note))
    db.commit(); db.refresh(c); return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at}

@router.post("/{customer_id}/credit/set", response_model=CustomerOut)
def set_credit(customer_id:int,data:CreditSet,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    delta=data.balance-c.credit_balance; c.credit_balance=data.balance
    normalize_balances(c)
    db.add(CreditTransaction(customer_id=c.id,amount=delta,balance_after=c.credit_balance,transaction_type="SET",note=data.note))
    db.commit(); db.refresh(c); return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at}

@router.post("/{customer_id}/debt/change", response_model=CustomerOut)
def change_debt(customer_id:int,data:CreditChange,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Customer,customer_id)
    if not c: raise HTTPException(404,"Customer not found")
    new=c.debt_balance + data.amount
    if new < 0: raise HTTPException(400,"Debt cannot become negative")
    c.debt_balance=new
    normalize_balances(c)
    db.commit(); db.refresh(c)
    return {"id":c.id,"name":c.name,"phone":c.user.phone,"verification_code":c.verification_code,"verification_status":c.verification_status,"credit_balance":c.credit_balance,"debt_balance":c.debt_balance,"created_at":c.user.created_at}

@router.get("/{customer_id}/credit/history")
def credit_history(customer_id:int,db:Session=Depends(get_db),_=Depends(admin_user)):
    return db.query(CreditTransaction).filter(CreditTransaction.customer_id==customer_id).order_by(CreditTransaction.created_at.desc()).all()
