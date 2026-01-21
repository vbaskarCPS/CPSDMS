// src/components/AddressAutocomplete.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Loader } from 'lucide-react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Load Google Maps script
  const loadScript = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Already loaded
      if ((window as any).google?.maps) {
        resolve();
        return;
      }

      // Script already in DOM, wait for it
      const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve());
        existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Maps')));
        return;
      }

      // Create and load script
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Maps'));
      document.head.appendChild(script);
    });
  }, []);

  // Initialize the autocomplete element
  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY) {
      console.warn('Google Places API key not configured');
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const initialize = async () => {
      try {
        await loadScript();

        // Import the places library using the new method
        const { PlaceAutocompleteElement } = await (window as any).google.maps.importLibrary('places');

        if (!isMounted || !containerRef.current) return;

        // Create the autocomplete element
        const autocomplete = new PlaceAutocompleteElement();
        
        // Configure for Canadian addresses only
        autocomplete.componentRestrictions = { country: 'ca' };

        // Handle place selection
        autocomplete.addEventListener('gmp-placeselect', async (event: any) => {
          const place = event.place;

          try {
            // Fetch the address components
            await place.fetchFields({
              fields: ['addressComponents', 'formattedAddress'],
            });

            const components = place.addressComponents || [];

            // Parse address components with fallbacks for Canadian addresses
            let streetNumber = '';
            let streetName = '';
            let city = '';
            let postalCode = '';

            for (const comp of components) {
              const types: string[] = comp.types || [];
              const text = comp.longText || comp.shortText || '';

              if (types.includes('street_number')) {
                streetNumber = text;
              } else if (types.includes('route')) {
                streetName = text;
              } else if (types.includes('postal_code')) {
                postalCode = text;
              }
              // City detection with fallbacks (Canadian addresses vary)
              else if (types.includes('locality') && !city) {
                city = text;
              } else if (types.includes('sublocality_level_1') && !city) {
                city = text;
              } else if (types.includes('administrative_area_level_3') && !city) {
                city = text;
              } else if (types.includes('neighborhood') && !city) {
                city = text;
              }
            }

            const fullAddress = streetNumber
              ? `${streetNumber} ${streetName}`.trim()
              : streetName;

            // Update parent with parsed values
            onChange(fullAddress);

            if (onPlaceSelect) {
              onPlaceSelect({
                address: fullAddress,
                city,
                postalCode,
              });
            }
          } catch (err) {
            console.error('Error fetching place details:', err);
          }
        });

        // Clear container and append the element
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(autocomplete);
        }

        autocompleteRef.current = autocomplete;
        setIsLoaded(true);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize Places Autocomplete:', err);
        if (isMounted) {
          setIsLoading(false);
          setLoadError(true);
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
      if (autocompleteRef.current) {
        autocompleteRef.current.remove();
        autocompleteRef.current = null;
      }
    };
  }, [loadScript, onChange, onPlaceSelect]);

  // Fallback input change handler
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // Render fallback input if no API key or load error
  if (!GOOGLE_PLACES_API_KEY || loadError) {
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
    <>
      {/* Styles for the Google PlaceAutocompleteElement */}
      <style>{`
        .address-autocomplete-wrapper {
          position: relative;
          width: 100%;
        }

        .address-autocomplete-wrapper gmp-place-autocomplete {
          display: block;
          width: 100%;
        }

        /* Style the input via CSS custom properties and ::part */
        .address-autocomplete-wrapper gmp-place-autocomplete {
          --gmp-mat-color-surface: rgb(31, 41, 55);
          --gmp-mat-color-on-surface: white;
          --gmp-mat-color-on-surface-variant: rgb(156, 163, 175);
          --gmp-mat-color-primary: rgb(59, 130, 246);
          --gmp-mat-color-outline: rgb(75, 85, 99);
          --gmp-mat-shape-corner-extra-small: 0.5rem;
        }

        /* Target the input element inside the web component */
        .address-autocomplete-wrapper input {
          width: 100% !important;
          background-color: rgb(31, 41, 55) !important;
          border: 1px solid rgb(75, 85, 99) !important;
          border-radius: 0.5rem !important;
          padding: 0.75rem 1rem 0.75rem 2.5rem !important;
          color: white !important;
          font-size: 1rem !important;
          line-height: 1.5 !important;
          outline: none !important;
          box-sizing: border-box !important;
        }

        .address-autocomplete-wrapper input::placeholder {
          color: rgb(107, 114, 128) !important;
        }

        .address-autocomplete-wrapper input:focus {
          box-shadow: 0 0 0 2px rgb(59, 130, 246) !important;
          border-color: transparent !important;
        }

        /* Style the dropdown predictions */
        .address-autocomplete-wrapper .pac-container,
        .pac-container {
          background-color: rgb(31, 41, 55) !important;
          border: 1px solid rgb(75, 85, 99) !important;
          border-radius: 0.5rem !important;
          margin-top: 4px !important;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3) !important;
          font-family: inherit !important;
        }

        .pac-container .pac-item {
          color: white !important;
          background-color: rgb(31, 41, 55) !important;
          padding: 0.75rem 1rem !important;
          border-top: 1px solid rgb(55, 65, 81) !important;
          cursor: pointer !important;
        }

        .pac-container .pac-item:first-child {
          border-top: none !important;
        }

        .pac-container .pac-item:hover,
        .pac-container .pac-item.pac-item-selected {
          background-color: rgb(55, 65, 81) !important;
        }

        .pac-container .pac-item .pac-item-query {
          color: white !important;
          font-size: 0.95rem !important;
        }

        .pac-container .pac-item .pac-matched {
          font-weight: 600 !important;
        }

        .pac-container .pac-item span:not(.pac-item-query) {
          color: rgb(156, 163, 175) !important;
        }

        /* Hide Google logo in dropdown (optional, remove if needed for compliance) */
        .pac-container::after {
          display: none !important;
        }

        /* Loading state placeholder */
        .address-autocomplete-loading {
          width: 100%;
          background-color: rgb(31, 41, 55);
          border: 1px solid rgb(75, 85, 99);
          border-radius: 0.5rem;
          padding: 0.75rem 1rem 0.75rem 2.5rem;
          color: rgb(107, 114, 128);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
      `}</style>

      <div className={`address-autocomplete-wrapper ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* Map pin icon positioned over the input */}
        <MapPin
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 z-10 pointer-events-none"
          size={18}
        />

        {/* Container for the PlaceAutocompleteElement */}
        <div ref={containerRef}>
          {isLoading && (
            <div className="address-autocomplete-loading">
              <Loader className="animate-spin" size={18} />
              Loading...
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AddressAutocomplete;