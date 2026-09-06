from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.models import User, Customer
from app.auth.security import hash_password, create_access_token

engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
TestingSession = sessionmaker(bind=engine, autoflush=False)
Base.metadata.create_all(engine)
db = TestingSession()
db.add(User(phone='9999', role='ADMIN', password_hash=hash_password('x')))
c = User(phone='8888', role='CUSTOMER', password_hash=hash_password('x'))
db.add(c); db.flush()
db.add(Customer(user_id=c.id, name='Test Cust', verification_code='1234', verification_status='verified'))
db.commit(); db.close()

def override():
    s = TestingSession()
    try:
        yield s
    finally:
        s.close()
app.dependency_overrides[get_db] = override
client = TestClient(app)

def check(r, label):
    if r.status_code >= 300:
        raise AssertionError(f"{label} failed: {r.status_code} {r.text}")
    return r

r = check(client.post('/api/auth/admin/login', json={'phone': '9999', 'password': 'x'}), 'admin login')
A = {'Authorization': 'Bearer ' + r.json()['access_token']}
C = {'Authorization': 'Bearer ' + create_access_token(2, 'CUSTOMER')}

r = check(client.post('/api/item-requests', headers=C, json={'item_name': 'Jaggery', 'quantity': 2, 'max_price': 80}), 'create')
req = r.json()

for action in ('ARRIVED', 'NOT_FOUND', 'PRICE_RANGE', 'TOO_HEAVY', 'SEEN'):
    payload = {'action': action, 'admin_price': 75 if action == 'ARRIVED' else None}
    r = check(client.patch(f"/api/item-requests/{req['id']}/respond", headers=A, json=payload), action)
    print(action, '->', r.json()['status'])

r = check(client.get('/api/shop'), 'shop settings')
assert 'lists_page_image_url' in r.json() and 'requests_page_image_url' in r.json()
print('new image slots in /api/shop: OK')

r = client.put('/api/shop', headers=A, json={
    'shop_name': 'Test Shop', 'is_open': True, 'home_delivery_enabled': True,
    'lists_page_image_url': 'http://x/lists.png', 'requests_page_image_url': 'http://x/req.png',
})
check(r, 'shop update')
r = check(client.get('/api/shop'), 'shop re-read')
assert r.json()['lists_page_image_url'] == 'http://x/lists.png'
print('image slots saved via PUT /api/shop: OK')
print('ALL TESTS PASSED')
