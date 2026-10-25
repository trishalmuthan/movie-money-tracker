from fastapi import APIRouter

from app.api.v1 import chains, credits, gift_cards, health, visits

api_router = APIRouter()
for module in (health, chains, gift_cards, visits, credits):
    api_router.include_router(module.router)
