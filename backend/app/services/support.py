import json
import re
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.orm import object_session

from ..config import settings
from ..models import Product, Order, CreditTransaction, ShopSetting


def clean_support_reply(reply):
    reply = reply.strip()

    meta_markers = (
        "Role:",
        "Constraints:",
        "Customer Context:",
        "Customer Info:",
        "Customer Input:",
        "Intent:",
        "User:",
        "Issue:",
        "Context:",
        "Goal:",
        "Language:",
        "Specific instruction:",
        "No role/",
        "Analysis:",
        "Reasoning:",
        "System:",
    )

    # Only treat it as a meta leak when the reply STARTS with a meta
    # marker (or a leading "*" bullet). Matching anywhere previously
    # cut off valid answers that merely contained such words mid-text.
    lowered = reply.lower()
    starts_with_meta = any(
        lowered.startswith(marker.lower()) or
        lowered.startswith("*" + marker.lower()) or
        lowered.startswith("- " + marker.lower())
        for marker in meta_markers
    )

    if starts_with_meta or reply.startswith("*"):
        quoted = re.findall(
            r"[\"“](.*?)[\"”]",
            reply,
            flags=re.DOTALL,
        )

        if quoted:
            reply = quoted[-1].strip()
        else:
            reply = reply.split("\n\n")[-1].strip()

    reply = re.sub(
        r"^\s*(assistant|reply)\s*:\s*",
        "",
        reply,
        flags=re.IGNORECASE,
    )

    return reply.strip(" \n*-")


def money(value):
    try:
        return f"{Decimal(str(value or 0)):.2f}"
    except Exception:
        return "0.00"


def normalize_text(value):
    """
    Normalize product/customer text so that simple differences
    such as capitalization, extra spaces and punctuation do not
    prevent product recognition.
    """
    if not value:
        return ""

    value = str(value).lower().strip()

    value = value.replace("-", " ")
    value = value.replace("_", " ")

    value = re.sub(r"[^\w\s]", " ", value)
    value = re.sub(r"\s+", " ", value)

    return value.strip()


def find_relevant_products(products, messages):
    """
    Find products that are likely relevant to the customer's
    latest message.

    This does NOT modify the database.
    It only gives the AI a stronger, deterministic product hint.
    """

    if not products or not messages:
        return []

    latest_message = messages[-1].content or ""
    message_normalized = normalize_text(latest_message)

    if not message_normalized:
        return []

    words = set(message_normalized.split())

    scored = []

    for product in products:
        product_name = normalize_text(product.name)

        if not product_name:
            continue

        score = 0

        # Exact product name
        if product_name in message_normalized:
            score += 100

        # Individual words
        product_words = set(product_name.split())

        if product_words:
            matching_words = product_words.intersection(words)
            score += len(matching_words) * 20

        # Strong partial match
        for product_word in product_words:
            if len(product_word) >= 4:
                if product_word in message_normalized:
                    score += 10

        if score > 0:
            scored.append((score, product))

    scored.sort(
        key=lambda item: (
            item[0],
            len(normalize_text(item[1].name)),
        ),
        reverse=True,
    )

    return [product for _, product in scored[:5]]


def extract_requested_quantity(messages):
    """
    Best-effort quantity extraction from the customer's latest message.
    This is only a hint for the AI and is never used to modify stock.
    """

    if not messages:
        return None

    text = messages[-1].content or ""

    patterns = (
        r"\b(\d+)\s*(?:piece|pieces|pc|pcs|packet|packets|"
        r"packet|pack|kg|kilo|litre|liter|ltr|l|unit|units)\b",
        r"\b(\d+)\s*(?:x)\b",
        r"\b(?:ek|one|1)\b",
    )

    for pattern in patterns:
        match = re.search(
            pattern,
            text,
            flags=re.IGNORECASE,
        )

        if match:
            if match.groups():
                try:
                    return int(match.group(1))
                except Exception:
                    pass

            return 1

    return None


