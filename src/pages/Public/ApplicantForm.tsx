// src/pages/Public/ApplicantForm.tsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  User,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Loader,
  XCircle,
} from 'lucide-react';
import { commandCenterService } from '../../lib/commandCenterService';
import { jobFairService } from '../../lib/jobFairService';
import { ApplicantIdType, ApplicantFormData, CommandCenter, JobFairSession } from '../../types';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

const ID_TYPE_OPTIONS: { value: ApplicantIdType; label: string }[] = [
  { value: 'SIN', label: 'SIN (Social Insurance Number)' },
  { value: 'DL', label: "Driver's License" },
  { value: 'HEALTH_CARD', label: 'Health Card' },
  { value: 'PASSPORT', label: 'Passport' },
];

// Helper function to capitalize first letter of each word
const toTitleCase = (str: string): string => {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Helper function to format phone number as "000 000 0000"
const formatPhoneNumber = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');
  
  // Format as "000 000 0000"
  if (digits.length <= 3) {
    return digits;
  } else if (digits.length <= 6) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  } else {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
  }
};

const ApplicantForm: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  
  // Page state
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noActiveSession, setNoActiveSession] = useState(false);
  
  // Data state
  const [commandCenter, setCommandCenter] = useState<CommandCenter | null>(null);
  const [session, setSession] = useState<JobFairSession | null>(null);
  
  // Form state - age defaults to empty (0 will be treated as empty)
  const [formData, setFormData] = useState<ApplicantFormData>({
    firstName: '',
    lastName: '',
    cellPhone: '',
    alternatePhone: '',
    email: '',
    address: '',
    city: '',
    postalCode: '',
    age: 0, // 0 means empty/not set
    idType: 'DL',
    idValue: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Load command center and session
  useEffect(() => {
    const loadData = async () => {
      if (!slug) {
        setError('Invalid application link');
        setLoading(false);
        return;
      }

      try {
        // Get command center by slug
        const cc = await commandCenterService.getCommandCenterBySlug(slug);
        
        if (!cc) {
          setError('Application not found. Please check your link.');
          setLoading(false);
          return;
        }

        if (!cc.jobFairsEnabled) {
          setNoActiveSession(true);
          setLoading(false);
          return;
        }

        setCommandCenter(cc);

        // Get active session
        const activeSession = await jobFairService.getActiveSessionByCommandCenterId(cc.id);
        
        if (!activeSession) {
          setNoActiveSession(true);
          setLoading(false);
          return;
        }

        setSession(activeSession);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load application form. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [slug]);

  // Form validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      errors.firstName = 'First name is required';
    }

    if (!formData.lastName.trim()) {
      errors.lastName = 'Last name is required';
    }

    if (!formData.cellPhone.trim()) {
      errors.cellPhone = 'Cell phone is required';
    } else {
      // Check if phone has at least 10 digits
      const digits = formData.cellPhone.replace(/\D/g, '');
      if (digits.length < 10) {
        errors.cellPhone = 'Please enter a valid 10-digit phone number';
      }
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format';
    }

    if (!formData.address.trim()) {
      errors.address = 'Address is required';
    }

    if (!formData.idValue.trim()) {
      errors.idValue = 'ID number is required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm() || !session || !commandCenter) return;

    setSubmitting(true);
    setError(null);

    try {
      await jobFairService.submitApplicant(session.id, commandCenter.id, formData);
      setSubmitted(true);
    } catch (err) {
      console.error('Error submitting application:', err);
      setError('Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle address autocomplete selection
  const handlePlaceSelect = (place: { address: string; city: string; postalCode: string }) => {
    setFormData(prev => ({
      ...prev,
      address: place.address,
      city: place.city,
      postalCode: place.postalCode,
    }));
  };

  // Update form field
  const updateField = (field: keyof ApplicantFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (formErrors[field]) {
      setFormErrors(prev => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  // Handle name input with title case formatting
  const handleNameChange = (field: 'firstName' | 'lastName', value: string) => {
    updateField(field, toTitleCase(value));
  };

  // Handle phone input with formatting
  const handlePhoneChange = (field: 'cellPhone' | 'alternatePhone', value: string) => {
    updateField(field, formatPhoneNumber(value));
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader className="animate-spin text-blue-400 mx-auto mb-4" size={48} />
          <p className="text-gray-400">Loading application...</p>
        </div>
      </div>
    );
  }

  // No active session - just show logo
  if (noActiveSession) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <img 
          src={LOGO_URL} 
          alt="Property Stars" 
          className="w-full max-w-lg mx-auto"
        />
      </div>
    );
  }

  // Error state (invalid slug, etc.)
  if (error && !commandCenter) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md w-full text-center">
          <XCircle className="text-red-400 mx-auto mb-4" size={64} />
          <h1 className="text-xl font-bold text-white mb-2">Application Unavailable</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-green-400" size={48} />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Application Submitted!</h1>
          <p className="text-gray-400 mb-6">
            Thank you for applying. A representative will be with you shortly.
          </p>
          <p className="text-sm text-gray-500">
            You may close this page now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <img 
            src={LOGO_URL} 
            alt="Property Stars" 
            className="w-full max-w-lg mx-auto mb-6"
          />
          <h1 className="text-2xl font-bold text-white mb-1">Job Application</h1>
          <p className="text-gray-400 text-sm">
            {commandCenter?.displayName}
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3 text-red-300">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <User size={20} className="text-blue-400" />
              Personal Information
            </h2>

            {/* First Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                First Name (Given Name) *
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleNameChange('firstName', e.target.value)}
                className={`w-full bg-gray-900 border rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                  formErrors.firstName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
                }`}
                placeholder="John"
              />
              {formErrors.firstName && (
                <p className="text-red-400 text-xs mt-1">{formErrors.firstName}</p>
              )}
            </div>

            {/* Last Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Last Name *
              </label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleNameChange('lastName', e.target.value)}
                className={`w-full bg-gray-900 border rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                  formErrors.lastName ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
                }`}
                placeholder="Smith"
              />
              {formErrors.lastName && (
                <p className="text-red-400 text-xs mt-1">{formErrors.lastName}</p>
              )}
            </div>

            {/* Cell Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Cell Phone # *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="tel"
                  value={formData.cellPhone}
                  onChange={(e) => handlePhoneChange('cellPhone', e.target.value)}
                  className={`w-full bg-gray-900 border rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                    formErrors.cellPhone ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
                  }`}
                  placeholder="416 555 1234"
                  maxLength={12}
                />
              </div>
              {formErrors.cellPhone && (
                <p className="text-red-400 text-xs mt-1">{formErrors.cellPhone}</p>
              )}
            </div>

            {/* Alternate Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Alternate Phone #
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="tel"
                  value={formData.alternatePhone}
                  onChange={(e) => handlePhoneChange('alternatePhone', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="416 555 5678"
                  maxLength={12}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className={`w-full bg-gray-900 border rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                    formErrors.email ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
                  }`}
                  placeholder="john.smith@email.com"
                />
              </div>
              {formErrors.email && (
                <p className="text-red-400 text-xs mt-1">{formErrors.email}</p>
              )}
            </div>
          </div>

          {/* Address Section */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <svg className="text-blue-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              Address
            </h2>

            {/* Address Autocomplete */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Street Address *
              </label>
              <AddressAutocomplete
                value={formData.address}
                onChange={(value) => updateField('address', value)}
                onPlaceSelect={handlePlaceSelect}
                placeholder="Start typing your address..."
              />
              {formErrors.address && (
                <p className="text-red-400 text-xs mt-1">{formErrors.address}</p>
              )}
            </div>

            {/* City & Postal Code */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Toronto"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Postal Code
                </label>
                <input
                  type="text"
                  value={formData.postalCode}
                  onChange={(e) => updateField('postalCode', e.target.value.toUpperCase())}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="M5V 1A1"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Additional Info Section */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <CreditCard size={20} className="text-blue-400" />
              Additional Information
            </h2>

            {/* Age */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Age
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="number"
                  min="16"
                  max="100"
                  value={formData.age || ''}
                  onChange={(e) => updateField('age', parseInt(e.target.value) || 0)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Enter your age"
                />
              </div>
            </div>

            {/* ID Type */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                ID Type *
              </label>
              <select
                value={formData.idType}
                onChange={(e) => updateField('idType', e.target.value as ApplicantIdType)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {ID_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ID Value */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {formData.idType === 'SIN' ? 'SIN Number' :
                 formData.idType === 'DL' ? "Driver's License Number" :
                 formData.idType === 'HEALTH_CARD' ? 'Health Card Number' :
                 'Passport Number'} *
              </label>
              <input
                type="text"
                value={formData.idValue}
                onChange={(e) => updateField('idValue', e.target.value)}
                className={`w-full bg-gray-900 border rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                  formErrors.idValue ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
                }`}
                placeholder={
                  formData.idType === 'SIN' ? '123-456-789' :
                  formData.idType === 'DL' ? 'A1234-56789-01234' :
                  formData.idType === 'HEALTH_CARD' ? '1234-567-890-AB' :
                  'AB123456'
                }
              />
              {formErrors.idValue && (
                <p className="text-red-400 text-xs mt-1">{formErrors.idValue}</p>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors shadow-lg"
          >
            {submitting ? (
              <>
                <Loader className="animate-spin" size={24} />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle size={24} />
                Submit Application
              </>
            )}
          </button>

          <p className="text-center text-gray-500 text-xs">
            By submitting this form, you agree to provide accurate information.
          </p>
        </form>
      </div>
    </div>
  );
};

export default ApplicantForm;