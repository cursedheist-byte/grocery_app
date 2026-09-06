import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine, migrate_legacy_schema
from .config import settings
from .services.notifications import init_firebase
from .routers import auth, customers, products, categories, shop, cart, orders, notifications, admin, support, lists, item_requests

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_legacy_schema()
    init_firebase()
    yield

app=FastAPI(title="Local Grocery API",version="1.0.0",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
for r in [auth.router,customers.router,products.router,categories.router,shop.router,cart.router,orders.router,notifications.router,admin.router,support.router,lists.router,item_requests.router]: app.include_router(r)
_upload_dir=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"static","uploads")
os.makedirs(_upload_dir,exist_ok=True)
app.mount("/api/shop/static/uploads",StaticFiles(directory=_upload_dir),name="uploads")
@app.get("/")
def root(): return {"name":"Local Grocery API","docs":"/docs"}
@app.get("/health")
def health(): return {"status":"ok"}