def build_store_context(customer):
    """
    Creates LIVE store/customer context for the AI.

    Database is only READ here.
    No order, stock, debt or other data is modified.
    """

    db = None

    try:
        db = object_session(customer)

        if db is None:
            raise RuntimeError(
                "Customer is not attached to a database session"
            )

        # =====================================================
        # CUSTOMER ACCOUNT
        # =====================================================

        customer_context = (
            f"Customer ID: {customer.id}\n"
            f"Customer name: {customer.name}\n"
            f"Current credit balance: ₹{money(customer.credit_balance)}\n"
            f"Outstanding debt: ₹{money(customer.debt_balance)}"
        )

        # =====================================================
        # SHOP INFORMATION
        # =====================================================

        shop = db.execute(
            select(ShopSetting)
            .order_by(ShopSetting.id.asc())
        ).scalars().first()

        if shop:
            shop_context = (
                f"Shop name: {shop.shop_name}\n"
                f"Shop currently open: "
                f"{'Yes' if shop.is_open else 'No'}\n"
                f"Reopening time: "
                f"{shop.reopening_time or 'Not specified'}\n"
                f"Home delivery enabled: "
                f"{'Yes' if shop.home_delivery_enabled else 'No'}\n"
                f"Announcement: "
                f"{shop.announcements or 'None'}"
            )
        else:
            shop_context = "Shop settings are not available."

        # =====================================================
        # LIVE PRODUCT INVENTORY
        # =====================================================

        products = db.execute(
            select(Product)
            .order_by(Product.name.asc())
        ).scalars().all()

        inventory_lines = []

        for product in products:
            stock = int(product.stock_quantity or 0)

            if not product.is_available:
                status = "UNAVAILABLE"
            elif not product.in_stock or stock <= 0:
                status = "OUT OF STOCK"
            else:
                status = "AVAILABLE"

            category_name = (
                product.category.name
                if product.category
                else "Uncategorized"
            )

            inventory_lines.append(
                f"- Product ID: {product.id}\n"
                f"  Product name: {product.name}\n"
                f"  Category: {category_name}\n"
                f"  Current price: ₹{money(product.price)}\n"
                f"  Unit: {product.unit}\n"
                f"  Current stock: {stock}\n"
                f"  Availability: {status}"
            )

        if inventory_lines:
            inventory_context = "\n".join(inventory_lines)
        else:
            inventory_context = "No products found."

        # =====================================================
        # CUSTOMER ORDERS
        # =====================================================

        recent_orders = sorted(
            customer.orders,
            key=lambda order: order.created_at,
            reverse=True,
        )[:10]

        order_lines = []

        for order in recent_orders:
            item_lines = []

            for item in order.items:
                item_lines.append(
                    f"{item.product_name} x{item.quantity} "
                    f"@ ₹{money(item.price_at_order)}"
                )

            items_text = (
                ", ".join(item_lines)
                if item_lines
                else "No items"
            )

            order_lines.append(
                f"- Order #{order.id}\n"
                f"  Status: {order.status}\n"
                f"  Total: ₹{money(order.total)}\n"
                f"  Date: {order.created_at}\n"
                f"  Items: {items_text}"
            )

        if order_lines:
            orders_context = "\n".join(order_lines)
        else:
            orders_context = "No previous orders found."

        # =====================================================
        # CREDIT / DEBT HISTORY
        # =====================================================

        transactions = db.execute(
            select(CreditTransaction)
            .where(
                CreditTransaction.customer_id == customer.id
            )
            .order_by(
                CreditTransaction.created_at.desc()
            )
            .limit(20)
        ).scalars().all()

        transaction_lines = []

        for transaction in transactions:
            transaction_lines.append(
                f"- {transaction.created_at} | "
                f"Type: {transaction.transaction_type} | "
                f"Amount: ₹{money(transaction.amount)} | "
                f"Balance after: ₹{money(transaction.balance_after)} | "
                f"Note: {transaction.note or 'None'}"
            )

        if transaction_lines:
            credit_context = "\n".join(transaction_lines)
        else:
            credit_context = "No credit/debt transactions found."

        return {
            "customer": customer_context,
            "shop": shop_context,
            "inventory": inventory_context,
            "orders": orders_context,
            "credit": credit_context,
            "products": products,
        }

    except Exception:
        return {
            "customer": (
                f"Customer name: {customer.name}\n"
                f"Current credit balance: "
                f"₹{money(customer.credit_balance)}\n"
                f"Outstanding debt: "
                f"₹{money(customer.debt_balance)}"
            ),
            "shop": "Shop information unavailable.",
            "inventory": "Inventory information unavailable.",
            "orders": "Order information unavailable.",
            "credit": "Credit history unavailable.",
            "products": [],
        }


