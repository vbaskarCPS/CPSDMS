// src/lib/trainingData.ts
import { Worker, ManagementUser, MasterBooking, RouteData } from '../types';

// --- TRAINING MODE CONSTANTS ---
export const TRAINING_USERNAME = 'training';
export const TRAINING_PASSWORD = 'training';
export const TRAINING_WORKER_ID = 'TRAINEE';
export const TRAINING_ROUTE_CODE = 'CPS01';

// --- MOCK WORKER ---
export const TRAINING_WORKER: Worker = {
  contractorId: TRAINING_WORKER_ID,
  firstName: 'Super',
  lastName: 'Star',
  cellPhone: '(555) 000-0000',
  email: 'superstar@training.com',
  status: 'Return',
  alumniRate: 0.25,
  silverRate: 0.50,
  assignedManagerId: 'rm_supercoach',
  upsellsEnabled: true,
};

// --- MOCK MANAGER ---
export const TRAINING_MANAGER: ManagementUser = {
  userId: 'rm_supercoach',
  name: 'Super Coach',
  username: 'coach',
  phone: '(555) 123-4567',
  role: 'RouteManager',
};

// --- MOCK ROUTE ---
export const TRAINING_ROUTE: RouteData = {
  routeCode: TRAINING_ROUTE_CODE,
  managerId: 'rm_supercoach',
  assignedWorkerIds: [TRAINING_WORKER_ID],
  streets: ['Records Dr', 'Sales St', 'Green Cl', 'Gold Pl', 'Silver Cir', 'Ratio Rd'],
};

// --- MOCK PREBOOKS ---
export const getTrainingBookings = (): MasterBooking[] => {
  const timestamp = Date.now();
  
  return [
    {
      'Booking ID': `training_${timestamp}_1`,
      'First Name': 'Wayne',
      'Last Name': 'Gretzky',
      'House Number': '99',
      'Street Name': 'Records Dr',
      'Full Address': '99 Records Dr',
      'Home Phone': '(780) 999-9999',
      'Cell Phone': '(780) 999-9999',
      'Email Address': 'thegreatone@oilers.com',
      'Route Number': TRAINING_ROUTE_CODE,
      'Price': '94.50',
      'FO/BO/FP': 'FP',
      'Log Sheet Notes': 'The Great One - Regular aeration',
      'Status': 'pending',
      'Prepaid': undefined,
      isPrebooked: true,
      sort_order: 0,
    },
    {
      'Booking ID': `training_${timestamp}_2`,
      'First Name': 'Sidney',
      'Last Name': 'Crosby',
      'House Number': '87',
      'Street Name': 'Gold Pl',
      'Full Address': '87 Gold Pl',
      'Home Phone': '(412) 871-8787',
      'Cell Phone': '(412) 871-8787',
      'Email Address': 'sid87@penguins.net',
      'Route Number': TRAINING_ROUTE_CODE,
      'Price': '63',
      'FO/BO/FP': 'FO',
      'Log Sheet Notes': 'Captain Crosby - Front only',
      'Status': 'pending',
      'Prepaid': undefined,
      isPrebooked: true,
      sort_order: 1,
    },
    {
      'Booking ID': `training_${timestamp}_3`,
      'First Name': 'Connor',
      'Last Name': 'McDavid',
      'House Number': '97',
      'Street Name': 'Silver Cir',
      'Full Address': '97 Silver Cir',
      'Home Phone': '(780) 970-9797',
      'Cell Phone': '(780) 970-9797',
      'Email Address': 'mcdavid97@fastmail.com',
      'Route Number': TRAINING_ROUTE_CODE,
      'Price': '84',
      'FO/BO/FP': 'BO',
      'Log Sheet Notes': 'Fastest skater - Back only',
      'Status': 'pending',
      'Prepaid': undefined,
      isPrebooked: true,
      sort_order: 2,
    },
    {
      'Booking ID': `training_${timestamp}_4`,
      'First Name': 'Mario',
      'Last Name': 'Lemieux',
      'House Number': '66',
      'Street Name': 'Sales St',
      'Full Address': '66 Sales St',
      'Home Phone': '(412) 666-1966',
      'Cell Phone': '(412) 666-1966',
      'Email Address': 'superMario@legends.ca',
      'Route Number': TRAINING_ROUTE_CODE,
      'Price': '131.25',
      'FO/BO/FP': 'FP',
      'Log Sheet Notes': 'Le Magnifique - PREPAID customer',
      'Status': 'pending',
      'Prepaid': 'x',
      isPrebooked: true,
      sort_order: 3,
    },
    {
      'Booking ID': `training_${timestamp}_5`,
      'First Name': 'Bobby',
      'Last Name': 'Orr',
      'House Number': '4',
      'Street Name': 'Ratio Rd',
      'Full Address': '4 Ratio Rd',
      'Home Phone': '(617) 440-0004',
      'Cell Phone': '(617) 440-0004',
      'Email Address': 'bobby4ever@bruins.org',
      'Route Number': TRAINING_ROUTE_CODE,
      'Price': 'RJ',
      'FO/BO/FP': 'FP',
      'Log Sheet Notes': 'Office upgrade - Lawn Rejuvenation flat',
      'Status': 'pending',
      'Prepaid': 'x',
      isPrebooked: true,
      sort_order: 4,
    },
  ];
};

// --- HELPER: Check if credentials are for training mode ---
export const isTrainingCredentials = (username: string, password: string): boolean => {
  return username.toLowerCase() === TRAINING_USERNAME && password.toLowerCase() === TRAINING_PASSWORD;
};