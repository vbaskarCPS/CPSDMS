// src/lib/dialer/dialerCCD.ts
//
// CCD (Credit Card Data) tab write logic for prepay finalization.
// Ported from finalizePrepay in Dialer.gs.
// Builds data for a new CCD row from the callbook source row + card details.
//

import { ColumnIndices } from './dialerHeaders';
import { normalizePhone, parseYear } from './dialerUtils';

// --- Types ---

export interface StagedCard {
  cardType: string;    // 'VISA' | 'MC' | 'AMEX' | 'OTHER'
  cardNumber: string;
  expiry: string;
  cvv: string;
  amount: string;
}

export interface CCDWriteData {
  /** The row values to append to CCD tab (1D array matching CCD column count) */
  rowValues: any[];
  /** The column index (0-based) of the card number for text formatting */
  cardNumberCol: number;
  /** The card number value (for text formatting after write) */
  cardNumberValue: string;
}

/**
 * Detect card type from card number.
 */
export function detectCardType(cardNum: string): string {
  const clean = cardNum.replace(/[\s-]/g, '');
  if (clean.length === 0) return 'OTHER';

  const f1 = clean.charAt(0);
  const f2 = clean.length >= 2 ? parseInt(clean.substring(0, 2), 10) : 0;
  const f4 = clean.length >= 4 ? parseInt(clean.substring(0, 4), 10) : 0;

  if (f1 === '4') return 'VISA';
  if ((f2 >= 51 && f2 <= 55) || (f4 >= 2221 && f4 <= 2720)) return 'MC';
  if (f1 === '3') return 'AMEX';
  return 'OTHER';
}

/**
 * Build a CCD row from source data + card details.
 *
 * @param sourceRowData   Array of cell values from the most-recent-year callbook row (already has booking details written)
 * @param sourceHeaders   Array of header strings from the callbook
 * @param ccdHeaders      Array of header strings from the CCD tab
 * @param cardData        Staged card information
 * @param repCode         Rep code for CPS REP column
 * @param extraData       Extra booking data (email, name) from the YES form
 */
export function buildCCDRow(
  sourceRowData: any[],
  sourceHeaders: any[],
  ccdHeaders: any[],
  cardData: StagedCard,
  repCode: string,
  extraData: { email?: string; name?: string; price?: string }
): CCDWriteData {
  const ccdColCount = ccdHeaders.length;

  // Build case-insensitive source header map (header → 0-based col index)
  const srcMap: Record<string, number> = {};
  for (let c = 0; c < sourceHeaders.length; c++) {
    const hUp = String(sourceHeaders[c] ?? '').trim().toUpperCase();
    if (hUp && srcMap[hUp] === undefined) srcMap[hUp] = c;
  }

  // Build case-insensitive CCD header map (header → 1-based col index)
  const ccdMap: Record<string, number> = {};
  for (let c = 0; c < ccdHeaders.length; c++) {
    const hUp = String(ccdHeaders[c] ?? '').trim().toUpperCase();
    if (hUp) ccdMap[hUp] = c + 1;
  }

  // Initialize destination row with empty strings
  const destData: any[] = new Array(ccdColCount).fill('');

  // Copy matching columns (case-insensitive)
  for (let c = 0; c < ccdHeaders.length; c++) {
    const hdr = String(ccdHeaders[c] ?? '').trim().toUpperCase();
    if (hdr !== '' && srcMap[hdr] !== undefined) {
      destData[c] = sourceRowData[srcMap[hdr]];
    }
  }

  // Explicitly set email and name from YES form data (in case columns don't match)
  if (extraData.email) {
    const emailCol = ccdMap['E-MAIL'] || ccdMap['EMAIL'] || ccdMap['E_MAIL'];
    if (emailCol) destData[emailCol - 1] = extraData.email;
  }
  if (extraData.name) {
    const nameCol = ccdMap['NAME'] || ccdMap['FIRST NAME'] || ccdMap['FIRSTNAME'];
    if (nameCol) destData[nameCol - 1] = extraData.name;
  }

  // Write card data columns
  const cardTypeCol = ccdMap['CARD TYPE'];
  const cardNumCol = ccdMap['CARD NUMBER'];
  const expCol = ccdMap['EXPIRY'];
  const cvcCol = ccdMap['CVC'] || ccdMap['CVV'];
  const amtCol = ccdMap['AMOUNT'] || ccdMap['AMT'];
  const svcCol = ccdMap['SERVICE'];
  const repCol = ccdMap['CPS REP'];
  const dateCol = ccdMap['DATE.1'] || ccdMap['DATE'];

  if (cardTypeCol) destData[cardTypeCol - 1] = cardData.cardType;
  if (cardNumCol) destData[cardNumCol - 1] = cardData.cardNumber;
  if (expCol) destData[expCol - 1] = cardData.expiry;
  if (cvcCol) destData[cvcCol - 1] = cardData.cvv;
  if (amtCol) destData[amtCol - 1] = cardData.amount || extraData.price || '';
  if (svcCol) destData[svcCol - 1] = 'aer';
  if (repCol) destData[repCol - 1] = repCode;

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  if (dateCol) destData[dateCol - 1] = dateStr;

  return {
    rowValues: destData,
    cardNumberCol: cardNumCol ? cardNumCol - 1 : -1,
    cardNumberValue: cardData.cardNumber,
  };
}