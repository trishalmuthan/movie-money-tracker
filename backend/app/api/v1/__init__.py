from fastapi import APIRouter

from app.api.v1 import chains, gift_cards, health

api_router = APIRouter()
for module in (health, chains, gift_cards):
    api_router.include_router(module.router)
