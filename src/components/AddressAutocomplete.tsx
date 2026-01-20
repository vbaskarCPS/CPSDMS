// src/components/AddressAutocomplete.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Loader } from 'lucide-react';

// Extend Window interface for Google Maps
declare global {
  interface Window {
    google: any;
    initGooglePlaces?: () => void;
  }
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: {
    address: string;
    city: string;
    postalCode: string;
  }) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Start typing your address...',
  className = '',
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const sessionTokenRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load Google Places script
  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY) {
      console.warn('Google Places API key not configured');
      setIsLoading(false);
      return;
    }

    // Check if already loaded
    if (window.google?.maps?.places) {
      setIsLoaded(true);
      setIsLoading(false);
      return;
    }

    // Check if script is already being loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        setIsLoaded(true);
        setIsLoading(false);
      });
      return;
    }

    // Load the script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      setIsLoaded(true);
      setIsLoading(false);
    };
    
    script.onerror = () => {
      console.error('Failed to load Google Places API');
      setIsLoading(false);
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Initialize autocomplete when loaded
  useEffect(() => {
    if (!isLoaded || !inputRef.current || !window.google?.maps?.places) return;

    // Create session token for billing optimization
    sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();

    // Initialize autocomplete
    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'ca' }, // Restrict to Canada
      fields: ['address_components', 'formatted_address'],
      sessionToken: sessionTokenRef.current,
    });

    // Listen for place selection
    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      
      if (!place.address_components) return;

      // Parse address components
      let streetNumber = '';
      let streetName = '';
      let city = '';
      let postalCode = '';

      place.address_components.forEach((component: any) => {
        const type = component.types[0];
        
        switch (type) {
          case 'street_number':
            streetNumber = component.long_name;
            break;
          case 'route':
            streetName = component.long_name;
            break;
          case 'locality':
            city = component.long_name;
            break;
          case 'postal_code':
            postalCode = component.long_name;
            break;
        }
      });

      const fullAddress = streetNumber 
        ? `${streetNumber} ${streetName}` 
        : streetName;

      // Update the input value
      onChange(fullAddress);

      // Notify parent of parsed components
      if (onPlaceSelect) {
        onPlaceSelect({
          address: fullAddress,
          city,
          postalCode,
        });
      }

      // Create new session token for next search
      sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    });

    return () => {
      // Cleanup listeners
      if (autocompleteRef.current) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [isLoaded, onChange, onPlaceSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  // If no API key, fall back to regular input
  if (!GOOGLE_PLACES_API_KEY) {
    return (
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full bg-gray-800 border border-gray-600 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={isLoading ? 'Loading...' : placeholder}
        disabled={disabled || isLoading}
        className={`w-full bg-gray-800 border border-gray-600 rounded-lg py-3 pl-10 pr-10 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        autoComplete="off"
      />
      {isLoading && (
        <Loader className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" size={18} />
      )}
    </div>
  );
};

export default AddressAutocomplete;