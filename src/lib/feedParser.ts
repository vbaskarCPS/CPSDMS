// src/lib/feedParser.ts
import * as XLSX from 'xlsx';
import { DailySessionData, ManagementUser, Worker, RouteData, MasterBooking } from '../types';
import { formatPhoneNumber, normalizeEmail } from './validationUtils';

// FIX: Create deterministic IDs so re-uploads don't create duplicate users
const generateConsistentId = (name: string, rolePrefix: string) => {
    return `${rolePrefix}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
};

const generateRMUsername = (fullName: string): string => {
  if (!fullName) return '';
  
  const parts = fullName.trim().split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || firstName; 

  const lastPart = lastName.substring(0, 3).toLowerCase();
  const firstPart = firstName.substring(0, 2).toLowerCase();
  return `${lastPart}${firstPart}`;
};

export const parseDailySessionXLSX = async (file: File): Promise<DailySessionData> => {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);

  const routesSheet = workbook.Sheets['Routes'];
  const workersSheet = workbook.Sheets['Workers'];
  const bookingsSheet = workbook.Sheets['Bookings'];
  const managersSheet = workbook.Sheets['Managers'];

  if (!routesSheet || !workersSheet || !bookingsSheet) {
      throw new Error("Invalid Data Feed. Missing required tabs: 'Routes', 'Workers', or 'Bookings'.");
  }

  if (!managersSheet) {
      throw new Error("Invalid Data Feed. Missing required tab: 'Managers'.");
  }

  // Use { raw: false } to prevent Excel scientific notation issues (e.g., E1000)
  const routesData: any[] = XLSX.utils.sheet_to_json(routesSheet, { raw: false });
  const workersData: any[] = XLSX.utils.sheet_to_json(workersSheet, { raw: false });
  const bookingsData: any[] = XLSX.utils.sheet_to_json(bookingsSheet, { raw: false });
  const managersData: any[] = XLSX.utils.sheet_to_json(managersSheet, { raw: false });

  const date = new Date().toISOString().split('T')[0];
  
  // --- PROCESS MANAGERS (from Managers tab) ---
  const managersMap = new Map<string, ManagementUser>();
  
  managersData.forEach((row: any, index: number) => {
    const managerName = row['Manager Name']?.trim();
    const phoneNumber = row['Phone Number'] ? String(row['Phone Number']).trim() : '';
    const password = row['Password'] ? String(row['Password']).trim() : '';

    if (!managerName) {
      console.warn(`⚠️ Managers Row ${index + 2} has no Manager Name, skipping.`);
      return;
    }

    if (!password) {
      console.warn(`⚠️ Managers Row ${index + 2} (${managerName}) has no Password, skipping.`);
      return;
    }

    const username = generateRMUsername(managerName);
    
    managersMap.set(managerName, {
      userId: generateConsistentId(managerName, 'rm'),
      name: managerName,
      username,
      password,
      phone: formatPhoneNumber(phoneNumber),
      role: 'RouteManager'
    });
  });

  const managers = Array.from(managersMap.values());

  // --- PROCESS ROUTES ---
  const routes: RouteData[] = [];
  
  routesData.forEach((row: any) => {
    const managerName = row['Manager Assignment']?.trim();
    const routeCode = row['RT #']?.trim();
    const streetListRaw = row['Street_List'];

    if (!routeCode) return;

    if (managerName && !managersMap.has(managerName)) {
      console.warn(`⚠️ Route ${routeCode} references manager "${managerName}" not found in Managers tab. Skipping route.`);
      return;
    }

    if (managerName && routeCode) {
      let streets: string[] = [];
      if (typeof streetListRaw === 'string') {
          streets = streetListRaw.split(',').map(s => s.trim()).filter(Boolean);
      }

      const manager = managersMap.get(managerName)!;
      routes.push({ 
          routeCode, 
          managerId: manager.userId, 
          assignedWorkerIds: [],
          streets 
      });
    }
  });

  // --- PROCESS WORKERS ---
  const workers: Worker[] = workersData.map((row: any, index: number) => {
    const managerName = row['Manager']?.trim();
    const assignedManager = managers.find(m => m.name === managerName);
    const fullName = `${row['First Name'] || ''} ${row['Last Name'] || ''}`.trim();

    // Get Contractor ID - handle null, undefined, empty string, and 0
    const rawContractorId = row['Contractor ID'];
    const contractorId = (rawContractorId !== undefined && rawContractorId !== null && String(rawContractorId).trim() !== '') 
      ? String(rawContractorId).trim()
      : generateConsistentId(fullName, 'wk');

    // Debug logging for troubleshooting
    if (!contractorId || contractorId === 'wk_') {
      console.warn(`⚠️ Workers Row ${index + 2} has invalid ID:`, { 
        rawId: rawContractorId, 
        firstName: row['First Name'],
        lastName: row['Last Name'],
        generatedId: contractorId 
      });
    }

    const findVal = (keywords: string[]) => {
      const key = Object.keys(row).find(k => 
        keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
      );
      return key ? row[key] : undefined;
    };

    const alumniRate = Number(findVal(['Alumni']) || 0);
    const silverRate = Number(findVal(['Silver']) || 0);

    return {
      contractorId,
      firstName: row['First Name'] || '',
      lastName: row['Last Name'] || '',
      cellPhone: formatPhoneNumber(row['Cell Phone'] || ''),
      status: 'Return' as const,
      assignedManagerId: assignedManager ? assignedManager.userId : undefined,
      alumniRate: isNaN(alumniRate) ? 0 : alumniRate,
      silverRate: isNaN(silverRate) ? 0 : silverRate,
    };
  }).filter((w: any) => w.contractorId && w.contractorId !== 'wk_');

  // --- PROCESS BOOKINGS ---
  const pendingBookings: MasterBooking[] = bookingsData.map((row: any, index: number) => {
    const routeNum = row['Route #'];
    if (!routeNum) return null;

    return {
      'Booking ID': `job_${index}_${Date.now()}`, 
      'Route Number': routeNum,
      'First Name': row['First Name'] || '',
      'Last Name': row['Last Name'] || '',
      'House Number': row['House #'] || '',
      'Street Name': row['Street Name'] || '',
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
      sort_order: index, // ADDED: Preserve original Excel row order
    } as MasterBooking;
  }).filter(Boolean) as MasterBooking[];

  return { date, managers, workers, routes, pendingBookings };
};