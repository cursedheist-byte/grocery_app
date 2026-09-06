from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="CUSTOMER", index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    otp_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    otp_attempts: Mapped[int] = mapped_column(Integer, default=0)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    ban_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    customer: Mapped["Customer | None"] = relationship(back_populates="user", uselist=False)
    admin: Mapped["Admin | None"] = relationship(back_populates="user", uselist=False)

class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    verification_code: Mapped[str] = mapped_column(String(4))
    verification_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    credit_balance: Mapped[Decimal] = mapped_column(Numeric(12,2), default=Decimal("0.00"))
    debt_balance: Mapped[Decimal] = mapped_column(Numeric(12,2), default=Decimal("0.00"))
    # Hidden "service" customers: fully functional accounts that the admin
    # keeps out of the regular customer list (visible under the Hidden toggle).
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    user: Mapped[User] = relationship(back_populates="customer")
    addresses: Mapped[list["Address"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship(back_populates="customer")

class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    user: Mapped[User] = relationship(back_populates="admin")

class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    image_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    products: Mapped[list["Product"]] = relationship(back_populates="category")

class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(180), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(12,2))
    unit: Mapped[str] = mapped_column(String(40), default="1 piece")
    image_url: Mapped[str | None] = mapped_column(Text)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    stock_quantity: Mapped[int] = mapped_column(Integer, default=10)
    # Sale mode: original (pre-discount) price. Only set while sale mode is on.
    original_price: Mapped[Decimal | None] = mapped_column(Numeric(12,2), nullable=True)
    category: Mapped[Category | None] = relationship(back_populates="products")

class Address(Base):
    __tablename__ = "addresses"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    house_no: Mapped[str | None] = mapped_column(String(200), nullable=True)
    line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    customer: Mapped[Customer] = relationship(back_populates="addresses")

class Cart(Base):
    __tablename__ = "carts"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), unique=True)
    items: Mapped[list["CartItem"]] = relationship(cascade="all, delete-orphan")

class CartItem(Base):
    __tablename__ = "cart_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)

class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    customer_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30))
    address_snapshot: Mapped[str] = mapped_column(Text)
    total: Mapped[Decimal] = mapped_column(Numeric(12,2))
    status: Mapped[str] = mapped_column(String(30), default="PLACED", index=True)
    special_request: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    customer: Mapped[Customer] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan")

class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(180))
    quantity: Mapped[int] = mapped_column(Integer)
    price_at_order: Mapped[Decimal] = mapped_column(Numeric(12,2))

class PushToken(Base):
    __tablename__ = "push_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(20), default="web")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12,2))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12,2))
    transaction_type: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class ShopSetting(Base):
    __tablename__ = "shop_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    shop_name: Mapped[str] = mapped_column(String(120), default="My Local Store")
    logo_url: Mapped[str | None] = mapped_column(String(500))
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    reopening_time: Mapped[str | None] = mapped_column(String(20))
    home_delivery_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sale_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    minimum_home_delivery_amount: Mapped[Decimal] = mapped_column(Numeric(12,2), default=Decimal("0.00"))
    announcements: Mapped[str | None] = mapped_column(Text)

    # Admin-configurable image slots (set from the admin panel, shown on the customer app)
    loading_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    home_hero_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cart_empty_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    orders_empty_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    debt_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    support_avatar_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lists_page_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requests_page_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Per-slot image styling: {"home_hero_image_url": {"fit": "contain", "scale": 100}, ...}
    image_styles: Mapped[str | None] = mapped_column(Text, nullable=True)

class ShoppingList(Base):
    __tablename__ = "shopping_lists"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    customer: Mapped[Customer] = relationship()
    items: Mapped[list["ShoppingListItem"]] = relationship(cascade="all, delete-orphan")

class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("shopping_lists.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)

class OfflineSale(Base):
    __tablename__ = "offline_sales"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(180))
    quantity: Mapped[int] = mapped_column(Integer)
    total: Mapped[Decimal] = mapped_column(Numeric(12,2))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

Index("ix_products_available_stock", Product.is_available, Product.in_stock)

class ItemRequest(Base):
    """A product requested by a customer that is not available in the shop."""
    __tablename__ = "item_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    item_name: Mapped[str] = mapped_column(String(180))
    brand: Mapped[str | None] = mapped_column(String(120), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    max_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # PENDING -> admin hasn't acted yet; ARRIVED / NOT_FOUND / TOO_HEAVY / SEEN are admin responses
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    admin_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    customer: Mapped[Customer] = relationship()
