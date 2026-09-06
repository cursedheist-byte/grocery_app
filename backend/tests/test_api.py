import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"]="sqlite:///./test_grocery.db"
os.environ["SECRET_KEY"]="test-secret"
os.environ["ADMIN_PHONE"]="9999999999"
os.environ["ADMIN_PASSWORD"]="ChangeMe123!"
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models import *
from app.auth.security import hash_password

Base.metadata.drop_all(engine); Base.metadata.create_all(engine)
db=SessionLocal(); u=User(phone="9999999999",role="ADMIN",password_hash=hash_password("ChangeMe123!")); u.admin=Admin(name="Admin"); db.add(u); c=Category(name="Test"); db.add(c); db.commit(); db.close()
client=TestClient(app)

def admin_headers():
    r=client.post('/api/auth/admin/login',json={'phone':'9999999999','password':'ChangeMe123!'}); return {'Authorization':'Bearer '+r.json()['access_token']}

def test_registration_and_verification():
    r=client.post('/api/auth/register',json={'name':'Rahul Sharma','phone':'8888888888'}); assert r.status_code==200
    token=r.json()['access_token']; assert client.get('/api/customers/me',headers={'Authorization':'Bearer '+token}).json()['name']=='Rahul Sharma'
    assert r.json()['verification_status']=='pending'
    cid=r.json()['customer_id']; h=admin_headers(); r=client.patch(f'/api/customers/{cid}/verification?status=verified',headers=h); assert r.status_code==200
    assert next(x for x in client.get('/api/customers/admin',headers=h).json() if x['id']==cid)['name']=='Rahul Sharma'

def test_product_create_retrieve():
    h=admin_headers(); r=client.post('/api/products',headers=h,json={'name':'Apples','price':'120','unit':'1 kg','category_id':1}); assert r.status_code==200
    assert any(x['name']=='Apples' for x in client.get('/api/products').json())

def test_delivery_off_and_order_flow():
    h=admin_headers(); s=client.get('/api/shop').json(); s['home_delivery_enabled']=False; client.put('/api/shop',headers=h,json=s)
    r=client.post('/api/auth/register',json={'name':'Order User','phone':'7777777777'}); token=r.json()['access_token']; cid=r.json()['customer_id']; client.patch(f'/api/customers/{cid}/verification?status=verified',headers=h)
    ch={'Authorization':'Bearer '+token}; address = client.post('/api/customers/me/addresses',headers=ch,json={'house_no':'1 Main Road'}); assert address.status_code == 200; assert address.json()['house_no']=='1 Main Road'
    # protected cart works after verification; delivery switch blocks order
    p=client.get('/api/products').json()[0]; client.post('/api/cart/items',headers=ch,json={'product_id':p['id'],'quantity':1})
    r=client.post('/api/orders',headers=ch,json={'address_id':1}); assert r.status_code==400

def test_credit_and_debt_are_net_balanced():
    h=admin_headers()

    first=client.post('/api/auth/register',json={'name':'Credit First','phone':'6666666666'}).json()
    first_id=first['customer_id']
    assert float(client.post(f'/api/customers/{first_id}/credit/change',headers=h,json={'amount':'200'}).json()['credit_balance'])==200
    first_result=client.post(f'/api/customers/{first_id}/debt/change',headers=h,json={'amount':'10'}).json()
    assert float(first_result['credit_balance'])==190
    assert float(first_result['debt_balance'])==0

    second=client.post('/api/auth/register',json={'name':'Debt First','phone':'5555555555'}).json()
    second_id=second['customer_id']
    assert float(client.post(f'/api/customers/{second_id}/debt/change',headers=h,json={'amount':'200'}).json()['debt_balance'])==200
    second_result=client.post(f'/api/customers/{second_id}/credit/change',headers=h,json={'amount':'10'}).json()
    assert float(second_result['credit_balance'])==0
    assert float(second_result['debt_balance'])==190
