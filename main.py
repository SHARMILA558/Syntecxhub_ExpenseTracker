from fastapi import FastAPI, HTTPException, Depends, Response, Cookie
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from pydantic import BaseModel, Field
from typing import Optional
import uuid, hashlib, secrets, time

app = FastAPI(title="Ledger API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")
templates = Jinja2Templates(directory="frontend/templates")

USERS: dict = {}
SESSIONS: dict = {}
EXPENSES: dict = {}
HISTORY: dict = {}

SESSION_TTL = 60 * 60 * 24 * 7

def _hash(pw): return hashlib.sha256(pw.encode()).hexdigest()
def _ts(): return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())

def _seed(username, password, currency="USD"):
    USERS[username] = {"password_hash": _hash(password), "currency": currency, "created_at": _ts()}
    EXPENSES[username] = []
    HISTORY[username] = []

def _log(username, action, detail):
    HISTORY[username].insert(0, {"action": action, "detail": detail, "timestamp": _ts()})
    HISTORY[username] = HISTORY[username][:200]

_seed("demo", "demo123", "USD")
for item in [
    {"description":"Grocery run","amount":84.50,"category":"Food","date":"2026-03-01"},
    {"description":"Electricity bill","amount":112.00,"category":"Utilities","date":"2026-03-02"},
    {"description":"Netflix subscription","amount":15.99,"category":"Entertainment","date":"2026-03-03"},
    {"description":"Gym membership","amount":49.00,"category":"Health","date":"2026-03-04"},
    {"description":"Monthly bus pass","amount":32.00,"category":"Transport","date":"2026-03-05"},
]:
    EXPENSES["demo"].append({"id": str(uuid.uuid4()), **item, "created_at": _ts()})
_log("demo", "SYSTEM", "Demo account initialized")

def _get_user(session_token: Optional[str] = Cookie(default=None)):
    if not session_token: return None
    s = SESSIONS.get(session_token)
    if not s or s["expires_at"] < time.time():
        SESSIONS.pop(session_token, None)
        return None
    return s["username"]

def _require_user(session_token: Optional[str] = Cookie(default=None)):
    u = _get_user(session_token)
    if not u: raise HTTPException(status_code=401, detail="Not authenticated")
    return u

class RegisterIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    password: str = Field(..., min_length=4, max_length=100)
    currency: str = Field(default="USD")

class LoginIn(BaseModel):
    username: str
    password: str

class ExpenseCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=200)
    amount: float = Field(..., gt=0)
    category: str = Field(..., min_length=1)
    date: str = Field(...)

class ExpenseUpdate(BaseModel):
    description: Optional[str] = Field(None, min_length=1, max_length=200)
    amount: Optional[float] = Field(None, gt=0)
    category: Optional[str] = None
    date: Optional[str] = None

class CurrencyUpdate(BaseModel):
    currency: str = Field(..., min_length=3, max_length=3)

@app.post("/api/auth/register", status_code=201)
async def register(body: RegisterIn, response: Response):
    uname = body.username.lower().strip()
    if uname in USERS: raise HTTPException(409, "Username already taken")
    _seed(uname, body.password, body.currency.upper())
    _log(uname, "REGISTER", f"Account created")
    token = secrets.token_hex(32)
    SESSIONS[token] = {"username": uname, "expires_at": time.time() + SESSION_TTL}
    response.set_cookie("session_token", token, httponly=True, samesite="lax", max_age=SESSION_TTL)
    return {"username": uname, "currency": body.currency.upper()}

@app.post("/api/auth/login")
async def login(body: LoginIn, response: Response):
    uname = body.username.lower().strip()
    user = USERS.get(uname)
    if not user or user["password_hash"] != _hash(body.password):
        raise HTTPException(401, "Invalid username or password")
    token = secrets.token_hex(32)
    SESSIONS[token] = {"username": uname, "expires_at": time.time() + SESSION_TTL}
    response.set_cookie("session_token", token, httponly=True, samesite="lax", max_age=SESSION_TTL)
    _log(uname, "LOGIN", "Logged in")
    return {"username": uname, "currency": user["currency"]}

