from fastapi import APIRouter

from app.api.v1 import activity, chains, credits, gift_cards, health, visits, wallets

api_router = APIRouter()
for module in (health, chains, gift_cards, visits, credits, activity, wallets):
    api_router.include_router(module.router)
