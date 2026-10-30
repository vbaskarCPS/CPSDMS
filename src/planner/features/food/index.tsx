// src/planner/features/food/index.ts — the photo calorie tracker: routes and the Today card.
import './food.css';
import { FoodToday, FoodTodayCard } from './FoodToday';
import { AddMeal, EditMeal } from './AddMeal';
import { History } from './History';
import { TargetsScreen } from './Targets';
import { Favourites } from './Favourites';

export { FoodTodayCard };

export const foodRoutes = [
  { path: '/food', element: <FoodToday /> },
  { path: '/food/add', element: <AddMeal /> },
  { path: '/food/meal/:key', element: <EditMeal /> },
  { path: '/food/history', element: <History /> },
  { path: '/food/targets', element: <TargetsScreen /> },
  { path: '/food/favourites', element: <Favourites /> },
];