@app.post("/api/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(default=None)):
    if session_token:
        uname = SESSIONS.get(session_token, {}).get("username")
        if uname: _log(uname, "LOGOUT", "Logged out")
        SESSIONS.pop(session_token, None)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}

@app.get("/api/auth/me")
async def me(session_token: Optional[str] = Cookie(default=None)):
    u = _get_user(session_token)
    if not u: return {"authenticated": False}
    return {"authenticated": True, "username": u, "currency": USERS[u]["currency"]}

@app.put("/api/settings/currency")
async def set_currency(body: CurrencyUpdate, username: str = Depends(_require_user)):
    old = USERS[username]["currency"]
    USERS[username]["currency"] = body.currency.upper()
    _log(username, "CURRENCY", f"Changed {old} → {body.currency.upper()}")
    return {"currency": body.currency.upper()}

@app.get("/api/expenses")
async def get_expenses(category: Optional[str]=None, sort_by: Optional[str]="date", username: str=Depends(_require_user)):
    exps = list(EXPENSES[username])
    if category and category != "All":
        exps = [e for e in exps if e["category"] == category]
    if sort_by == "amount": exps.sort(key=lambda x: x["amount"], reverse=True)
    elif sort_by == "description": exps.sort(key=lambda x: x["description"])
    else: exps.sort(key=lambda x: (x["date"], x.get("created_at","")), reverse=True)
    return {"expenses": exps, "total": round(sum(e["amount"] for e in exps),2), "currency": USERS[username]["currency"]}

@app.post("/api/expenses", status_code=201)
async def create_expense(expense: ExpenseCreate, username: str=Depends(_require_user)):
    record = {"id": str(uuid.uuid4()), **expense.model_dump(), "created_at": _ts()}
    EXPENSES[username].append(record)
    _log(username, "ADD", f"Added '{expense.description}' — {expense.amount} ({expense.category})")
    return record

@app.put("/api/expenses/{eid}")
async def update_expense(eid: str, updates: ExpenseUpdate, username: str=Depends(_require_user)):
    idx = next((i for i,e in enumerate(EXPENSES[username]) if e["id"]==eid), None)
    if idx is None: raise HTTPException(404, "Not found")
    r = EXPENSES[username][idx]
    for k,v in updates.model_dump(exclude_none=True).items(): r[k]=v
    EXPENSES[username][idx] = r
    _log(username, "EDIT", f"Edited '{r['description']}' → {r['amount']}")
    return r

@app.delete("/api/expenses/{eid}", status_code=204)
async def delete_expense(eid: str, username: str=Depends(_require_user)):
    idx = next((i for i,e in enumerate(EXPENSES[username]) if e["id"]==eid), None)
    if idx is None: raise HTTPException(404, "Not found")
    removed = EXPENSES[username].pop(idx)
    _log(username, "DELETE", f"Deleted '{removed['description']}'")

@app.get("/api/summary")
async def get_summary(username: str=Depends(_require_user)):
    exps = EXPENSES[username]
    total = round(sum(e["amount"] for e in exps),2)
    by_cat: dict = {}
    for e in exps:
        by_cat[e["category"]] = round(by_cat.get(e["category"],0)+e["amount"],2)
    return {"total":total,"count":len(exps),"by_category":by_cat,"categories":sorted(by_cat.keys()),"currency":USERS[username]["currency"]}

@app.get("/api/history")
async def get_history(limit: int=100, username: str=Depends(_require_user)):
    return {"history": HISTORY[username][:limit]}

@app.get("/{full_path:path}")
async def serve_frontend(request: Request, full_path: str):
    return templates.TemplateResponse("index.html", {"request": request})
