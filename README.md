# Local Grocery App

A clean-from-scratch local grocery application with a shared FastAPI backend, customer React app, and admin React panel. The architecture is intentionally simple and easy to modify.

## Stack
- Python 3 + FastAPI + SQLAlchemy + Pydantic
- SQLite locally; `DATABASE_URL` can point to PostgreSQL later
- JWT bearer sessions
- React + TypeScript + Vite
- Optional Firebase Cloud Messaging integration

## Structure
- `backend/` API, database, auth, services and tests
- `customer/` mobile-first customer web app
- `admin/` responsive admin panel

## Requirements
- Python 3.11+ (tested here with Python 3.13)
- Node.js 20+ (tested here with Node 22)
- npm

## Backend
Windows PowerShell:
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python seed.py
uvicorn app.main:app --reload --port 8001
```

Windows CMD activation: `venv\Scripts\activate`.

The SQLite database is automatically created when the API starts. `seed.py` adds the initial admin, categories, products, and shop settings.

### Customer support AI
Customer support is available in the customer app under **Support**. Set `GOOGLE_AI_API_KEY` in `backend/.env` to a Google AI Studio key. The model defaults to `gemma-4-31b-it` and can be overridden with `GOOGLE_AI_MODEL`; the key is used only by the backend.

### Test admin
- Phone: `9999999999`
- Password: `ChangeMe123!`

**Change these credentials in `.env` immediately for any real deployment.**

## Customer
```powershell
cd customer
npm install
npm run dev
```
Customer URL: http://localhost:5173

## Admin
```powershell
cd admin
npm install
npm run dev
```
Admin URL: http://localhost:5174

## Backend docs
- API: http://localhost:8001
- Swagger: http://localhost:8001/docs
- ReDoc: http://localhost:8001/redoc
- Health: http://localhost:8001/health

## Firebase later
Set `FIREBASE_CREDENTIALS_JSON` in `.env` to a JSON service-account object. The notification service stores every notification in SQLite regardless of Firebase configuration and only attempts push delivery when Firebase initializes successfully.

## Production
Set a strong `SECRET_KEY`, use PostgreSQL by changing `DATABASE_URL`, configure restricted CORS origins, use a production ASGI server/process manager, and change seeded admin credentials.

## Android later
The customer Vite web app can later be wrapped with a WebView/PWA/native shell such as Capacitor after the browser workflow is stable. APK generation is intentionally not part of local development.

## Tests
From `backend/`:
```powershell
pytest -q
```
The tests cover registration/verification, admin authentication, product creation/retrieval, delivery-off enforcement, and the beginning of the order flow. Extend the suite as production requirements grow.
