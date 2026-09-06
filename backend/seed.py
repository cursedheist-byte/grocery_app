from decimal import Decimal
from app.database import Base, engine, SessionLocal
from app.models import User, Admin, Category, Product, ShopSetting
from app.auth.security import hash_password
from app.config import settings

Base.metadata.create_all(bind=engine)
db=SessionLocal()
try:
    if not db.query(User).filter(User.phone==settings.admin_phone).first():
        u=User(phone=settings.admin_phone,role="ADMIN",password_hash=hash_password(settings.admin_password)); a=Admin(name=settings.admin_name); u.admin=a; db.add(u)
    if not db.query(Category).count():
        cats=[Category(name=x) for x in ["Fruits & Vegetables","Dairy","Snacks","Beverages","Staples"]]; db.add_all(cats); db.flush()
        samples=[("Fresh Bananas",Decimal("50"),"1 kg",0),("Full Cream Milk",Decimal("65"),"1 litre",1),("Potato Chips",Decimal("30"),"1 packet",2),("Orange Juice",Decimal("90"),"1 litre",3),("Basmati Rice",Decimal("140"),"1 kg",4)]
        for name,price,unit,ci in samples: db.add(Product(name=name,price=price,unit=unit,category_id=cats[ci].id,description="Example product",image_url=None))
    if not db.query(ShopSetting).first(): db.add(ShopSetting(shop_name="Dilip Lalwani General Store",is_open=True,home_delivery_enabled=True,announcements="Fresh stock available today!"))
    db.commit()
finally: db.close()
print("Seed complete. Admin phone:",settings.admin_phone,"password:",settings.admin_password)
