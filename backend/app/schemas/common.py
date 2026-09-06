from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, computed_field

class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class CustomerRegister(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=30)

class OtpRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=30)

class OtpVerify(BaseModel):
    phone: str = Field(min_length=7, max_length=30)
    otp: str = Field(pattern=r"^\d{6}$")

class OtpResponse(BaseModel):
    message: str

class GoogleLogin(BaseModel):
    credential: str = Field(min_length=20)
    real_name: str = Field(min_length=2, max_length=120)

class RegisterResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    customer_id: int
    name: str
    phone: str
    verification_code: str
    verification_status: str

class AdminLogin(BaseModel):
    phone: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str

class CustomerTokenResponse(TokenResponse):
    customer_id: int
    name: str
    phone: str

class BanRequest(BaseModel):
    banned: bool
    reason: str | None = Field(default=None, max_length=500)

class HiddenRequest(BaseModel):
    hidden: bool

class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    image_url: str | None = None
    is_active: bool = True

class CategoryOut(CategoryIn, ORM):
    id: int

class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    price: Decimal = Field(ge=0)
    unit: str = Field(min_length=1, max_length=40)
    image_url: str | None = None
    # Optional explicit override of the pre-sale ("normal") price, editable during sale mode.
    original_price: Decimal | None = Field(default=None, ge=0)
    category_id: int | None = None
    is_available: bool = True
    in_stock: bool = True
    stock_quantity: int = Field(default=10, ge=0)

class ProductOut(ProductIn, ORM):
    id: int
    category: CategoryOut | None = None
    original_price: Decimal | None = None

    @computed_field
    @property
    def discount_percent(self) -> int | None:
        """Percent off vs the pre-sale price, e.g. ₹15 -> ₹13 = 13% off."""
        if self.original_price and self.original_price > self.price:
            return int(round((self.original_price - self.price) / self.original_price * 100))
        return None

class AddressIn(BaseModel):
    house_no: str = Field(min_length=1, max_length=200)

class AddressOut(AddressIn, ORM):
    id: int
    is_default: bool

class CustomerOut(ORM):
    id: int
    name: str
    phone: str
    verification_code: str
    verification_status: str
    credit_balance: Decimal
    debt_balance: Decimal
    created_at: datetime
    is_active: bool = True
    ban_reason: str | None = None
    is_hidden: bool = False

class CartItemIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=100)

class CartItemOut(BaseModel):
    product_id: int
    product_name: str
    quantity: int
    price: Decimal
    line_total: Decimal

class CartOut(BaseModel):
    items: list[CartItemOut]
    subtotal: Decimal

class OrderCreate(BaseModel):
    address_id: int
    special_request: str | None = Field(default=None, max_length=1000)

class OrderItemOut(BaseModel):
    product_id: int
    product_name: str
    quantity: int
    price_at_order: Decimal

class OrderOut(ORM):
    id: int
    customer_id: int
    customer_name: str
    phone: str
    address_snapshot: str
    total: Decimal
    status: str
    special_request: str | None = None
    owner_reply: str | None = None
    created_at: datetime
    items: list[OrderItemOut]

class ReplyIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)

class StatusUpdate(BaseModel):
    status: str

class CreditChange(BaseModel):
    amount: Decimal
    note: str | None = None

class CreditSet(BaseModel):
    balance: Decimal = Field(ge=0)
    note: str | None = None

class SupportMessage(BaseModel):
    role: Literal["user", "model"]
    content: str = Field(min_length=1, max_length=2000)

class SupportChatRequest(BaseModel):
    messages: list[SupportMessage] = Field(min_length=1, max_length=20)

class SupportChatResponse(BaseModel):
    reply: str

class NotificationCreate(BaseModel):
    customer_id: int
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)

class PushTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=500)
    platform: str = Field(default="web", max_length=20)

class ShopSettingsIn(BaseModel):
    shop_name: str = Field(min_length=1, max_length=120)
    logo_url: str | None = None
    is_open: bool
    reopening_time: str | None = None
    home_delivery_enabled: bool
    sale_mode: bool = False
    minimum_home_delivery_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    announcements: str | None = None
    loading_image_url: str | None = None
    home_hero_image_url: str | None = None
    cart_empty_image_url: str | None = None
    orders_empty_image_url: str | None = None
    debt_image_url: str | None = None
    support_avatar_image_url: str | None = None
    lists_page_image_url: str | None = None
    requests_page_image_url: str | None = None
    # Per-slot image fit/scale: {slot_key: {"fit": "contain"|"cover", "scale": int percent}}
    image_styles: dict | None = None

class ShopSettingsOut(ShopSettingsIn, ORM):
    id: int

class NotificationOut(ORM):
    id: int
    title: str
    message: str
    is_read: bool
    created_at: datetime

class ItemRequestIn(BaseModel):
    item_name: str = Field(min_length=1, max_length=180)
    brand: str | None = Field(default=None, max_length=120)
    quantity: int = Field(ge=1, le=1000)
    max_price: Decimal = Field(gt=0)

class ItemRequestOut(ORM):
    id: int
    item_name: str
    brand: str | None = None
    quantity: int
    max_price: Decimal
    status: str
    admin_price: Decimal | None = None
    created_at: datetime

class ItemRequestDecision(BaseModel):
    action: Literal["ARRIVED", "NOT_FOUND", "TOO_HEAVY", "SEEN", "PRICE_RANGE"]
    admin_price: Decimal | None = Field(default=None, ge=0)
