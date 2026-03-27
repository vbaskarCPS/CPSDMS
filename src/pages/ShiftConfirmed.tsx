// src/pages/ShiftConfirmed.tsx
import React from 'react';

const LOGO_URL =
  'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

const ShiftConfirmed: React.FC = () => {
  return (
    <div style={{
      margin: 0, padding: 0,
      background: '#f3f4f6',
      fontFamily: 'Arial, sans-serif',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
        maxWidth: 400,
        width: '90%',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1f2937, #374151)',
          padding: '28px',
          textAlign: 'center',
        }}>
          <img
            src={LOGO_URL}
            alt="Property Stars"
            style={{ maxWidth: 160, height: 'auto' }}
          />
        </div>

        {/* Body */}
        <div style={{ padding: '40px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <h1 style={{ margin: '0 0 12px', color: '#1f2937', fontSize: 24 }}>
            Your Shift is Confirmed!
          </h1>
          <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: 16, lineHeight: 1.6 }}>
            We'll see you out there. Thanks for confirming!
          </p>
          <p style={{ margin: '20px 0 0', color: '#9ca3af', fontSize: 13 }}>
            Questions? Simply reply to your confirmation email.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ShiftConfirmed;