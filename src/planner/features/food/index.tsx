// src/planner/features/food/index.ts — the photo calorie tracker: routes and the Today card.
import './food.css';
import { FoodToday, FoodTodayCard } from './FoodToday';
import { AddMeal, EditMeal } from './AddMeal';
import { History } from './History';
import { TargetsScreen } from './Targets';
import { Favourites } from './Favourites';
import { SwayGuide } from './sway/SwayGuide';
import { Recipes } from './Recipes';
import { RecipePage } from './RecipePage';

export { FoodTodayCard };
export { ProteinRoad } from './ProteinRoad';
export { slotMeal, afterKitchen } from './protein';
export { alreadyLoggedFor, fromRoad } from './dupes';
export { removeMeal, saveMeal, mealKey } from './model';

export const foodRoutes = [
  { path: '/food', element: <FoodToday /> },
  { path: '/food/add', element: <AddMeal /> },
  { path: '/food/meal/:key', element: <EditMeal /> },
  { path: '/food/history', element: <History /> },
  { path: '/food/targets', element: <TargetsScreen /> },
  { path: '/food/favourites', element: <Favourites /> },
  { path: '/food/sway', element: <SwayGuide /> },
  { path: '/food/recipes', element: <Recipes /> },
  { path: '/food/recipes/:id', element: <RecipePage /> },
];
