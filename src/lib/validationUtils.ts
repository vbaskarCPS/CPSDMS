// src/lib/validationUtils.ts

/**
 * Formats a phone number to a consistent format.
 * Returns empty string if invalid.
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If empty after cleaning, return empty
  if (!digits) return '';
  
  // Handle different lengths
  if (digits.length === 10) {
    // Format as (XXX) XXX-XXXX
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits[0] === '1') {
    // Remove leading 1 and format
    const stripped = digits.slice(1);
    return `(${stripped.slice(0, 3)}) ${stripped.slice(3, 6)}-${stripped.slice(6)}`;
  } else if (digits.length === 7) {
    // Format as XXX-XXXX (no area code)
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  
  // Return original if we can't format it
  return phone.trim();
}

/**
 * Normalizes an email address (lowercase, trimmed).
 * Returns empty string if invalid.
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  
  const trimmed = email.trim().toLowerCase();
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return ''; // Invalid email
  }
  
  return trimmed;
}

/**
 * Validates a contractor ID format.
 * Returns true if valid.
 */
export function isValidContractorId(id: string): boolean {
  if (!id) return false;
  
  // Contractor IDs should be alphanumeric, 3-20 characters
  const regex = /^[a-zA-Z0-9]{3,20}$/;
  return regex.test(id.trim());
}

/**
 * Validates a username format.
 * Returns true if valid.
 */
export function isValidUsername(username: string): boolean {
  if (!username) return false;
  
  // Username: 3-30 chars, alphanumeric and underscores only, no spaces
  const regex = /^[a-zA-Z0-9_]{3,30}$/;
  return regex.test(username.trim());
}

/**
 * Validates a password meets minimum requirements.
 * Returns true if valid.
 */
export function isValidPassword(password: string): boolean {
  if (!password) return false;
  
  // Minimum 4 characters
  return password.length >= 4;
}

/**
 * Formats a currency amount for display.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formats a date for display.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a timestamp for display.
 */
export function formatTimestamp(timestamp: string | Date): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Parses a price string to a number.
 * Handles formats like "$25.00", "25", "RJ $30", etc.
 */
export function parsePrice(priceString: string): number {
  if (!priceString) return 0;
  
  // Remove currency symbols and whitespace
  const cleaned = priceString.replace(/[^0-9.]/g, '');
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Validates if a Google Sheets URL or ID is valid.
 */
export function isValidGoogleSheetId(input: string): boolean {
  if (!input) return false;
  
  // Check if it's a URL
  if (input.includes('docs.google.com')) {
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return !!match;
  }
  
  // Check if it's a raw ID (alphanumeric with dashes/underscores, typically 44 chars)
  const idRegex = /^[a-zA-Z0-9-_]{20,50}$/;
  return idRegex.test(input.trim());
}

/**
 * Extracts a Google Sheet ID from a URL or returns the ID if already extracted.
 */
export function extractGoogleSheetId(input: string): string | null {
  if (!input) return null;
  
  // If it's already just an ID
  if (/^[a-zA-Z0-9-_]+$/.test(input.trim()) && input.length > 20) {
    return input.trim();
  }
  
  // Extract from URL
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}