// src/lib/localStorage.ts

export const STORAGE_KEYS = {
  // Legacy/Helper keys only - Core data is now in Supabase
  APP_SETTINGS: 'app_settings',
  LAST_APP_DATE: 'last_app_date',
};

export const getStorageItem = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error reading key "${key}" from localStorage:`, error);
    return defaultValue;
  }
};

export const setStorageItem = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Dispatch a custom event so components can react to storage changes
    window.dispatchEvent(
      new CustomEvent('storageUpdated', { detail: { key } })
    );
  } catch (error) {
    console.error(`Error writing key "${key}" to localStorage:`, error);
  }
};

export const removeStorageItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
    window.dispatchEvent(
      new CustomEvent('storageUpdated', { detail: { key } })
    );
  } catch (error) {
    console.error(`Error removing key "${key}" from localStorage:`, error);
  }
};
