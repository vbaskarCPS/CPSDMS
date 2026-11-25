// src/v2/features/cards/CardIntro.tsx — the short walkthrough a manager sees once, the first time they open the app
// after Card Processing was turned on for them: where it is, and how a sale goes. "How it works" on the Process a card
// screen opens it again. Seen once per grant (card_access.intro_seen_at); turning the permission off and on shows it again.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, CreditCard, History, LayoutGrid, ListChecks, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { cardIntro, cardIntroDone } from '../../lib/cardSales';
import { Btn, Modal } from '../../ui';

interface Step { icon: LucideIcon; title: string; lines: React.ReactNode[]; picture?: React.ReactNode }
const Pill: React.FC<{ children: React.ReactNode }> = ({ children }) => <b style={{ background: '#e0f2fe', color: '#075985', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>{children}</b>;

/** A small picture of where it is: the menu button, then the Card Processing tile. */
const WherePicture: React.FC = () => (
  <div className="v2-intro-pic" aria-hidden="true">
    <span className="v2-intro-menu"><LayoutGrid size={18} /></span>
    <ChevronRight size={18} color="#9ca3af" />
    <span className="v2-intro-tile"><span className="ib"><CreditCard size={18} color="#0284c7" /></span><b>Card Processing</b></span>
  </div>
);

export function introSteps(grantedBy: string | null): Step[] {
  return [
    { icon: CreditCard, title: 'You can now take cards over the phone',
      picture: <WherePicture />,
      lines: [
        <>{grantedBy ? `${grantedBy} turned on` : 'You now have'} <Pill>Card Processing</Pill>{grantedBy ? ' for your account' : ''}. It charges a customer’s card through Bambora while you have them on the phone.</>,
        <><b>Where to find it:</b> tap the menu button at the top left and choose <Pill>Card Processing</Pill>. It is also a card on your home screen.</>,
      ] },
    { icon: ListChecks, title: 'Fill in the sale',
      lines: [
        <>Enter the customer’s name, phone and email, then the <b>service address</b> with the city and province.</>,
        <>Add what they bought and the season. One sale can hold more than one service.</>,
        <>The <b>price you type is the full price, tax included</b>. The app works out the GST or HST inside it for the receipt.</>,
      ] },
    { icon: CreditCard, title: 'Take the card and charge it',
      lines: [
        <>Type the card number, expiry and CVV into the card boxes. They go straight to Bambora and are never saved in the app.</>,
        <>Press <Pill>Charge</Pill>, check the amount, and confirm. You’ll see <b>Approved</b> or the reason it was declined.</>,
        <>On an approved charge the customer is emailed a receipt automatically.</>,
      ] },
    { icon: History, title: 'After the call',
      lines: [
        <><Pill>History</Pill> shows every sale, by everyone. Open one to send the receipt again.</>,
        <>If a card is <b>declined</b>, nothing was charged. Enter the card again or try another one.</>,
        <>If the app says a customer <b>looks already charged</b>, stop and check History before charging again. Refunds are done by the office.</>,
      ] },
  ];
}

export const CardIntroModal: React.FC<{ grantedBy: string | null; onClose: (open: boolean) => void }> = ({ grantedBy, onClose }) => {
  const steps = introSteps(grantedBy);
  const [i, setI] = useState(0);
  const s = steps[i], Icon = s.icon, last = i === steps.length - 1;
  return (
    <Modal title="Card Processing: a quick tour" onClose={() => onClose(false)}
      footer={<>
        <span className="v2-mut v2-small">{i + 1} of {steps.length}</span><span className="v2-spacer" />
        {i > 0 && <Btn icon={ChevronLeft} onClick={() => setI(i - 1)}>Back</Btn>}
        {last ? <><Btn onClick={() => onClose(false)}>Done</Btn><Btn kind="g" icon={CreditCard} onClick={() => onClose(true)}>Open Card Processing</Btn></>
          : <Btn kind="g" onClick={() => setI(i + 1)}>Next<ChevronRight size={15} /></Btn>}
      </>}>
      <div className="v2-intro">
        <div className="v2-row" style={{ gap: 12, marginBottom: 12, flexWrap: 'nowrap' }}>
          <span className="v2-intro-ic"><Icon size={22} color="#0284c7" /></span>
          <b style={{ fontSize: 18, lineHeight: 1.25 }}>{s.title}</b>
        </div>
        {s.picture}
        {s.lines.map((l, n) => <div key={n} className="v2-intro-line"><CheckCircle2 size={16} color="#059669" style={{ flex: 'none', marginTop: 3 }} /><span>{l}</span></div>)}
      </div>
    </Modal>
  );
};

/** Shows the tour once to someone who has just been given Card Processing. Sits beside every signed-in screen. */
export const CardIntroGate: React.FC = () => {
  const { can, profile } = useAuth();
  const nav = useNavigate();
  const has = !!profile && can('card_processing');
  const [state, setState] = useState<{ show: boolean; granted_by: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (!has) { setState(null); return; }
    cardIntro().then(r => { if (live) setState(r); }).catch(() => { /* no tour is better than a broken screen */ });
    return () => { live = false; };
  }, [has, profile?.id]);
  if (!has || !state?.show) return null;
  return <CardIntroModal grantedBy={state.granted_by} onClose={open => {
    setState({ ...state, show: false });
    cardIntroDone().catch(() => { /* it will show once more next time */ });
    if (open) nav('/app/cards');
  }} />;
};
