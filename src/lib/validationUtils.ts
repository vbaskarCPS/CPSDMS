// src/lib/validationUtils.ts

// ==================== PHONE UTILITIES ====================

/**
 * Strips all non-digit characters from a phone number
 */
export const normalizePhoneNumber = (value: string): string => {
    return value.replace(/\D/g, '');
  };
  
  /**
   * Formats a phone number string to "000 000 0000"
   * Handles partial input for live formatting
   */
  export const formatPhoneNumber = (value: string): string => {
    const digits = normalizePhoneNumber(value).slice(0, 10);
    
    if (digits.length === 0) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  };
  
  /**
   * Validates a phone number (must be exactly 10 digits or empty)
   */
  export const isValidPhoneNumber = (value: string): boolean => {
    if (!value || value.trim() === '') return true; // Empty is allowed
    const digits = normalizePhoneNumber(value);
    return digits.length === 10;
  };
  
  /**
   * Returns validation error message or null if valid
   */
  export const getPhoneValidationError = (value: string): string | null => {
    if (!value || value.trim() === '') return null;
    const digits = normalizePhoneNumber(value);
    if (digits.length === 0) return null;
    if (digits.length < 10) return `Phone number incomplete (${digits.length}/10 digits)`;
    if (digits.length > 10) return 'Phone number too long';
    return null;
  };
  
  // ==================== EMAIL UTILITIES ====================
  
  /**
   * Normalizes email by trimming whitespace and converting to lowercase
   */
  export const normalizeEmail = (value: string): string => {
    return value.trim().toLowerCase();
  };
  
  /**
   * Validates email format
   * Returns true for empty strings (optional field)
   */
  export const isValidEmail = (value: string): boolean => {
    if (!value || value.trim() === '') return true; // Empty is allowed
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value.trim());
  };
  
  /**
   * Returns validation error message or null if valid
   */
  export const getEmailValidationError = (value: string): string | null => {
    if (!value || value.trim() === '') return null;
    
    const trimmed = value.trim();
    
    // Check for spaces
    if (trimmed.includes(' ')) return 'Email cannot contain spaces';
    
    // Check for @ symbol
    if (!trimmed.includes('@')) return 'Email must contain @';
    
    // Check for domain
    const parts = trimmed.split('@');
    if (parts.length !== 2) return 'Invalid email format';
    if (!parts[0]) return 'Email missing username';
    if (!parts[1]) return 'Email missing domain';
    if (!parts[1].includes('.')) return 'Email domain must contain a period';
    
    // Final regex check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) return 'Invalid email format';
    
    return null;
  };
  
  // ==================== COMBINED VALIDATION ====================
  
  export interface ValidationResult {
    isValid: boolean;
    phoneError: string | null;
    emailError: string | null;
  }
  
  /**
   * Validates both phone and email, returns combined result
   */
  export const validateContactInfo = (phone: string, email: string): ValidationResult => {
    const phoneError = getPhoneValidationError(phone);
    const emailError = getEmailValidationError(email);
    
    return {
      isValid: !phoneError && !emailError,
      phoneError,
      emailError
    };
  };