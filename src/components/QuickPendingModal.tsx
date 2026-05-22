// src/components/QuickPendingModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  ArrowRight,
  Loader,
  AlertCircle,
  FileText,
  Shovel,
  Leaf,
  RefreshCw,
  MapPin,
  Construction,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { sessionService } from '../lib/sessionService';
import {
  isRampCrewTeamId,
  seasonHasAsphalt,
} from '../lib/commandCenterService';
import {
  Worker,
  SeasonType,
  ServiceFlags,
  SERVICE_FLAG_KEYS,
  SERVICE_FLAG_LABELS,
} from '../types';

// --- HELPER: Get the property type button list for a given season ---
// Aeration & Lawn Rejuv use FP/FO/BO. Sealing uses SS/SSP.
// TODO: When Central 'cleaning' season ships, add its property types here.
function getPropertyTypesForSeason(seasonType: SeasonType): string[] {
  if (seasonType === 'sealing') return ['SS', 'SSP'];
  return ['FP', 'FO', 'BO'];
}

// --- HELPER: Get the default property type for a given season ---
// Per design decision H, defaults to the first option (FP for Rejuv, SS for Sealing).
function getDefaultPropertyTypeForSeason(seasonType: SeasonType): string {
  if (seasonType === 'sealing') return 'SS';
  return 'FP';
}

// --- HELPER: Capitalize first letter after spaces and hyphens ---
// Same helper NewJob.tsx uses for name fields, applied here to street name in
// the custom-entry path so manually-typed streets follow the same convention.
function capitalizeWords(value: string): string {
  return value
    .split(' ')
    .map(word =>
      word
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
    )
    .join(' ');
}

// --- SERVICE TOGGLE COLORS (Lawn Rejuv) ---
// Mirrors NewJob.tsx so the visual treatment is identical across the two surfaces.
const SERVICE_TOGGLE_COLORS: Record<keyof ServiceFlags, { active: string; inactive: string }> = {
  aeration: {
    active: 'bg-blue-600 border-blue-500 text-white',
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-blue-500',
  },
  dethatch: {
    active: 'bg-orange-600 border-orange-500 text-white',
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-orange-500',
  },
  fertilizer: {
    active: 'bg-green-600 border-green-500 text-white',
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-green-500',
  },
  seed: {
    active: 'bg-yellow-600 border-yellow-500 text-white',
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-yellow-500',
  },
  lime: {
    active: 'bg-purple-600 border-purple-500 text-white',
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-purple-500',
  },
};

