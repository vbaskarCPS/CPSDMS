// src/lib/feedParser.ts
import * as XLSX from 'xlsx';
import { commandCenterService } from './commandCenterService';
import { DailySessionData, ManagementUser, Worker, RouteData, MasterBooking } from '../types';
import { formatPhoneNumber, normalizeEmail } from './validationUtils';

/**
 * Parses a Daily Session Excel file and returns structured data.
 * Associates all data with the current command center.
 */
export async function parseDailySessionXLSX(file: File): Promise<DailySessionData> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Expected sheets
        const managersSheet = workbook.Sheets['Managers'];
        const workersSheet = workbook.Sheets['Workers'];
        const routesSheet = workbook.Sheets['Routes'];
        const bookingsSheet = workbook.Sheets['Bookings'];
        
        if (!managersSheet || !workersSheet || !routesSheet) {
          throw new Error('Missing required sheets. Expected: Managers, Workers, Routes');
        }
        
        // Parse managers
        const managersRaw = XLSX.utils.sheet_to_json<any>(managersSheet, { defval: '' });
        const managers: ManagementUser[] = [];
        const managersMap = new Map<string, ManagementUser>();
        
        managersRaw.forEach((row, idx) => {
          const name = row['Manager Name']?.toString().trim() || row['Name']?.toString().trim();
          const password = row['Password']?.toString().trim();
          const phone = row['Phone']?.toString().trim() || '';
          
          if (!name) return;
          if (!password) {
            console.warn(`⚠️ Manager "${name}" has no password, skipping.`);
            return;
          }
          
          const userId = generateConsistentId(name, 'rm');
          const username = generateRMUsername(name);
          
          const manager: ManagementUser = {
            userId,
            name,
            username,
            password,
            phone: formatPhoneNumber(phone),
            role: 'RouteManager',
            commandCenterId: ccId || undefined,
          };
          
          managers.push(manager);
          managersMap.set(name, manager);
        });
        
        // Parse workers
        const workersRaw = XLSX.utils.sheet_to_json<any>(workersSheet, { defval: '' });
        const workers: Worker[] = [];
        
        workersRaw.forEach((row) => {
          const contractorId = row['Contractor ID']?.toString().trim() || row['ID']?.toString().trim();
          const firstName = row['First Name']?.toString().trim() || '';
          const lastName = row['Last Name']?.toString().trim() || '';
          const cellPhone = row['Cell Phone']?.toString().trim() || row['Phone']?.toString().trim() || '';
          const email = row['Email']?.toString().trim() || '';
          const managerName = row['Manager']?.toString().trim() || '';
          const alumniRate = parseFloat(row['Alumni Rate']) || 0.40;
          const silverRate = parseFloat(row['Silver Rate']) || 0.50;
          const status = row['Status']?.toString().trim() || 'Return';
          
          if (!contractorId) {
            console.warn(`⚠️ Worker ${firstName} ${lastName} has no contractor ID, skipping.`);
            return;
          }
          
          const assignedManager = managersMap.get(managerName);
          
          workers.push({
            contractorId,
            firstName,
            lastName,
            cellPhone: formatPhoneNumber(cellPhone),
            email: normalizeEmail(email),
            status: status as 'Rookie' | 'Return' | 'Alumni',
            alumniRate,
            silverRate,
            assignedManagerId: assignedManager?.userId,
            upsellsEnabled: true,
            commandCenterId: ccId || undefined,
          });
        });
        
        // Parse routes
        const routesRaw = XLSX.utils.sheet_to_json<any>(routesSheet, { defval: '' });
        const routes: RouteData[] = [];
        
        routesRaw.forEach((row) => {
          const routeCode = row['Route Code']?.toString().trim() || row['Route']?.toString().trim();
          const managerName = row['Manager']?.toString().trim() || '';
          const streetsRaw = row['Streets']?.toString() || '';
          
          if (!routeCode) return;
          
          const manager = managersMap.get(managerName);
          if (managerName && !manager) {
            console.warn(`⚠️ Route ${routeCode} references manager "${managerName}" not found. Skipping.`);
            return;
          }
          
          const streets = streetsRaw.split(',').map(s => s.trim()).filter(Boolean);
          
          routes.push({
            routeCode,
            managerId: manager?.userId || '',
            assignedWorkerIds: [],
            streets,
            commandCenterId: ccId || undefined,
          });
        });
        
        // Parse bookings (optional)
        const pendingBookings: MasterBooking[] = [];
        
        if (bookingsSheet) {
          const bookingsRaw = XLSX.utils.sheet_to_json<any>(bookingsSheet, { defval: '' });
          
          bookingsRaw.forEach((row, idx) => {
            const routeNumber = row['Route']?.toString().trim() || row['Route Number']?.toString().trim();
            if (!routeNumber) return;
            
            const booking: MasterBooking = {
              'Booking ID': row['Booking ID']?.toString() || `job_${idx}_${Date.now()}`,
              'Route Number': routeNumber,
              'First Name': row['First Name']?.toString().trim() || '',
              'Last Name': row['Last Name']?.toString().trim() || '',
              'Full Address': row['Address']?.toString().trim() || row['Full Address']?.toString().trim() || '',
              'Home Phone': formatPhoneNumber(row['Phone']?.toString() || row['Home Phone']?.toString() || ''),
              'Cell Phone': formatPhoneNumber(row['Cell Phone']?.toString() || ''),
              'Email Address': normalizeEmail(row['Email']?.toString() || row['Email Address']?.toString() || ''),
              'Price': row['Price']?.toString() || '',
              'FO/BO/FP': row['Service Type']?.toString().trim() as any || row['FO/BO/FP']?.toString().trim() as any,
              'Prepaid': row['Prepaid']?.toString().toLowerCase() === 'x' || row['Prepaid']?.toString().toLowerCase() === 'yes' ? 'x' : undefined,
              'Log Sheet Notes': row['Notes']?.toString() || row['Log Sheet Notes']?.toString() || '',
              'Status': 'pending',
              isPrebooked: true,
              sort_order: idx,
              commandCenterId: ccId || undefined,
            };
            
            pendingBookings.push(booking);
          });
        }
        
        // Get today's date
        const date = new Date().toISOString().split('T')[0];
        
        const result: DailySessionData = {
          date,
          managers,
          workers,
          routes,
          pendingBookings,
          commandCenterId: ccId || undefined,
        };
        
        // Add import metadata for file-based imports
        (result as any)._importMeta = {
          source: 'file',
          sheetsExported: false
        };
        
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Helper functions
function generateConsistentId(name: string, rolePrefix: string): string {
  return `${rolePrefix}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function generateRMUsername(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || firstName;
  const lastPart = lastName.substring(0, 3).toLowerCase();
  const firstPart = firstName.substring(0, 2).toLowerCase();
  return `${lastPart}${firstPart}`;
}