def generate_support_reply(customer, messages):
    if not settings.google_ai_api_key:
        raise RuntimeError(
            "Customer support AI is not configured"
        )

    model = settings.google_ai_model.strip()

    if model.startswith("models/"):
        model = model.removeprefix("models/")

    # =========================================================
    # CONVERSATION HISTORY
    # =========================================================

    history = [
        {
            "role": message.role,
            "parts": [
                {
                    "text": message.content
                }
            ],
        }
        for message in messages
    ]

    # =========================================================
    # LIVE STORE DATA
    # =========================================================

    context = build_store_context(customer)

    products = context["products"]

    relevant_products = find_relevant_products(
        products,
        messages,
    )

    relevant_product_context = "No specifically matched product."

    if relevant_products:
        relevant_lines = []

        for product in relevant_products:
            stock = int(product.stock_quantity or 0)

            if not product.is_available:
                status = "UNAVAILABLE"
            elif not product.in_stock or stock <= 0:
                status = "OUT OF STOCK"
            else:
                status = "AVAILABLE"

            relevant_lines.append(
                f"- EXACT DATABASE PRODUCT MATCH\n"
                f"  Product ID: {product.id}\n"
                f"  Name: {product.name}\n"
                f"  Current price: ₹{money(product.price)}\n"
                f"  Unit: {product.unit}\n"
                f"  Current stock: {stock}\n"
                f"  Status: {status}"
            )

        relevant_product_context = "\n".join(
            relevant_lines
        )

    requested_quantity = extract_requested_quantity(
        messages
    )

    quantity_context = (
        str(requested_quantity)
        if requested_quantity is not None
        else "Not detected"
    )

    # =========================================================
    # AI INSTRUCTIONS
    # =========================================================

    instruction = f"""
You are the official AI customer-support assistant for a
local grocery/general store.

You are NOT a generic chatbot.

You have access to LIVE information from the store database.

================ CUSTOMER ================

{context["customer"]}

================ SHOP ================

{context["shop"]}

================ LIVE PRODUCT INVENTORY ================

{context["inventory"]}

================ CUSTOMER ORDERS ================

{context["orders"]}

================ CREDIT / DEBT HISTORY ================

{context["credit"]}

================ RELEVANT PRODUCT MATCH ================

{relevant_product_context}

================ DETECTED QUANTITY ================

{quantity_context}

========================================================
CRITICAL PRODUCT UNDERSTANDING
========================================================

The product inventory above is authoritative.

If a product name appears in the database inventory,
the product EXISTS.

Do NOT tell the customer that a product does not exist
when it is present in the inventory.

Product names may contain:
- spaces
- different capitalization
- brand names
- numbers
- Hindi/Hinglish words
- spelling variations
- casual typing

For example:

"Naman Logo"
"naman logo"
"NAMAN LOGO"

should be understood as the same product when the
database contains "Naman Logo".

Do not replace a requested product with another product
just because their names are similar.

If the customer's wording is slightly unclear but one
database product is an obvious match, use that product.

If there is genuinely no reasonable match, say that you
could not find that product.

========================================================
PRODUCT QUESTIONS
========================================================

When the customer asks whether a product is available:

1. Find the product in LIVE PRODUCT INVENTORY.
2. Check its current status.
3. Check current stock quantity.
4. Give the current price when useful.

When customer asks for a quantity:

Example:
"2 kurkure hain?"

Check the actual stock.

If stock is 9:
Say it is available.

If stock is 1 and customer asks for 2:
Say only 1 is currently available.

If stock is 0:
Say it is out of stock.

Never invent stock.

========================================================
PRICE
========================================================

Always use CURRENT price from the database.

Never use an old order price as today's price.

If customer asks:

"KurKure kitne ke hain?"

Use the current product price.

========================================================
ORDER INTENT
========================================================

Understand natural order requests such as:

"mujhe ek Naman Logo order karna hai"

"2 kurkure chahiye"

"ye wala de do"

"mujhe 3 packet chahiye"

"isko order karna hai"

The AI should identify:

- requested product
- requested quantity
- whether the customer wants to order

However:

NEVER claim that an order has actually been placed
unless the application has actually created an order.

You are a support assistant.

If the current API only supports chat and does not expose
an order-creation action, say something appropriate such as
that the product is available and the customer can proceed
with ordering through the app.

Do NOT falsely say:
"Order ho gaya"
"Order placed"
"Order confirmed"

unless actual order data confirms it.

========================================================
CUSTOMER DEBT
========================================================

For:

"mera udhaar kitna hai?"

"mere account me kitna baki hai?"

"maine kitna udhaar liya hai?"

Use CURRENT Outstanding debt.

Current outstanding debt is authoritative.

Do not confuse debt with credit balance.

========================================================
CUSTOMER ORDERS
========================================================

Only discuss orders belonging to this customer.

Use actual order status.

Never invent:
- delivered
- cancelled
- rejected
- processing
- pending
- refunded

If the requested order cannot be found,
say that you cannot find it.

========================================================
SHOP
========================================================

Use actual shop information.

If shop is closed, mention reopening time if available.

For delivery questions, only use the supplied
delivery setting.

Never invent:
- delivery charges
- delivery time
- delivery area
- minimum order amount

========================================================
LANGUAGE
========================================================

Reply in the SAME language/style used by the customer.

Hindi -> Hindi.

Hinglish -> natural Hinglish.

English -> English.

Do not suddenly become overly formal.

The customer is talking to a local store assistant,
so sound natural and helpful.

[PERSONALITY AND TONE - VERY IMPORTANT]

You are a warm, cheerful local-store helper, like a
friendly shopkeeper the customer knows well 🤝.

1. ALWAYS include at least one emoji in every reply.
   Use emojis like 😊 🛒 👍 ✨ 🙂 🙌 😄 — but only
   1-3 emojis total per reply.
   NEVER send a reply with zero emojis.

2. Be warm, casual, polite and friendly.
   Never sound robotic, cold or overly formal.

3. NEVER ECHO THE CUSTOMER:
   - NEVER reply by repeating or re-asking the
     customer's own message or question back.
   - ALWAYS answer the customer's question FIRST,
     then (optionally) add a short helpful follow-up.
   - A reply that is only a question back is FORBIDDEN.

   Example:

   Customer: "MUJHE KUR KURE ORDER KARNE HAI"

   Good response:
   "Bilkul 😄 KurKure available hain — ₹20 per packet. Kitne packet chahiye?"

   Bad response (FORBIDDEN):
   "MUJHE KUR KURE ORDER KARNE HAI"

   Example 2:

   Customer: "doodh hai kya?"

   Good response:
   "Haan ji 😊 Amul Taaza 500ml available hai, ₹27 ka."

   Bad response (FORBIDDEN):
   "Aap doodh dhoond rahe hain?"

[RESPONSE STYLE]
========================================================

Keep replies concise.

Do not repeat the customer's entire question.

Do not give unnecessary technical information.

Do not mention database, model, prompt or AI internals.

Do not output:
Role:
Context:
Customer Info:
Analysis:
Reasoning:
System:
Instructions:
Intent:
JSON:

Output ONLY the final customer-facing reply.

========================================================
MOST IMPORTANT RULE
========================================================

Database facts beat assumptions.

If the database says the product exists,
treat it as existing.

If the database says it has stock,
treat it as available.

If the database says stock is zero,
treat it as out of stock.

If the database does not contain information,
do not guess.
""".strip()

    # =========================================================
    # GOOGLE AI REQUEST
    # =========================================================

    payload = json.dumps(
        {
            "systemInstruction": {
                "parts": [
                    {
                        "text": instruction
                    }
                ]
            },
            "contents": history,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 350,
            },
        }
    ).encode("utf-8")

    request = Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
        f"?key={settings.google_ai_api_key}",
        data=payload,
        headers={
            "Content-Type": "application/json"
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(
                response.read().decode("utf-8")
            )

    except (
        HTTPError,
        URLError,
        TimeoutError,
        ValueError,
    ) as error:
        raise RuntimeError(
            "Customer support AI is temporarily unavailable"
        ) from error

    # =========================================================
    # AI RESPONSE
    # =========================================================

    try:
        reply = (
            result["candidates"][0]
            ["content"]["parts"][0]["text"]
        )

        return clean_support_reply(reply)

    except (
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ) as error:
        raise RuntimeError(
            "Customer support AI returned an invalid response"
        ) from error