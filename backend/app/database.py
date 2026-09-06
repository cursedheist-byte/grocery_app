from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings

class Base(DeclarativeBase):
    pass

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def migrate_legacy_schema():
    inspector = inspect(engine)
    if "products" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("products")}
    if "stock_quantity" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE products ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 10"))
            connection.execute(text("UPDATE products SET stock_quantity = 10 WHERE in_stock = 1"))
    customer_columns = {column["name"] for column in inspector.get_columns("customers")}
    if "debt_balance" not in customer_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE customers ADD COLUMN debt_balance NUMERIC(12,2) NOT NULL DEFAULT 0"))
    if "is_hidden" not in customer_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE customers ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT 0"))
    with engine.begin() as connection:
        connection.execute(text("""
            UPDATE customers
            SET credit_balance = CASE
                WHEN credit_balance > debt_balance THEN credit_balance - debt_balance
                ELSE 0
            END,
            debt_balance = CASE
                WHEN debt_balance > credit_balance THEN debt_balance - credit_balance
                ELSE 0
            END
            WHERE credit_balance > 0 AND debt_balance > 0
        """))
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "otp_hash" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN otp_hash VARCHAR(128)"))
        if "otp_expires_at" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN otp_expires_at DATETIME"))
        if "otp_attempts" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0"))
        if "google_sub" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
        if "email" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))
        if "ban_reason" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN ban_reason VARCHAR(500)"))
    address_columns = {column["name"]: column for column in inspector.get_columns("addresses")} if "addresses" in inspector.get_table_names() else {}
    if address_columns:
        # Legacy databases created addresses with NOT NULL city/pincode/line1 columns.
        # SQLite cannot drop a NOT NULL constraint, so rebuild the table when needed.
        needs_rebuild = any(
            name in address_columns and address_columns[name].get("nullable") is False
            for name in ("line1", "line2", "city", "pincode", "house_no")
        )
        if needs_rebuild:
            with engine.begin() as connection:
                connection.execute(text("""
                    CREATE TABLE addresses_new (
                        id INTEGER PRIMARY KEY,
                        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                        house_no VARCHAR(200),
                        line1 VARCHAR(200),
                        line2 VARCHAR(200),
                        city VARCHAR(100),
                        pincode VARCHAR(20),
                        is_default BOOLEAN DEFAULT 1
                    )
                """))
                connection.execute(text("""
                    INSERT INTO addresses_new (id, customer_id, house_no, line1, line2, city, pincode, is_default)
                    SELECT id, customer_id, house_no, line1, line2, city, pincode, is_default FROM addresses
                """))
                connection.execute(text("DROP TABLE addresses"))
                connection.execute(text("ALTER TABLE addresses_new RENAME TO addresses"))
        else:
            with engine.begin() as connection:
                if "house_no" not in address_columns:
                    connection.execute(text("ALTER TABLE addresses ADD COLUMN house_no VARCHAR(200)"))
                connection.execute(text("UPDATE addresses SET house_no = line1 WHERE house_no IS NULL"))
    order_columns = {column["name"] for column in inspector.get_columns("orders")} if "orders" in inspector.get_table_names() else set()
    if order_columns:
        with engine.begin() as connection:
            if "special_request" not in order_columns:
                connection.execute(text("ALTER TABLE orders ADD COLUMN special_request TEXT"))
            if "owner_reply" not in order_columns:
                connection.execute(text("ALTER TABLE orders ADD COLUMN owner_reply TEXT"))
    if "products" in inspector.get_table_names():
        with engine.begin() as connection:
            if "original_price" not in {c["name"] for c in inspector.get_columns("products")}:
                connection.execute(text("ALTER TABLE products ADD COLUMN original_price NUMERIC(12,2)"))
    if "shop_settings" in inspector.get_table_names():
        shop_columns = {column["name"] for column in inspector.get_columns("shop_settings")}
        with engine.begin() as connection:
            if "sale_mode" not in shop_columns:
                connection.execute(text("ALTER TABLE shop_settings ADD COLUMN sale_mode BOOLEAN NOT NULL DEFAULT 0"))
    if "shop_settings" in inspector.get_table_names():
        shop_columns = {column["name"] for column in inspector.get_columns("shop_settings")}
        image_columns = {
            "loading_image_url": "VARCHAR(500)",
            "home_hero_image_url": "VARCHAR(500)",
            "cart_empty_image_url": "VARCHAR(500)",
            "orders_empty_image_url": "VARCHAR(500)",
            "debt_image_url": "VARCHAR(500)",
            "support_avatar_image_url": "VARCHAR(500)",
            "lists_page_image_url": "VARCHAR(500)",
            "requests_page_image_url": "VARCHAR(500)",
            "image_styles": "TEXT",
        }
        with engine.begin() as connection:
            if "minimum_home_delivery_amount" not in shop_columns:
                connection.execute(text("ALTER TABLE shop_settings ADD COLUMN minimum_home_delivery_amount NUMERIC(12,2) NOT NULL DEFAULT 0"))
            for column, sql_type in image_columns.items():
                if column not in shop_columns:
                    connection.execute(text(f"ALTER TABLE shop_settings ADD COLUMN {column} {sql_type}"))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
