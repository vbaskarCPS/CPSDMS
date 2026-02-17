// src/lib/dialer/dialerHeaders.ts
//
// Header resolution for callbook spreadsheets.
// Ported from Dialer.gs dialerResolveHeaders_.
// Maps flexible header names to 0-based column indices.
//

export interface ColumnIndices {
    PHONE: number;
    STREET: number;
    PREFIX: number;      // HOUSE #
    FIRST_NAME: number;
    LAST_NAME: number;
    NA: number;
    AER: number;
    NOTES: number;       // Call Notes
    PRICE: number;       // Previous Price
    BOOKING_ID: number;
    FO: number;
    YEAR: number;
    PMT_TYPE: number;
    ROUTE_CODE: number;
    CITY: number;
    WN: number;          // WN/NIS
    CONTRACTOR: number;
    YES: number;
    NO: number;
    REMOVE: number;
    PP: number;
    AMT: number;
    DATE1: number;       // DATE.1
    TIME: number;
    NAME: number;
    EMAIL: number;
    CPS_REP: number;
    SECOND: number;      // 2ND
    GATE: number;
    SPRINK: number;
    SP: number;
    BOOKING_NOTES: number;
    SERVICE_YEARS: { col: number; year: number }[];
  }
  
  /**
   * Create a default ColumnIndices with all fields set to -1.
   */
  function defaultCI(): ColumnIndices {
    return {
      PHONE: -1, STREET: -1, PREFIX: -1, FIRST_NAME: -1, LAST_NAME: -1,
      NA: -1, AER: -1, NOTES: -1, PRICE: -1, BOOKING_ID: -1,
      FO: -1, YEAR: -1, PMT_TYPE: -1, ROUTE_CODE: -1, CITY: -1, WN: -1,
      CONTRACTOR: -1,
      YES: -1, NO: -1, REMOVE: -1, PP: -1, AMT: -1,
      DATE1: -1, TIME: -1, NAME: -1, EMAIL: -1, CPS_REP: -1,
      SECOND: -1, GATE: -1, SPRINK: -1, SP: -1, BOOKING_NOTES: -1,
      SERVICE_YEARS: [],
    };
  }
  
  /**
   * Resolve headers from a row of header strings into ColumnIndices.
   * Handles common variations (e.g., "STREET NAME", "STREETNAME", "STREET_NAME" all map to STREET).
   * For columns that might appear multiple times, only the first match is used.
   */
  export function resolveHeaders(headers: any[]): ColumnIndices {
    const CI = defaultCI();
  
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] ?? '').trim().toUpperCase();
      if (!h) continue;
  
      if (h === 'PHONE') {
        CI.PHONE = i;
      } else if (h === 'STREET' || h === 'STREET NAME' || h === 'STREETNAME' || h === 'STREET_NAME') {
        CI.STREET = i;
      } else if (h === 'PREFIX' || h === 'HOUSE #' || h === 'HOUSE#' || h === 'HOUSE_NUM' || h === 'HOUSE NUM' || h === 'HOUSE') {
        CI.PREFIX = i;
      } else if (h === 'FIRST NAME' || h === 'FIRST_NAME' || h === 'FIRSTNAME') {
        CI.FIRST_NAME = i;
      } else if (h === 'LAST NAME' || h === 'LAST_NAME' || h === 'LASTNAME') {
        CI.LAST_NAME = i;
      } else if ((h === 'NA' || h === '#NA' || h === 'NA COUNT') && CI.NA < 0) {
        CI.NA = i;
      } else if (h === 'AER') {
        CI.AER = i;
      } else if ((h === 'NOTES' || h === 'CALL NOTES' || h === 'CALL_NOTES') && CI.NOTES < 0) {
        CI.NOTES = i;
      } else if ((h === 'PRICE' || h === 'PREVIOUS PRICE' || h === 'PREVIOUS_PRICE' || h === 'PREV PRICE') && CI.PRICE < 0) {
        CI.PRICE = i;
      } else if ((h === 'BOOKING ID' || h === 'BOOKING_ID' || h === 'BOOKINGID') && CI.BOOKING_ID < 0) {
        CI.BOOKING_ID = i;
      } else if ((h === 'CONTRACTOR NAME' || h === 'CONTRACTOR_NAME' || h === 'CONTRACTORNAME' || h === 'CONTRACTOR') && CI.CONTRACTOR < 0) {
        CI.CONTRACTOR = i;
      } else if (h === 'FO' && CI.FO < 0) {
        CI.FO = i;
      } else if (h === 'YEAR' && CI.YEAR < 0) {
        CI.YEAR = i;
      } else if ((h === 'PMT TYPE' || h === 'PMT_TYPE' || h === 'PMTTYPE') && CI.PMT_TYPE < 0) {
        CI.PMT_TYPE = i;
      } else if ((h === 'ROUTE CODE' || h === 'ROUTE_CODE' || h === 'ROUTECODE') && CI.ROUTE_CODE < 0) {
        CI.ROUTE_CODE = i;
      } else if (h === 'CITY' && CI.CITY < 0) {
        CI.CITY = i;
      } else if ((h === 'WN/NIS' || h === 'WN' || h === 'VN/N' || h === 'VN') && CI.WN < 0) {
        CI.WN = i;
      } else if (h === 'YES' && CI.YES < 0) {
        CI.YES = i;
      } else if (h === 'NO' && CI.NO < 0) {
        CI.NO = i;
      } else if ((h === 'REMOVE' || h === 'EMOV') && CI.REMOVE < 0) {
        CI.REMOVE = i;
      } else if (h === 'PP' && CI.PP < 0) {
        CI.PP = i;
      } else if ((h === 'AMT' || h === 'AMOUNT') && CI.AMT < 0) {
        CI.AMT = i;
      } else if ((h === 'DATE.1' || h === 'DATE1' || h === 'DATE 1') && CI.DATE1 < 0) {
        CI.DATE1 = i;
      } else if (h === 'TIME' && CI.TIME < 0) {
        CI.TIME = i;
      } else if (h === 'NAME' && CI.NAME < 0) {
        CI.NAME = i;
      } else if ((h === 'E-MAIL' || h === 'EMAIL' || h === 'E_MAIL') && CI.EMAIL < 0) {
        CI.EMAIL = i;
      } else if ((h === 'CPS REP' || h === 'CPS_REP' || h === 'CPSREP' || h === 'REP') && CI.CPS_REP < 0) {
        CI.CPS_REP = i;
      } else if ((h === '2ND' || h === 'SECOND') && CI.SECOND < 0) {
        CI.SECOND = i;
      } else if (h === 'GATE' && CI.GATE < 0) {
        CI.GATE = i;
      } else if ((h === 'SPRINK' || h === 'SPRINKLER') && CI.SPRINK < 0) {
        CI.SPRINK = i;
      } else if (h === 'SP' && CI.SP < 0) {
        CI.SP = i;
      } else if ((h === 'BOOKING NOTES' || h === 'BOOKING_NOTES') && CI.BOOKING_NOTES < 0) {
        CI.BOOKING_NOTES = i;
      } else if (/^\d{4}$/.test(h)) {
        CI.SERVICE_YEARS.push({ col: i, year: parseInt(h, 10) });
      }
    }
  
    // Sort service years descending (most recent first)
    CI.SERVICE_YEARS.sort((a, b) => b.year - a.year);
  
    return CI;
  }
  
  /**
   * Scan up to 10 rows to find headers (in case row 1 isn't the header).
   * Returns { headerRowIndex (0-based), CI }.
   */
  export function findHeaders(allData: any[][], maxScan: number = 10): { headerRowIndex: number; CI: ColumnIndices } {
    const scanLimit = Math.min(maxScan, allData.length);
  
    for (let r = 0; r < scanLimit; r++) {
      const CI = resolveHeaders(allData[r]);
      if (CI.PHONE >= 0) {
        return { headerRowIndex: r, CI };
      }
    }
  
    // Fallback: use row 0 even without PHONE
    return { headerRowIndex: 0, CI: resolveHeaders(allData[0] || []) };
  }