// src/planner/features/shop/index.ts — the shared shopping list (route wired in App.tsx) and the Today card.
import './shop.css';
export { ShopTodayCard, useShopLine } from './TodayCard';
export { loadList as loadShoppingList } from './store';
