from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ItemRequest, Customer, User
from ..schemas import ItemRequestIn, ItemRequestOut, ItemRequestDecision
from ..auth.dependencies import verified_customer, admin_user
from ..services.notifications import create_notification, try_push

router = APIRouter(prefix="/api/item-requests", tags=["item-requests"])

# The 4 admin responses -> (request status, notification title, customer message template)
RESPONSES = {
    "ARRIVED": (
        "ARRIVED",
        "Requested Item Arrived",
        "Your requested product of price ₹{price} has arrived at the shop. You can pick it up!",
    ),
    "NOT_FOUND": (
        "NOT_FOUND",
        "Product Not Found",
        "Sorry, we can't find your related product in the market.",
    ),
    "PRICE_RANGE": (
        "PRICE_RANGE",
        "Price Range Issue",
        "Sorry, we can't find your related product under your price range.",
    ),
    "TOO_HEAVY": (
        "TOO_HEAVY",
        "Request Too Heavy",
        "That's too heavy! We are unable to arrange this item for you.",
    ),
    "SEEN": (
        "SEEN",
        "Request Seen",
        "Your request has been seen by the shop owner. You may get an update in 1-2 days.",
    ),
}


@router.post("", response_model=ItemRequestOut)
def create_request(data: ItemRequestIn, c: Customer = Depends(verified_customer), db: Session = Depends(get_db)):
    """Customer requests an item that is not available at the shop."""
    req = ItemRequest(
        customer_id=c.id,
        item_name=data.item_name.strip(),
        brand=(data.brand.strip() if data.brand and data.brand.strip() else None),
        quantity=data.quantity,
        max_price=data.max_price,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    admins = db.query(User).filter(User.role == "ADMIN").all()
    for auser in admins:
        create_notification(
            db, auser.id, "New Item Request",
            f"{c.name} requested '{req.item_name}'"
            + (f" ({req.brand})" if req.brand else "")
            + f" × {req.quantity} (max ₹{req.max_price}).",
        )
    return req


@router.get("/me", response_model=list[ItemRequestOut])
def my_requests(c: Customer = Depends(verified_customer), db: Session = Depends(get_db)):
    return (
        db.query(ItemRequest)
        .filter(ItemRequest.customer_id == c.id)
        .order_by(ItemRequest.created_at.desc())
        .all()
    )


@router.get("/admin", response_model=list[ItemRequestOut])
def admin_requests(db: Session = Depends(get_db), _: object = Depends(admin_user)):
    return db.query(ItemRequest).order_by(ItemRequest.created_at.desc()).all()


@router.patch("/{request_id}/respond", response_model=ItemRequestOut)
def respond(
    request_id: int,
    data: ItemRequestDecision,
    db: Session = Depends(get_db),
    _: object = Depends(admin_user),
):
    """Admin answers a customer's item request with one of the 4 options."""
    req = db.get(ItemRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if data.action == "ARRIVED" and (data.admin_price is None or data.admin_price <= 0):
        raise HTTPException(400, "Admin price is required when the item has arrived")

    status, title, template = RESPONSES[data.action]
    req.status = status
    if data.action == "ARRIVED":
        req.admin_price = data.admin_price

    customer = db.get(Customer, req.customer_id)
    if customer:
        message = template.format(price=req.admin_price)
        create_notification(db, customer.user.id, title, f"'{req.item_name}': {message}")
        try_push(customer.user.id, title, f"'{req.item_name}': {message}")

    db.commit()
    db.refresh(req)
    return req


@router.delete("/{request_id}")
def delete_request(request_id: int, db: Session = Depends(get_db), _: object = Depends(admin_user)):
    req = db.get(ItemRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    db.delete(req)
    db.commit()
    return {"ok": True}
