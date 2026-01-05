// src/lib/feedParser.ts
import * as XLSX from 'xlsx';
import { DailySessionData, ManagementUser, Worker, RouteData, MasterBooking } from '../types';
import { formatPhoneNumber, normalizeEmail } from './validationUtils';

// FIX: Create deterministic IDs so re-uploads don't create duplicate users
const generateConsistentId = (name: string, rolePrefix: string) => {
    return `${rolePrefix}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
};

const generateRMCredentials = (fullName: string) => {
  if (!fullName) return { username: '', password: '' };
  
  const parts = fullName.trim().split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || firstName; 

  const lastPart = lastName.substring(0, 3).toLowerCase();
  const firstPart = firstName.substring(0, 2).toLowerCase();
  const username = `${lastPart}${firstPart}`;
  const password = firstName; 

  return { username, password };
};

export const parseDailySessionXLSX = async (file: File): Promise<DailySessionData> => {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);

  const routesSheet = workbook.Sheets['Routes'];
  const workersSheet = workbook.Sheets['Workers'];
  const bookingsSheet = workbook.Sheets['Bookings'];

  if (!routesSheet || !workersSheet || !bookingsSheet) {
      throw new Error("Invalid Data Feed. Missing required tabs: 'Routes', 'Workers', or 'Bookings'.");
  }

  const routesData: any[] = XLSX.utils.sheet_to_json(routesSheet);
  const workersData: any[] = XLSX.utils.sheet_to_json(workersSheet);
  const bookingsData: any[] = XLSX.utils.sheet_to_json(bookingsSheet);

  const date = new Date().toISOString().split('T')[0];
  const managersMap = new Map<string, ManagementUser>();
  const routes: RouteData[] = [];
  
  // --- PROCESS ROUTES ---
  routesData.forEach((row: any) => {
    const managerName = row['Manager Assignment']?.trim();
    const routeCode = row['RT #']?.trim();
    const streetListRaw = row['Street_List'];

    if (managerName && routeCode) {
      if (!managersMap.has(managerName)) {
        const { username, password } = generateRMCredentials(managerName);
        managersMap.set(managerName, {
          userId: generateConsistentId(managerName, 'rm'), // Deterministic ID
          name: managerName,
          username,
          password,
          role: 'RouteManager'
        });
      }
      
      let streets: string[] = [];
      if (typeof streetListRaw === 'string') {
          streets = streetListRaw.split(',').map(s => s.trim()).filter(Boolean);
      }

      const manager = managersMap.get(managerName)!;
      routes.push({ 
          routeCode, 
          managerId: manager.userId, 
          assignedWorkerId: null,
          streets 
      });
    }
  });

  const managers = Array.from(managersMap.values());

  // --- PROCESS WORKERS ---
  const workers: Worker[] = workersData.map((row: any) => {
    const managerName = row['Manager']?.trim();
    const assignedManager = managers.find(m => m.name === managerName);
    const fullName = `${row['First Name']} ${row['Last Name']}`;

    const findVal = (keywords: string[]) => {
      const key = Object.keys(row).find(k => 
        keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
      );
      return key ? row[key] : undefined;
    };

    const alumniRate = Number(findVal(['Alumni']) || 0);
    const silverRate = Number(findVal(['Silver']) || 0);

    return {
      contractorId: row['Contractor ID'] ? String(row['Contractor ID']) : generateConsistentId(fullName, 'wk'),
      firstName: row['First Name'],
      lastName: row['Last Name'],
      cellPhone: formatPhoneNumber(row['Cell Phone'] || ''),
      status: 'Return' as const,
      assignedManagerId: assignedManager ? assignedManager.userId : undefined,
      alumniRate: isNaN(alumniRate) ? 0 : alumniRate,
      silverRate: isNaN(silverRate) ? 0 : silverRate,
    };
  }).filter((w: any) => w.contractorId);

  // --- PROCESS BOOKINGS ---
  const pendingBookings: MasterBooking[] = bookingsData.map((row: any, index: number) => {
    const routeNum = row['Route #'];
    if (!routeNum) return null;

    return {
      'Booking ID': `job_${index}_${Date.now()}`, 
      'Route Number': routeNum,
      'First Name': row['First Name'],
      'Last Name': row['Last Name'],
      'House Number': row['House #'],
      'Street Name': row['Street Name'],
      'Full Address': `${row['House #'] || ''} ${row['Street Name'] || ''}`.trim(),
      'Home Phone': formatPhoneNumber(row['Phone #'] || ''),
      'Email Address': normalizeEmail(row['E-Mail'] || ''),
      'Price': row['AER. AMT'], 
      'FO/BO/FP': row['Service Type'], 
      'Prepaid': row['PP']?.toLowerCase() === 'x' ? 'x' : undefined,
      'Log Sheet Notes': row['Call 1st'] || '', 
      'Status': 'pending',
      'Completed': undefined,
      isPrebooked: true,
    } as MasterBooking;
  }).filter(Boolean) as MasterBooking[];

  return { date, managers, workers, routes, pendingBookings };
};