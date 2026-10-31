// src/pages/MapLogsheet/ServiceGuideSheet.tsx — the price guide shown at the door (Gallery › Service guide).
// Pick the homeowner's lot size and every package and service shows that lot's price in big print, with
// GST under it; "All sizes" shows the whole table. Built from data (src/lib/serviceGuide.ts), so it's
// crisp at any zoom and works with no signal.
import React, { useState } from 'react';
import { ChevronLeft, Check } from 'lucide-react';
import { money, withGst, type ServiceGuide } from '../../lib/serviceGuide';

const Price: React.FC<{ price: number | null; gst: number; big?: boolean }> = ({ price, gst, big }) =>
  price === null
    ? <span className={`font-black text-amber-300 ${big ? 'text-2xl' : 'text-sm'}`}>Quote</span>
    : (
      <span className="flex flex-col items-end leading-tight">
        <span className={`font-black text-white ${big ? 'text-3xl' : 'text-lg'}`}>{money(price)}</span>
        <span className={`text-gray-400 ${big ? 'text-sm' : 'text-[10px]'}`}>{money(withGst(price, gst))} w/GST</span>
      </span>
    );

const ServiceGuideSheet: React.FC<{ guide: ServiceGuide; onBack: () => void }> = ({ guide, onBack }) => {
  const [lot, setLot] = useState<number | null>(null);   // null = all sizes
  const gst = guide.gstRate;
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-black">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <button type="button" onClick={onBack} className="p-1.5 text-gray-300 active:text-white" aria-label="Back to the gallery"><ChevronLeft size={22} /></button>
        <span className="text-white font-bold text-base">{guide.title}</span>
        <span className="text-xs text-green-300 border border-green-700 rounded px-1.5 py-0.5">Lawn rejuvenation · {guide.region}</span>
      </div>

      {/* lot size: tap the homeowner's */}
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-gray-900">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Lot size</div>
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
          <button type="button" onClick={() => setLot(null)}
            className={`shrink-0 px-3 h-10 rounded-lg text-sm font-bold border ${lot === null ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-gray-900 text-gray-200 border-gray-700'}`}>All sizes</button>
          {guide.lots.map((l, i) => (
            <button key={l.key} type="button" onClick={() => setLot(i)}
              className={`shrink-0 px-3 h-10 rounded-lg text-sm font-bold border ${lot === i ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-gray-900 text-gray-200 border-gray-700'}`}>{l.label}</button>
          ))}
        </div>
        <div className="text-xs text-gray-400 mt-1 min-h-[16px]">{lot === null ? 'Tap the lot size to show just its prices.' : guide.lots[lot].detail}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-5">
        {guide.tables.map(t => (
          <section key={t.title}>
            <h3 className="text-yellow-300 font-black uppercase tracking-wide text-sm mb-2">{t.title}</h3>
            {lot !== null ? (
              <div className="space-y-2">
                {t.rows.map(r => (
                  <div key={r.name} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${r.highlight ? 'bg-green-950/60 border-green-600' : 'bg-gray-900 border-gray-800'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-base">{r.name}</div>
                      {r.note && <div className={`text-xs ${r.highlight ? 'text-green-300' : 'text-gray-400'}`}>{r.note}</div>}
                    </div>
                    <Price price={r.prices[lot]} gst={gst} big />
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar rounded-xl border border-gray-800">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-900">
                      <th className="px-3 py-2 text-[11px] text-gray-400 font-bold uppercase">&nbsp;</th>
                      {guide.lots.map((l, i) => (
                        <th key={l.key} className="px-2 py-2 text-right cursor-pointer" onClick={() => setLot(i)}>
                          <div className="text-white text-sm font-black">{l.label}</div>
                          <div className="text-[10px] text-gray-500 font-normal leading-tight">{l.detail}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map(r => (
                      <tr key={r.name} className={`border-t border-gray-800 ${r.highlight ? 'bg-green-950/50' : ''}`}>
                        <td className="px-3 py-2.5">
                          <div className="text-white font-bold text-sm">{r.name}</div>
                          {r.note && <div className={`text-[11px] ${r.highlight ? 'text-green-300' : 'text-gray-500'}`}>{r.note}</div>}
                        </td>
                        {r.prices.map((p, i) => <td key={i} className="px-2 py-2.5 text-right"><Price price={p} gst={gst} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        <section>
          <h3 className="text-yellow-300 font-black uppercase tracking-wide text-sm mb-2">What’s in the packages</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {guide.packages.map(p => (
              <div key={p.name} className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
                <div className="text-white font-bold">{p.name}</div>
                <ul className="mt-1.5 space-y-1">
                  {p.includes.map(x => <li key={x} className="text-sm text-gray-200 flex gap-2"><Check size={15} className="text-green-400 shrink-0 mt-0.5" />{x}</li>)}
                </ul>
                {p.note && <div className="text-xs text-gray-400 mt-2">{p.note}</div>}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-yellow-300 font-black uppercase tracking-wide text-sm mb-2">Surcharges (priced at the door)</h3>
          <div className="flex flex-wrap gap-2">{guide.surcharges.map(s => <span key={s} className="text-sm text-gray-200 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">{s}</span>)}</div>
        </section>

        <ul className="text-xs text-gray-500 space-y-1 pb-6">{guide.notes.map(n => <li key={n}>• {n}</li>)}</ul>
      </div>
    </div>
  );
};

export default ServiceGuideSheet;
