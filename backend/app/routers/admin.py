from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Product, Customer, Order, OfflineSale
from ..auth.dependencies import admin_user
from .shop import get_settings

router=APIRouter(prefix="/api/admin",tags=["admin"])
@router.get("/dashboard")
def dashboard(db:Session=Depends(get_db),_=Depends(admin_user)):
    shop=get_settings(db)
    today_start=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
    today_sales=db.query(Order).filter(Order.created_at>=today_start,Order.status=="DELIVERED").with_entities(func.coalesce(func.sum(Order.total),0)).scalar()
    offline_today=db.query(OfflineSale).filter(OfflineSale.created_at>=today_start).with_entities(func.coalesce(func.sum(OfflineSale.total),0)).scalar()
    return {"shop_open":shop.is_open,"home_delivery_enabled":shop.home_delivery_enabled,"pending_customers":db.query(Customer).filter(Customer.verification_status=="pending").count(),"new_orders":db.query(Order).filter(Order.status=="PLACED").count(),"products":db.query(Product).count(),"customers":db.query(Customer).count(),"today_sales":float(today_sales)+float(offline_today)}

@router.get("/sales/today")
def sales_today(db:Session=Depends(get_db),_=Depends(admin_user)):
    """Today's total sales: delivered online orders + recorded offline sales."""
    today_start=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
    online=db.query(Order).filter(Order.created_at>=today_start,Order.status.in_(["DELIVERED"])).all()
    online_total=sum(o.total for o in online)
    online_pending=db.query(Order).filter(Order.created_at>=today_start,Order.status.notin_(["DELIVERED","REJECTED","CANCELLED"])).all()
    pending_total=sum(o.total for o in online_pending)
    offline=db.query(OfflineSale).filter(OfflineSale.created_at>=today_start).all()
    offline_total=sum(s.total for s in offline)
    return {
        "online_delivered_total":online_total,
        "online_delivered_count":len(online),
        "online_pending_total":pending_total,
        "online_pending_count":len(online_pending),
        "offline_total":offline_total,
        "offline_count":len(offline),
        "grand_total":online_total+offline_total,
        "offline_sales":[{"id":s.id,"product_name":s.product_name,"quantity":s.quantity,"total":s.total,"created_at":s.created_at} for s in sorted(offline,key=lambda x:x.created_at,reverse=True)],
    }
