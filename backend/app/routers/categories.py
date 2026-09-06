from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Category
from ..schemas import CategoryIn, CategoryOut
from ..auth.dependencies import admin_user

router=APIRouter(prefix="/api/categories", tags=["categories"])
@router.get("", response_model=list[CategoryOut])
def categories(db:Session=Depends(get_db)): return db.query(Category).filter(Category.is_active==True).order_by(Category.name).all()
@router.get("/admin", response_model=list[CategoryOut])
def admin_categories(db:Session=Depends(get_db), _=Depends(admin_user)): return db.query(Category).order_by(Category.name).all()
@router.post("", response_model=CategoryOut)
def create(data:CategoryIn, db:Session=Depends(get_db), _=Depends(admin_user)):
    c=Category(**data.model_dump()); db.add(c); db.commit(); db.refresh(c); return c
@router.put("/{category_id}", response_model=CategoryOut)
def update(category_id:int,data:CategoryIn,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Category,category_id)
    if not c: raise HTTPException(404,"Category not found")
    for k,v in data.model_dump().items(): setattr(c,k,v)
    db.commit(); db.refresh(c); return c
@router.delete("/{category_id}")
def delete(category_id:int,db:Session=Depends(get_db),_=Depends(admin_user)):
    c=db.get(Category,category_id)
    if not c: raise HTTPException(404,"Category not found")
    c.is_active=False; db.commit(); return {"message":"Category disabled"}
