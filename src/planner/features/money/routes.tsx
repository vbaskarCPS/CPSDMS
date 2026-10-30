import { Overview } from './screens/Overview';
import { Import } from './screens/Import';
import { Transactions } from './screens/Transactions';
import { Budget } from './screens/Budget';
import { Accounts } from './screens/Accounts';
import { Recurring } from './screens/Recurring';

export const moneyRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/money', element: <Overview /> },
  { path: '/money/import', element: <Import /> },
  { path: '/money/transactions', element: <Transactions /> },
  { path: '/money/budget', element: <Budget /> },
  { path: '/money/accounts', element: <Accounts /> },
  { path: '/money/recurring', element: <Recurring /> },
];