// --- SERVICE TOGGLES SUBCOMPONENT (Lawn Rejuv only) ---
const ServiceToggles: React.FC<{
  services: ServiceFlags;
  onChange: (services: ServiceFlags) => void;
}> = ({ services, onChange }) => {
  const toggleService = (key: keyof ServiceFlags) => {
    onChange({ ...services, [key]: !services[key] });
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-gray-500 uppercase block">Services to Perform</label>
      <div className="flex flex-wrap gap-2">
        {SERVICE_FLAG_KEYS.map(key => {
          const isActive = services[key];
          const colors = SERVICE_TOGGLE_COLORS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleService(key)}
              className={`px-3 py-1.5 rounded border-2 font-bold text-xs transition-all ${
                isActive ? colors.active : colors.inactive
              }`}
            >
              {SERVICE_FLAG_LABELS[key].short} - {SERVICE_FLAG_LABELS[key].full}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface QuickPendingModalProps {
  worker: Worker;
  sessionId: string;          // The cart's logsheet_sessions.id — required to scope the pending sale
  seasonType: SeasonType;     // 'lawn_rejuv' | 'sealing' (caller guarantees team season — Aeration never opens this)
  assignedRoutes: string[];   // Worker's assigned route codes for the day
  onClose: () => void;
  onSaved?: () => void;       // Called after a successful Save Pending so the dashboard can refresh
}

const QuickPendingModal: React.FC<QuickPendingModalProps> = ({
  worker,
  sessionId,
  seasonType,
  assignedRoutes,
  onClose,
  onSaved,
}) => {
  const navigate = useNavigate();

  // --- FORM STATE ---
  const [routeCode, setRouteCode] = useState<string>(assignedRoutes[0] || '');
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [price, setPrice] = useState('');
  const [propertyType, setPropertyType] = useState<string>(getDefaultPropertyTypeForSeason(seasonType));
  const [notes, setNotes] = useState('');

  // --- SERVICE FLAGS (Lawn Rejuv only) ---
  const [services, setServices] = useState<ServiceFlags>({
    aeration: false,
    dethatch: false,
    fertilizer: false,
    seed: false,
    lime: false,
  });

  // --- ASPHALT ADD-ON STATE (Sealing only) ---
  // asphaltEnabled is the on/off for the whole add-on. When false, no asphalt
  // fields are persisted. When true, asphaltAmount must be > 0 to save.
  // upsoldAsphaltAmount is only editable for RC carts; non-RC carts will leave
  // it for the RC to fill in when they execute on-site.
  const [asphaltEnabled, setAsphaltEnabled] = useState<boolean>(false);
  const [asphaltAmount, setAsphaltAmount] = useState<string>('');
  const [upsoldAsphaltAmount, setUpsoldAsphaltAmount] = useState<string>('');

  // --- STREETS DROPDOWN STATE ---
  // Same pattern as NewJob.tsx: fetch streets from the route, fall back to
  // free-entry if the route has no street list (or worker chooses "Other").
  const [suggestedStreets, setSuggestedStreets] = useState<string[]>([]);
  const [isCustomStreetMode, setIsCustomStreetMode] = useState(false);

  // --- UI STATE ---
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Season-flavoured branding bits — keeps the modal visually consistent with
  // the rest of the season-aware surfaces (Dashboard, RM logbook, etc).
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isSealing = seasonType === 'sealing';
  const propertyTypeOptions = getPropertyTypesForSeason(seasonType);

  // --- ASPHALT / RC GATING ---
  // showAsphaltSection: any sealing cart can attach asphalt as an add-on.
  //   Non-RC carts attach it as a child of their driveway sale; an RM later
  //   assigns it to a Ramp Crew. RC carts get the same UI plus the Upsold field.
  // isRC: whether the worker's cart is a Ramp Crew (case-sensitive teamId match).
  const showAsphaltSection = seasonHasAsphalt(seasonType);
  const isRC = isRampCrewTeamId(worker.teamId);

  // --- LOAD STREETS WHEN ROUTE CHANGES ---
  useEffect(() => {
    if (!routeCode) {
      setSuggestedStreets([]);
      setIsCustomStreetMode(true);
      return;
    }
    sessionService.getStreetsForRoute(routeCode).then(streets => {
      if (streets && streets.length > 0) {
        setSuggestedStreets(streets);
        setIsCustomStreetMode(false);
        setStreetName('');
      } else {
        setSuggestedStreets([]);
        setIsCustomStreetMode(true);
      }
    });
  }, [routeCode]);

  // --- VALIDATION ---
  // We're permissive: a pending sale by definition is incomplete. But we won't
  // save a totally blank row — there has to be at least an address fragment so
  // the worker can recognise it later in their list.
  const hasAnyAddressInfo =
    houseNumber.trim() !== '' || streetName.trim() !== '';

  // --- SHARED SAVE LOGIC ---
  // Both action buttons save first; "Proceed to Complete" then navigates.
  // Returns the created PendingSale's id on success, null on failure.
  //
  // Asphalt orchestration: when asphaltEnabled is true and asphaltAmount > 0,
  // we pass asphaltAmount (and optionally upsoldAsphaltAmount for RC carts)
  // to createPendingSale. sessionService's 3-way orchestrator decides whether
  // to write a parent+child pair (driveway-sold) or an asphalt-only standalone
  // (RC only) based on whether driveway info is present. We don't enforce that
  // here — sessionService will reject if a non-RC tries to make asphalt-only.
  const handleSave = async (): Promise<string | null> => {
    if (saving) return null;
    setError(null);

    if (!hasAnyAddressInfo) {
      setError('Please enter at least a house number or street name.');
      return null;
    }

    // Asphalt validation: if the toggle is on, require a real amount.
    // Empty/zero/NaN → ask user to either enter an amount or turn off the toggle.
    let asphaltAmountNum: number | undefined = undefined;
    let upsoldAmountNum: number | undefined = undefined;
    if (asphaltEnabled) {
      const amt = parseFloat(asphaltAmount);
      if (isNaN(amt) || amt <= 0) {
        setError('Asphalt is added but no valid amount entered. Enter an asphalt amount or remove the asphalt add-on.');
        return null;
      }
      asphaltAmountNum = amt;

      if (isRC) {
        const upsold = parseFloat(upsoldAsphaltAmount);
        // Upsold is optional even for RC. Treat NaN/empty/0 as "not set".
        upsoldAmountNum = !isNaN(upsold) && upsold > 0 ? upsold : undefined;
      }
      // Non-RC carts never enter upsold here — the RC will add it on-site.
    }

    setSaving(true);
    try {
      const created = await sessionService.createPendingSale({
        sessionId,
        workerId: worker.contractorId,
        routeCode: routeCode || undefined,
        houseNumber: houseNumber.trim() || undefined,
        streetName: streetName.trim() || undefined,
        price: price.trim() || undefined,
        propertyType: propertyType || undefined,
        services: isLawnRejuv ? services : undefined,
        notes: notes.trim() || undefined,
        asphaltAmount: asphaltAmountNum,
        upsoldAsphaltAmount: upsoldAmountNum,
      });
      return created.id;
    } catch (err: any) {
      console.error('[QuickPendingModal] save failed:', err);
      setError(err?.message || 'Failed to save. Please try again.');
      setSaving(false);
      return null;
    }
  };

  const handleSavePending = async () => {
    const id = await handleSave();
    if (id) {
      if (onSaved) onSaved();
      onClose();
    }
  };

  const handleProceedToComplete = async () => {
    const id = await handleSave();
    if (id) {
      if (onSaved) onSaved();
      // Navigate to NewJob with the pendingSaleId param so it prefills.
      // We don't call onClose() — navigation unmounts this modal anyway.
      // For asphalt parent+child pairs, sessionService.createPendingSale returns
      // the PARENT id; NewJob is responsible for detecting the linked child and
      // loading both together in the merged completion view.
      navigate(`/logsheet/new?pendingSaleId=${encodeURIComponent(id)}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">

        {/* HEADER */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Quick Pending Sale</h2>
            {/* Season pill — matches Dashboard/JobDetail/NewJob styling */}
            {isLawnRejuv && (
              <span className="bg-green-900/30 text-green-400 text-[10px] px-1.5 py-0.5 rounded border border-green-700 flex items-center gap-1">
                <Leaf size={10} /> LAWN REJUV
              </span>
            )}
            {isSealing && (
              <span className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-600 flex items-center gap-1">
                <Shovel size={10} /> SEALING
              </span>
            )}
            {/* RC pill — only shown when the worker's cart is a Ramp Crew. */}
            {isSealing && isRC && (
              <span className="bg-zinc-800 text-zinc-300 text-[10px] px-1.5 py-0.5 rounded border border-zinc-600 flex items-center gap-1">
                <Construction size={10} /> RAMP CREW
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-white disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* INTRO STRIP */}
        <div className="px-4 pt-3 pb-1 text-[11px] text-gray-400 italic flex items-start gap-2">
          <FileText size={12} className="mt-0.5 flex-shrink-0 text-slate-400" />
          <span>
            Park a half-collected sale to finish later. Pending sales are visible to everyone on your cart and don't get exported.
          </span>
        </div>

        {/* ERROR BANNER */}
        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* FORM BODY */}
        <div className="overflow-y-auto p-4 space-y-4 flex-grow custom-scrollbar">

          {/* ROW 1: Route + House + Street */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 space-y-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase flex items-center gap-2">
              <MapPin size={14} /> Location
            </h3>

            <div className="grid grid-cols-4 gap-3">
              {/* Route Code Dropdown */}
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route</label>
                <select
                  value={routeCode}
                  onChange={(e) => setRouteCode(e.target.value)}
                  disabled={saving || assignedRoutes.length === 0}
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono text-sm focus:outline-none focus:border-cps-blue"
                >
                  {assignedRoutes.length === 0 ? (
                    <option value="">No routes</option>
                  ) : (
                    assignedRoutes.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))
                  )}
                </select>
              </div>

              {/* House Number */}
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">House #</label>
                <input
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  disabled={saving}
                  placeholder="123"
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-cps-blue"
                />
              </div>

              {/* Street Name (dropdown w/ custom fallback, NewJob pattern) */}
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Street Name</label>
                <div className="flex gap-2">
                  {!isCustomStreetMode ? (
                    <select
                      value={streetName}
                      onChange={(e) => {
                        if (e.target.value === '__CUSTOM__') {
                          setIsCustomStreetMode(true);
                          setStreetName('');
                        } else {
                          setStreetName(e.target.value);
                        }
                      }}
                      disabled={saving || !routeCode}
                      className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-cps-blue"
                    >
                      <option value="">{routeCode ? '-- Select Street --' : 'Select route first'}</option>
                      {suggestedStreets.map((s, i) => (
                        <option key={i} value={s}>{s}</option>
                      ))}
                      <option value="__CUSTOM__" className="text-blue-400 font-bold">+ Other / Type Custom</option>
                    </select>
                  ) : (
                    <input
                      value={streetName}
                      onChange={(e) => setStreetName(capitalizeWords(e.target.value))}
                      disabled={saving}
                      placeholder="Enter street name"
                      className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-cps-blue"
                    />
                  )}
                  {isCustomStreetMode && suggestedStreets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setIsCustomStreetMode(false); setStreetName(''); }}
                      disabled={saving}
                      className="p-2 bg-gray-700 rounded border border-gray-600 text-gray-300 hover:bg-gray-600 transition-colors"
                      title="Back to dropdown"
                    >
                      <RefreshCw size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ROW 2: Price + Property Type */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 space-y-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase">Pricing & Type</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Price */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                  {isSealing ? 'Driveway Price ($)' : 'Price ($)'}{' '}
                  <span className="text-gray-600 font-normal">— optional, leave blank if unknown</span>
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={saving}
                  placeholder="0.00"
                  step="0.01"
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400 focus:outline-none focus:border-cps-blue"
                />
              </div>

              {/* Property Type */}
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Property Type</label>
                <div className="flex bg-gray-700 rounded-md border border-gray-600 overflow-hidden">
                  {propertyTypeOptions.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPropertyType(t)}
                      disabled={saving}
                      className={`flex-1 py-2 text-xs font-bold transition-colors ${
                        propertyType === t ? 'bg-cps-blue text-white' : 'text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ROW 3: Services (Lawn Rejuv only) */}
          {isLawnRejuv && (
            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Services</h3>
              <ServiceToggles services={services} onChange={setServices} />
              <p className="text-[10px] text-gray-500 italic mt-2">
                You can adjust this when you come back to complete the sale.
              </p>
            </div>
          )}

          {/* ROW 3b: Asphalt Add-On (Sealing only) */}
          {/*
            Layout:
              - Section is always rendered for sealing so the toggle is discoverable.
              - When toggle is OFF, only the header + toggle button show.
              - When toggle is ON, reveal:
                  - Asphalt Amount (required, > 0 to save)
                  - Upsold Asphalt — RC carts only
                  - Hint text explaining what happens next.
          */}
          {showAsphaltSection && (
            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-300 uppercase flex items-center gap-2">
                  <Construction size={14} className="text-zinc-400" />
                  Asphalt Add-On
                </h3>
                <button
                  type="button"
                  onClick={() => setAsphaltEnabled(prev => !prev)}
                  disabled={saving}
                  className={`px-3 py-1.5 rounded border-2 font-bold text-xs transition-all ${
                    asphaltEnabled
                      ? 'bg-zinc-600 border-zinc-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-zinc-500'
                  }`}
                >
                  {asphaltEnabled ? '✓ Asphalt Added' : '+ Add Asphalt'}
                </button>
              </div>

              {asphaltEnabled && (
                <div className="space-y-3">
                  {/* Asphalt Amount — always editable when section is on */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                      Asphalt Amount ($) <span className="text-red-400 font-normal">— required</span>
                    </label>
                    <input
                      type="number"
                      value={asphaltAmount}
                      onChange={(e) => setAsphaltAmount(e.target.value)}
                      disabled={saving}
                      placeholder="0.00"
                      step="0.01"
                      className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-zinc-200 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  {/* Upsold Asphalt — RC carts only */}
                  {isRC && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                        Upsold Asphalt ($){' '}
                        <span className="text-gray-600 font-normal">— optional, additional asphalt added on-site</span>
                      </label>
                      <input
                        type="number"
                        value={upsoldAsphaltAmount}
                        onChange={(e) => setUpsoldAsphaltAmount(e.target.value)}
                        disabled={saving}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-lg font-mono font-bold text-zinc-200 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  )}

                  {/* Hint about what happens next, based on cart kind */}
                  <p className="text-[10px] text-gray-500 italic">
                    {isRC ? (
                      <>
                        Your Ramp Crew is auto-assigned to this asphalt.
                        Driveway price is optional — leave blank for an asphalt-only sale.
                      </>
                    ) : (
                      <>
                        A Ramp Crew will be assigned by your manager to execute this asphalt.
                        The RC will fill in any upsold amount on-site.
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ROW 4: Notes */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
            <h3 className="text-sm font-bold text-gray-300 uppercase mb-2 flex items-center gap-2">
              <FileText size={14} /> Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="Any extra info — gate code, sale agreement, when to come back, etc."
              className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-cps-blue transition-colors min-h-[80px]"
            />
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-3 text-gray-400 hover:text-white font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSavePending}
            disabled={saving}
            className="px-5 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 rounded-md font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader className="animate-spin" size={16} /> Saving...
              </>
            ) : (
              <>
                <Save size={16} /> Save Pending
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleProceedToComplete}
            disabled={saving}
            className="px-5 py-3 bg-cps-green hover:bg-green-600 text-white rounded-md font-bold shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader className="animate-spin" size={16} /> Saving...
              </>
            ) : (
              <>
                <ArrowRight size={16} /> Proceed to Complete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickPendingModal;