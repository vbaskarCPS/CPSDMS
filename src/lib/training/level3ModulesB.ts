// src/lib/training/level3ModulesB.ts
// Level 3 Training Modules — Driveway Sealing — PART B (Modules 16–20).
// Split into two files (A: 11–15, B: 16–20) for easier handling.
// Combined in index.ts as: [...LEVEL_3_MODULES_A, ...LEVEL_3_MODULES_B]
//
// Conventions mirror level1Modules.ts / level2Modules.ts:
//   - module_id: module_NN_slug   (continues the global sequence: 11–20)
//   - order_index: continues globally (11–20)
//   - level: 3
//   - no region field (regionless — shows everywhere)
//   - text sections + quizzes only (no images, videos, or storyboards yet)
//
// Pricing is taken from the live Driveway Sealing Agreement contract.
// Product/program naming uses SealStar / SealStar + (the SS / SSP logsheet codes).

import { TrainingModule } from './trainingModules';

export const LEVEL_3_MODULES_B: TrainingModule[] = [
  // =====================================================================
  // MODULE 16 — Pricing & Closing
  // =====================================================================
  {
    module_id: 'module_16_pricing_closing',
    order_index: 16,
    is_active: true,
    level: 3,
    title: 'Pricing & Closing',
    description:
      'Learn the real price grid by driveway size, the high/low close that uses the two programs as your discount, the closing lines that get pen to paper, and how to handle tax, ramps, and surcharges.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'The Price Grid',
        body: `Every driveway is priced by its dimensions, and every price is a "from" price — a starting point you build up from, never a ceiling. Here is the full grid for both programs.

SealStar (SS) — standard seal, no crack filling:
Short Single Lane (1 car length): from $195.
Medium Single Lane (2 car lengths): from $225.
Long Single Lane (3–4 car lengths): from $295.
Short Double Lane (1 car length): from $225.
Medium Double Lane (2 car lengths): from $275.
Long Double Lane (3–4 car lengths): from $345.

SealStar + (SSP) — adds rubberized crack filling:
Short Single Lane: from $235.
Medium Single Lane: from $275.
Long Single Lane: from $345.
Short Double Lane: from $275.
Medium Double Lane: from $325.
Long Double Lane: from $425.

Hot Asphalt Ramp (priced by sinkage depth and driveway width):
Up to 3" deep: Single $495, Double $595, Triple $695.
Over 3"–6": Single $695, Double $795, Triple $895.
Over 6"–9": Single $895, Double $995, Triple $1095.

There is also a manual Sealing Service Surcharge line on the contract for extensive cleaning and/or more than 5 cracks, plus a separate HST line.`,
      },
      {
        type: 'text',
        heading: 'Deliver the Price With Confidence',
        body: `If you have built value properly, you should be able to deliver the price confidently and move straight to closing. Always use a weapon to back up your numbers — either the Service Guide or the contract itself. Numbers delivered off a printed sheet carry far more authority than numbers said out loud.

Deliver the price off the contract with confidence and eye contact. Assume the sale. Then break eye contact and look down at the contract while you put pen to paper — calmly confirm their name and work through the details. The body language does the closing for you.`,
      },
      {
        type: 'text',
        heading: 'The High/Low Close: Drop the Crack-Filler',
        body: `Your most powerful closing tool is built right into the two-column price sheet. When a customer hesitates on price, you do not slash your number out of thin air — you offer to drop the crack filler, which moves them from SealStar + down to SealStar. The gap between the two columns is your discount, and it is a real one, because you are genuinely doing a bit less work.

Here is the move on a Medium Double Lane: "SealStar + with the crack filling is $325. But I tell you what — if we hold off on the crack filler today, I can do a full SealStar seal for $275. Now, I really want to get started on those weeds — is there a car you need to pull off the driveway?"

Walk the numbers so you know your room before you knock:
Short Single: $235 down to $195 = $40 off.
Medium Double: $325 down to $275 = $50 off.
Long Double: $425 down to $345 = $80 off.

The discount is built into the structure — you never have to invent it, and you never have to give away margin for nothing.`,
      },
      {
        type: 'text',
        heading: 'Always Use a Closing Line',
        body: `Gone are the days of the weak "Sounds good?" Push for the close by being excited to get to work, and close with one of the two P's — planters or parking.

Example: "So, dropping the crack filler brings it down to just $275. Now I really want to get started on those weeds right there — is there a car you need to pull out of the garage?"

The two P's work because they assume the sale. You are not asking "do you want this?" — you are asking a small logistics question ("where should you park?", "can I move that planter?") that only makes sense if the job is happening. Answering it is the customer agreeing to the sale without ever having to say a formal "yes."`,
      },
      {
        type: 'text',
        heading: 'Holding the Price, Tax, and the Last Resort',
        body: `Hold your ground on price. Things cost more than they did five years ago, and that includes driveway sealing. If a customer tries to bargain after your high/low offer, your next move is a tax-on-cash discount before you ever go lower — that secondary discount will usually push over a customer who is ready to buy. (The full case for holding firm is covered in the Price Objections module.)

On tax: always charge HST on cheques, credit cards, and e-transfers — 13% is applied to these payment types. E-transfers should only be used as a last resort. The tax-on-cash discount works precisely because cash avoids that 13%, so it is a genuine saving you can offer without touching your base price.

And the rule that governs all of it: if it is hard for the customer to see value, do not keep discounting — loop back and build more value instead.`,
      },
    ],
    quiz: [
      {
        question: 'What does a "from" price mean on the grid?',
        options: [
          'The maximum you can charge',
          'A starting point you build up from — never a ceiling',
          'A fixed price that cannot change',
          'The price only for return customers',
        ],
        correct_index: 1,
        explanation: 'Every price is a "from" price: a starting point. You build up from it based on the driveway, never treating it as a maximum.',
      },
      {
        question: 'What is the SealStar + (SSP) "from" price for a Medium Double Lane?',
        options: ['$275', '$295', '$325', '$425'],
        correct_index: 2,
        explanation: 'Medium Double Lane is from $275 on SealStar and from $325 on SealStar +.',
      },
      {
        question: 'In the high/low close, how do you create the discount?',
        options: [
          'You invent a random lower number',
          'You offer to drop the crack filler, moving the customer from SealStar + down to SealStar — the gap between the columns is the discount',
          'You always cut 50% off',
          'You match whatever a competitor charges',
        ],
        correct_index: 1,
        explanation: 'Dropping the crack filler moves them from SealStar + to SealStar. The price gap between the two programs is a real, built-in discount.',
      },
      {
        question: 'On a Long Double Lane, how much is the high/low discount worth?',
        options: ['$40 ($235 to $195)', '$50 ($325 to $275)', '$80 ($425 to $345)', '$100'],
        correct_index: 2,
        explanation: 'Long Double Lane goes from $425 (SealStar +) down to $345 (SealStar) — an $80 discount, just by dropping the crack filler.',
      },
      {
        question: 'What is a "weapon" in the context of delivering the price?',
        options: [
          'An aggressive sales tone',
          'The Service Guide or the contract — a printed document that backs up your numbers with authority',
          'A discount coupon',
          'A loud voice',
        ],
        correct_index: 1,
        explanation: 'Always use a weapon — the Service Guide or contract — to back up your numbers. Printed numbers carry far more authority than spoken ones.',
      },
      {
        question: 'What are the "two P\'s" used in a closing line?',
        options: ['Price and Payment', 'Planters and Parking', 'Patience and Persistence', 'Product and Price'],
        correct_index: 1,
        explanation: 'The two P\'s are planters and parking — small logistics questions that assume the sale is happening.',
      },
      {
        question: 'Why does closing with "is there a car you need to pull out of the garage?" work so well?',
        options: [
          'It is a polite way to say goodbye',
          'It assumes the sale — answering a parking/planter question only makes sense if the job is happening, so it closes without forcing a formal "yes"',
          'It distracts the customer from the price',
          'It is required wording on the contract',
        ],
        correct_index: 1,
        explanation: 'The two-P close assumes the sale. The customer agreeing to move a car is them agreeing to the job without ever saying a formal "yes."',
      },
      {
        question: 'After your high/low offer, if a customer still wants to bargain, what is the next move before going lower?',
        options: [
          'Immediately cut another $100',
          'Offer a tax-on-cash discount — cash avoids the 13% HST, so it is a genuine saving without touching the base price',
          'Walk away',
          'Give the job away for free',
        ],
        correct_index: 1,
        explanation: 'A tax-on-cash discount is the next lever. Because cash avoids the 13% HST charged on other methods, it is a real saving you can offer before dropping your base price.',
      },
      {
        question: 'On which payment types is 13% HST charged?',
        options: [
          'Cash only',
          'Cheques, credit cards, and e-transfers',
          'No payment types — sealing is tax-free',
          'Only credit cards',
        ],
        correct_index: 1,
        explanation: '13% HST is applied to cheques, credit cards, and e-transfers. This is what makes the tax-on-cash discount a genuine offer.',
      },
      {
        question: 'If the customer still cannot see the value after your offers, what is the correct response?',
        options: [
          'Keep cutting the price until they say yes',
          'Stop discounting and loop back to build more value instead',
          'Tell them they are wrong',
          'Pack up and leave immediately',
        ],
        correct_index: 1,
        explanation: 'Discounting is a last resort. When value is not landing, build more value rather than continuing to cut the price.',
      },
    ],
  },

  // =====================================================================
  // MODULE 17 — Price Objections
  // =====================================================================
  {
    module_id: 'module_17_price_objections',
    order_index: 17,
    is_active: true,
    level: 3,
    title: 'Price Objections: Holding Your Value',
    description:
      'When a customer says "that\'s too expensive," you need answers. Learn to handle the most common price objection through three angles: the real cost of cheap competition, the genuine rise in material costs, and the discipline of selling value instead of discounting.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: '"Too Expensive" Is Not the End of the Conversation',
        body: `The most common objection you will ever hear on a driveway is some version of "that's too expensive." It is not a rejection — it is an invitation to justify your value. A customer who says it is still talking to you, still standing on the driveway, still interested. Your job is to respond with confidence, not to flinch and immediately drop your price.

This module gives you three solid angles for the price objection: the real cost of cheap competition, the genuine rise in material costs, and the discipline of holding value over discounting. Master all three and "too expensive" becomes just another step on the way to a yes.`,
      },
      {
        type: 'text',
        heading: 'Angle 1: You Get What You Pay For — Unprofessional Competition',
        body: `Sometimes the price objection is really a comparison: "the guy down the street will do it cheaper." Here is how you handle it without ever badmouthing anyone.

There is a lot of unprofessional competition in driveway sealing — the one-person operation with a cheap rig, minimal training, and a weak belief in their own work. These outfits cut every corner that costs them time or money: they skip the weeding, barely clean the surface, do not tape the borders, and often use cheap acrylic "paint" sealant that sits on top and peels within a season. You have all heard the horror stories — sealer sprayed onto a neighbour's car, a botched job that looks worse than before.

CPS is the largest professional driveway sealing company in Canada, with trained crews, commercial-grade tar-based product, and a full workmanship guarantee. So when a customer raises a cheaper quote, do not argue or talk the competitor down. Simply take your game to the next level: re-walk the value, point out the prep steps the cheap guys skip, and let the quality of what you are offering speak for itself. The phrase to plant: a cheap seal done badly costs more in the end, because they will be paying again — to you — to fix it.`,
      },
      {
        type: 'text',
        heading: 'Angle 2: The Honest Truth — Costs Have Skyrocketed',
        body: `Part of holding your price is being honest about the market. The reality of the world we live in is that things are more expensive than they were five years ago — and that absolutely includes driveway sealing.

The materials themselves have skyrocketed in cost: gasoline to run the machines, the commercial tar-based sealant, and the rubberized crack filler have all gone up significantly. This is not a CPS markup — it is the same inflation the customer feels at the gas pump and the grocery store. Most homeowners understand this instantly, because they are living it too.

You can say it plainly and without apology: "I completely understand — and you're right that it's not cheap. The honest truth is the cost of the sealant, the crack filler, and the gas to run our equipment has gone up a lot in the last few years, same as everything else. What hasn't changed is that this is still the single best thing you can do to protect a driveway that costs thousands to replace." Honesty about cost, paired with the value of protection, is far more persuasive than a defensive excuse.`,
      },
      {
        type: 'text',
        heading: 'Angle 3: Sell Value, Don\'t Discount',
        body: `The most important discipline in handling price objections is this: focus on value, not on discounting. Every time you reflexively cut your price, you teach the customer that your number was never real — and you give away margin you will never get back.

Remember the golden rule from the Building Value module: when value exceeds price, a sale occurs. So when you hit a price objection, your first instinct should be to add value, not subtract price. Point out another crack. Re-explain why tar-based beats acrylic. Remind them what an unsealed driveway looks like after one more winter. Mention the workmanship guarantee.

Only after you have genuinely rebuilt the value should you reach for the structured discounts you learned in Pricing & Closing — the high/low (drop the crack filler) and then the tax-on-cash offer. Those are real, built-in levers. Random price-slashing is not. Hold your ground, sell the value, and use your discounts in order, as a last resort rather than a first reflex.`,
      },
    ],
    quiz: [
      {
        question: 'What does a "too expensive" objection actually represent?',
        options: [
          'A flat rejection — time to leave',
          'An invitation to justify your value; the customer is still interested and still talking',
          'A demand for a 50% discount',
          'A sign the customer cannot afford anything',
        ],
        correct_index: 1,
        explanation: '"Too expensive" is not a no — it is an opening to demonstrate value. The customer is still on the driveway and still engaged.',
      },
      {
        question: 'What are the three angles for handling a price objection in this module?',
        options: [
          'Beg, plead, and discount',
          'Unprofessional competition, rising material costs, and selling value over discounting',
          'Walk away, call your manager, and come back tomorrow',
          'Lower the price, lower it again, then leave',
        ],
        correct_index: 1,
        explanation: 'The three angles are: the real cost of cheap competition, the genuine rise in material costs, and the discipline of value over discounting.',
      },
      {
        question: 'When a customer mentions a cheaper competitor, what should you do?',
        options: [
          'Aggressively badmouth the competitor',
          'Do not argue or talk them down — re-walk your value, point out the prep steps cheap operators skip, and let your quality speak',
          'Immediately match their price',
          'Tell the customer they are being cheap',
        ],
        correct_index: 1,
        explanation: 'Never badmouth competitors. Take your game to the next level — re-walk the value and highlight the corners cheap operators cut.',
      },
      {
        question: 'What corners do unprofessional competitors typically cut?',
        options: [
          'They charge too much and over-prepare',
          'They skip weeding, barely clean the surface, skip taping, and use cheap acrylic "paint" sealant',
          'They use better product than CPS',
          'They offer longer guarantees',
        ],
        correct_index: 1,
        explanation: 'Cheap operators cut the steps that cost time and money: weeding, cleaning, taping, and proper product — often using acrylic that peels within a season.',
      },
      {
        question: 'What is the key phrase to plant about a cheap, botched seal?',
        options: [
          'That it is just as good as a CPS job',
          'That a cheap seal done badly costs more in the end, because they will pay again — to us — to fix it',
          'That cheap is always fine for driveways',
          'That they should do it themselves',
        ],
        correct_index: 1,
        explanation: 'A cheap job done badly costs more in the long run because it has to be redone. You get what you pay for.',
      },
      {
        question: 'How should you frame the rise in material costs?',
        options: [
          'Blame CPS for marking up prices',
          'Honestly — gas, sealant, and crack filler have genuinely skyrocketed, the same inflation the customer feels everywhere else',
          'Deny that anything has gotten more expensive',
          'Refuse to discuss cost',
        ],
        correct_index: 1,
        explanation: 'Be honest: the materials have genuinely risen in cost, the same inflation the customer feels at the pump and store. Honesty is more persuasive than a defensive excuse.',
      },
      {
        question: 'Why does honesty about rising costs work so well as a response?',
        options: [
          'Because it lowers the price',
          'Because most homeowners are living the same inflation and instantly understand it',
          'Because it confuses the customer',
          'Because it is a legal requirement',
        ],
        correct_index: 1,
        explanation: 'Homeowners feel the same inflation at the gas pump and grocery store, so an honest explanation of rising material costs lands instantly.',
      },
      {
        question: 'What is the most important discipline when handling a price objection?',
        options: [
          'Discount fast before they change their mind',
          'Focus on adding value, not subtracting price',
          'Always start with your lowest price',
          'Never mention value',
        ],
        correct_index: 1,
        explanation: 'Reflexive discounting teaches the customer your price was never real. Add value first; reach for discounts only as a structured last resort.',
      },
      {
        question: 'In what order should you use your discounts?',
        options: [
          'Random cuts until they agree',
          'Rebuild value first, then high/low (drop the crack filler), then tax-on-cash — as a last resort, not a reflex',
          'Tax-on-cash first, then giant cuts',
          'Never use discounts at all',
        ],
        correct_index: 1,
        explanation: 'Rebuild value first, then use the structured levers in order: high/low (drop the crack filler), then tax-on-cash. Random slashing is not a strategy.',
      },
      {
        question: 'What happens every time you reflexively cut your price?',
        options: [
          'The customer trusts you more',
          'You teach the customer your number was never real, and you give away margin you cannot get back',
          'Nothing — it is always the right move',
          'You automatically win the sale',
        ],
        correct_index: 1,
        explanation: 'Reflexive discounting signals your price was inflated and erodes margin permanently. Hold your ground and sell the value.',
      },
    ],
  },

  // =====================================================================
  // MODULE 18 — Linking / Working the Bubble
  // =====================================================================
  {
    module_id: 'module_18_linking_sealing',
    order_index: 18,
    is_active: true,
    level: 3,
    title: 'Linking & Working the Bubble',
    description:
      'Driveway sealing is one of the most linkable services CPS offers — it just looks so good. Master the Mushroom with a Name and Eyes & Ears techniques, recast for sealing, to turn one driveway into a whole street.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'Why Sealing Is the Most Linkable Service',
        body: `If you enjoyed linking in aeration, wait until you seal. Driveway sealing is one of the most highly linkable services CPS offers, for one simple reason: it just looks so darn good. A finished driveway sitting deep black and clean next to the grey, cracked ones on either side is the loudest advertisement on the street.

Linking is the act of expanding outward from one customer into many, all within view of one another. It has been proven year after year that closing a customer on a link is at least five times easier than closing a cold customer. The top stars do not have magical sales skills — they master linking. Your goal every day: more than half your driveways should come as direct links off other driveways.`,
      },
      {
        type: 'text',
        heading: 'Mushroom with a Name',
        body: `When you close your first sale on a new street, do not just start prepping. First, gather your ammunition: ask the customer for their first name and the names of their surrounding neighbours. Mention that you would love to get the whole street looking great and would appreciate any names they can give you.

Here is the process:

1. Close your first sale and get the customer's name — say it is John.
2. Get neighbour names. Ask John: "Do you know the names of your neighbours on either side or across the street?" Even one name is gold.
3. Begin the prep on John's driveway so there is visible activity — and a flagged, in-progress job for the neighbours to see.
4. Approach the connecting neighbour. With the noise down, walk over and say: "Hi! I'm just next door doing John's driveway, and since I'm already set up here, I can give you the same street deal."
5. Use the name. Addressing them as John's neighbour, by name, dramatically lowers their guard.
6. Close, get more names, and continue 2–3 houses up one side, then cross and work back down the other.

It is called mushrooming because your sales spread outward from a single point. Each new driveway gives you more names and more credibility — and another deep-black driveway on the street doing your advertising for you. As the deck puts it: it is mushroom with ALL the names.`,
      },
      {
        type: 'text',
        heading: 'Eyes & Ears — Trumps Everything',
        body: `Eyes and Ears will always trump all. From the moment your day begins, your eyes and ears should be on high alert for any homeowner you have not yet talked to who is outside.

A car pulling into or out of a driveway. Someone in their yard or garage. Someone walking their dog or heading to the mailbox. Someone glancing over their fence at you. When you see or hear one of these, it is your ethical duty to put yourself in front of them — and you do not even drop what you are doing. Walk over with a broom or blower still in hand and see what happens.

Why is the closing rate on Eyes & Ears the highest of all? Because these people are already outside. There is no door between you and them. They can see your finished driveways, hear your machine, and watch you work. You are approaching them naturally, not interrupting them behind a closed door.

The critical rule: Eyes & Ears trumps everything. If you are in the middle of prepping a driveway and you spot someone outside four houses up — go. The driveway can wait. The mushroom can wait. A prospect who is outside right now cannot wait.`,
      },
      {
        type: 'text',
        heading: 'Build Referrals and Work the Bubble',
        body: `Two more habits keep the link alive all day.

Build referrals from your current clients. Every customer on the driveway is a source of names. While you are talking to John, get the names of his neighbours so you arm yourself with as many linking advantages as possible before you even knock the next door. Names are currency — collect them constantly.

Work hard and always be on stage. It is incredible how much your link grows automatically when you work hard and methodically with a professional, energetic, can-do attitude. Your route is your stage, and everyone is watching. A homeowner who sees you hustling and doing careful work is a homeowner who wants you on their driveway next. The combination of beautiful finished driveways, names in your pocket, and visible hard work is what turns one sale into a whole street.`,
      },
    ],
    quiz: [
      {
        question: 'Why is driveway sealing one of the most linkable services CPS offers?',
        options: [
          'Because it is the cheapest',
          'Because a finished driveway looks so good that it advertises to the whole street',
          'Because homeowners are required to seal in groups',
          'Because it takes all day, so neighbours have time to notice',
        ],
        correct_index: 1,
        explanation: 'A deep-black finished driveway next to grey, cracked ones is the loudest advertisement on the street — making sealing extremely linkable.',
      },
      {
        question: 'How much easier is it to close on a link versus a cold sale?',
        options: ['About the same', 'About 2 times easier', 'At least 5 times easier', 'About 20 times easier'],
        correct_index: 2,
        explanation: 'It has been proven year after year that closing on a link is at least five times easier than closing a cold customer.',
      },
      {
        question: 'What is the daily linking goal?',
        options: [
          'Get all your sales cold',
          'More than half your driveways should come as direct links off other driveways',
          'Link exactly one driveway per day',
          'Never link — focus only on cold sales',
        ],
        correct_index: 1,
        explanation: 'Aim for more than 50% of your driveways to come as direct links. The higher that percentage, the fewer dry spells and the higher your day.',
      },
      {
        question: 'What is the very first thing to do after closing your first sale on a street?',
        options: [
          'Start sealing immediately and ignore the neighbours',
          'Gather names — the customer\'s first name and the names of surrounding neighbours',
          'Pack up and move to a new street',
          'Call your manager to report the sale',
        ],
        correct_index: 1,
        explanation: 'Before prepping, gather your ammunition: get the customer\'s name and their neighbours\' names. Even one name is gold.',
      },
      {
        question: 'Why is it called "mushrooming"?',
        options: [
          'Because you sell mushroom compost',
          'Because your sales spread outward from a single point, like a mushroom from a spore',
          'Because you work only in damp areas',
          'Because it happens overnight',
        ],
        correct_index: 1,
        explanation: 'Mushrooming describes sales spreading outward from one initial customer — each new sale fuelling the next with more names and credibility.',
      },
      {
        question: 'Which linking method has the highest closing percentage?',
        options: ['Cold knocking', 'Mushroom with a Name', 'Go-Backs', 'Eyes & Ears'],
        correct_index: 3,
        explanation: 'Eyes & Ears trumps everything — approaching someone already outside has the highest closing rate of any method.',
      },
      {
        question: 'What should you do if you spot a homeowner outside four houses up while prepping a driveway?',
        options: [
          'Finish the driveway first, then maybe go talk to them',
          'Stop and go — walk over with your broom or blower in hand; the driveway and the mushroom can wait',
          'Shout your pitch from where you are',
          'Wait for them to come to you',
        ],
        correct_index: 1,
        explanation: 'Eyes & Ears trumps everything. A prospect outside right now cannot wait — go to them immediately, tools still in hand.',
      },
      {
        question: 'Why is the Eyes & Ears closing rate so high?',
        options: [
          'Because outdoor prospects are legally obligated to listen',
          'Because there is no door between you — they can see your finished driveways, hear your machine, and you approach them naturally',
          'Because people outside have more money',
          'Because it is done only at night',
        ],
        correct_index: 1,
        explanation: 'Outdoor prospects have no door to hide behind, can see your work and finished driveways, and are approached in a natural, non-threatening way.',
      },
      {
        question: 'Why should you collect neighbour names from every current client?',
        options: [
          'To report them to the office',
          'Names are currency — they arm you with linking advantages before you even knock the next door',
          'To add them to a mailing list',
          'There is no reason to collect names',
        ],
        correct_index: 1,
        explanation: 'Every customer is a source of names. Collecting them constantly arms you with credibility for the next door — it is mushroom with ALL the names.',
      },
      {
        question: 'What does "always be on stage" mean for your linking?',
        options: [
          'Perform for the customers like an actor',
          'Work hard and methodically with a professional, energetic attitude — your visible hustle automatically grows your link because everyone is watching',
          'Only work hard when a manager is present',
          'Take frequent breaks where neighbours can see you resting',
        ],
        correct_index: 1,
        explanation: 'Your route is your stage. Hard, careful, energetic work is visible to every homeowner and naturally grows your link — they want the hustler on their driveway.',
      },
    ],
  },

  // =====================================================================
  // MODULE 19 — 5 Steps to Sealing Success + Operations
  // =====================================================================
  {
    module_id: 'module_19_five_steps_ops',
    order_index: 19,
    is_active: true,
    level: 3,
    title: '5 Steps to Sealing Success + Operations',
    description:
      'The five-step rhythm that runs a great sealing day — Move Fast, Speak Slow, Prep Fast, Spray Slow, Know Your Stuff — plus the operational essentials of cart prep, machine handling, and payment.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'The 5 Steps to Sealing Success',
        body: `Sealing season has its own five-step rhythm. Learn it as a single phrase: Move Fast, Speak Slow, Prep Fast, Spray Slow, Know Your Stuff. Each step has a deliberate pace, and getting the pace right on each one is what separates a big day from an average one.`,
      },
      {
        type: 'text',
        heading: 'Step 1: Move Fast — Step 2: Speak Slow',
        body: `Move Fast. Attack every door with high energy like it is your first. Move systematically through your route without jumping around. The more doors you reach, the more driveways you sell — this is the same "high steps" foundation that drives every CPS season.

Speak Slow. A sealing script requires more value-building than an aeration script, so slow down and let the customer absorb every part of it. If you want a customer to truly hear something, say it three times in different ways. Keep calm and say the number — deliver your price calmly and confidently, then let it sit. Rushing your pitch or your price is how you lose a sale you had already earned.`,
      },
      {
        type: 'text',
        heading: 'Step 3: Prep Fast — Step 4: Spray Slow',
        body: `Prep Fast. Prep systematically so you never redo a step: weeds, wire-brush, blow, crack-fill, tape — in that order, every time. Your prep speed decides your day. Time yourself and work to get faster on prep, because every minute saved in prep is a minute you can spend selling the next driveway.

Spray Slow. The spray is the one place you deliberately slow down. Spray slowly to ensure a great, even coat for the customer. Spraying slowly and carefully is what avoids fix-ups and cleanups — and fix-ups destroy your day. A few extra careful minutes on the spray saves you from going back to redo a botched job later.`,
      },
      {
        type: 'text',
        heading: 'Step 5: Know Your Stuff',
        body: `Know Your Stuff. Know the basic troubleshooting on your machine — at minimum, how to run the line and how to clean the tip. A worker who can clear a simple problem keeps earning while a worker who cannot sits idle waiting for help.

Know what supplies you need, and get them while your manager is around. Running out of tape, crack filler, or gas mid-route — with no manager nearby — is a self-inflicted wound. Stock up before you are dropped off.`,
      },
      {
        type: 'text',
        heading: 'Morning Cart Prep',
        body: `A big day starts with a properly prepared cart. Every morning:

Fill gas in the engine and the blower, and get extra blower gas in a clearly labelled container. Check your bin and supplies — make sure you have tape, flagging tape, poles, a couple of rags, latex gloves, crack filler, and spreaders. Stock your folder with a logsheet, a couple of contracts, receipts, and note sheets.

Do NOT remove your tip from the cart in the morning. And before your manager checks the cart for the trailer, make sure it is highway-safe: nothing unsecured, and the tar cap screwed on.`,
      },
      {
        type: 'text',
        heading: 'Machine Handling Through the Day',
        body: `A few machine habits protect your day and your equipment:

When prepping your first driveway, carefully remove the tip — placing it in Varsol or gas — and run the line back into the tank. This ensures optimal pressure when you start spraying.

Run the line after any hour-long stretch where you have not sprayed a driveway — especially on colder days, when sealant thickens.

Always ensure the tar cap is screwed on whenever you move the cart, including loading and unloading. A loose tar cap during transport is a mess waiting to happen.

These small habits are the difference between a smooth spray and a day lost to pressure problems and cleanups.`,
      },
      {
        type: 'text',
        heading: 'Payment and HST',
        body: `Handle every transaction correctly:

Always charge HST on cheques, credit cards, and e-transfers — 13% is applied to these payment types. E-transfers should only be used as a last resort.

This is also the mechanism behind the tax-on-cash discount you learned in Pricing & Closing: because cash avoids the 13%, offering to waive the tax for a cash payment is a genuine saving you can give without cutting your base price.

Set your goals, prep your cart, and get fired up for a big day — every day.`,
      },
    ],
    quiz: [
      {
        question: 'What is the five-step phrase for a great sealing day?',
        options: [
          'Run All Day, Ring and Listen, Cross the Lawn, Keep it Brief, Work Fast',
          'Move Fast, Speak Slow, Prep Fast, Spray Slow, Know Your Stuff',
          'Sell Hard, Prep Hard, Spray Hard, Close Hard, Drive Home',
          'Wake Early, Work Late, Save Money, Repeat, Win',
        ],
        correct_index: 1,
        explanation: 'The 5 Steps to Sealing Success are: Move Fast, Speak Slow, Prep Fast, Spray Slow, Know Your Stuff.',
      },
      {
        question: 'Why does a sealing script call for "Speak Slow"?',
        options: [
          'Because customers are hard of hearing',
          'A sealing script needs more value-building than aeration, so slowing down lets the customer absorb every part of it',
          'Because the machine is loud',
          'To waste time until Go-Time',
        ],
        correct_index: 1,
        explanation: 'Sealing requires more value-building, so speaking slowly lets the customer absorb the pitch. If you want them to hear something, say it three times.',
      },
      {
        question: 'What is the correct order of prep steps?',
        options: [
          'Tape, blow, weeds, crack-fill, wire-brush',
          'Weeds, wire-brush, blow, crack-fill, tape',
          'Crack-fill, tape, weeds, blow, wire-brush',
          'Blow, tape, crack-fill, weeds, wire-brush',
        ],
        correct_index: 1,
        explanation: 'Prep systematically in order — weeds, wire-brush, blow, crack-fill, tape — so you never have to redo a step.',
      },
      {
        question: 'Which step do you deliberately slow down on, and why?',
        options: [
          'Prep — to be gentle on the driveway',
          'Spray — spraying slowly ensures an even coat and avoids fix-ups, which destroy your day',
          'Moving between doors — to conserve energy',
          'None — speed is everything',
        ],
        correct_index: 1,
        explanation: 'Spray Slow: a careful, even coat avoids the fix-ups and cleanups that wreck a day. A few extra minutes on the spray saves a return trip.',
      },
      {
        question: 'What two basic machine skills must every sealer know?',
        options: [
          'Rebuilding the engine and replacing the pump',
          'How to run the line and how to clean the tip',
          'Repainting the cart and welding the frame',
          'None — managers handle all machine issues',
        ],
        correct_index: 1,
        explanation: 'Know Your Stuff means basic troubleshooting: at minimum, running the line and cleaning the tip, so a small problem does not stop your day.',
      },
      {
        question: 'In the morning, what should you NOT do to your cart?',
        options: [
          'Fill the gas',
          'Check your supplies',
          'Remove your tip from the cart',
          'Screw on the tar cap',
        ],
        correct_index: 2,
        explanation: 'Do not remove your tip in the morning. You remove it carefully while prepping your first driveway, placing it in Varsol or gas and running the line.',
      },
      {
        question: 'When should you run the line during the day?',
        options: [
          'Never — only in the morning',
          'After any hour-long stretch where you have not sprayed, especially on colder days',
          'Only when the manager tells you to',
          'Every five minutes regardless',
        ],
        correct_index: 1,
        explanation: 'Run the line after any hour without spraying, especially on cold days when sealant thickens, to maintain optimal pressure.',
      },
      {
        question: 'When must the tar cap be screwed on?',
        options: [
          'Only at the end of the day',
          'Whenever you move the cart, including loading and unloading',
          'Only while spraying',
          'It does not matter',
        ],
        correct_index: 1,
        explanation: 'Always ensure the tar cap is screwed on whenever the cart moves — including loading and unloading — to prevent spills.',
      },
      {
        question: 'On which payment types is 13% HST charged?',
        options: [
          'Cash only',
          'Cheques, credit cards, and e-transfers',
          'No payment types',
          'Only e-transfers',
        ],
        correct_index: 1,
        explanation: '13% HST applies to cheques, credit cards, and e-transfers. E-transfers should only be used as a last resort.',
      },
      {
        question: 'How does the HST rule connect to the tax-on-cash discount?',
        options: [
          'It does not connect at all',
          'Because cash avoids the 13% HST, waiving the tax for cash is a genuine saving you can offer without cutting your base price',
          'Cash is charged double tax',
          'The discount means you skip recording the sale',
        ],
        correct_index: 1,
        explanation: 'Cash avoids the 13% HST charged on other methods, so a tax-on-cash discount is a real saving — not a cut to your base price.',
      },
    ],
  },

  // =====================================================================
  // MODULE 20 — Selling in the Rain (PROS)
  // =====================================================================
  {
    module_id: 'module_20_pros_rain',
    order_index: 20,
    is_active: true,
    level: 3,
    title: 'Selling in the Rain (PROS)',
    description:
      'Rain does not have to mean a lost day. The PROS model — Professional Rain Opportunity Sales — turns a rained-out day into a booked-out tomorrow. Learn the paperwork, strategy, and rain-day script that fill your route for the next day.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'What PROS Is and Why It Works',
        body: `You cannot spray sealant in the rain — but you can sell it. PROS stands for Professional Rain Opportunity Sales: instead of writing off a rainy day, you spend it booking driveways for the days ahead. It takes what is clearly a negative and turns it into a positive.

There is no better all-star move than getting good at working around the rain. Selling and booking driveways in the rain teaches you different forms of closing, prepares you for the days when you are sealing around the rain, and teaches you to link without any work done on the ground. On a PROS day you are building tomorrow's line-up today.`,
      },
      {
        type: 'text',
        heading: 'The Paperwork — Your Note Sheet Is Everything',
        body: `Keeping your paperwork organised and dry is the key to your success the following day, when you are taking care of your booked-in clients.

The note sheet is everything. Your route is your office, and your note sheet is your planner — without a properly filled-out note sheet, it is impossible to have a big day with a line-up. Here is the system: yes's go on contracts, no's go on the dashes of the note sheet, go-backs and leads go in the bottom notes section, and the only people left to chase are the ones who were not home.

Put all customer information on the contracts. Verbal agreements have a high cancel rate, so always get the details down and get the signature — a signature is 100% good to go. On a PROS day, the folder at the door is acceptable; bring it right up with you.`,
      },
      {
        type: 'text',
        heading: 'The Strategy — Leave Every Door a Maybe',
        body: `Look clean. Dress like you would for aeration — to sell a lot of sealing in the rain, make sure you have zero sealant on you. You are the professional who shows up regardless of weather.

On a PROS day you are only on route for about six hours, which gives you time to hit your whole route at least once. One of the greatest benefits of the model is that you have the span of two days to reach everyone on your route. Pricing on PROS contracts is traditionally better than on a regular day — stick to flyer pricing and discount very little, because you can always close them the next day on a lower price if you need to.

The single most important rule: do your best to leave every door as a maybe. This is a great strategy in general, but it is crucial during a rain line-up. A "maybe" is a door you can come back to tomorrow; a hard "no" is gone forever.`,
      },
      {
        type: 'text',
        heading: 'The Rain Script: Introduction',
        body: `Selling in the rain requires attacking the door with overwhelming positivity. Be genuinely happy that you have found a way to be out there for your clients even though it is raining.

Open with humour. Make a light joke about how you would have loved to be out sealing for your scheduled clients, but mother nature got in the way — and that is exactly why you will be back the next day, which gives you enough time to take care of even more clients on the street.

Then ask the question: "When was your driveway sealed last?" Push for a "how much?" by emphasising a big community event — a whole lot of their neighbours are getting serviced the next day.`,
      },
      {
        type: 'text',
        heading: 'The Rain Script: Building Value and Closing',
        body: `Building value in the rain. It is hard to get someone onto the driveway when it is pouring, so if you catch a break in the rain, get them out there. When you talk about the product, highlight that our tar-based sealant creates a water-repellent barrier — and use the rain itself to illustrate it: that water soaking into their driveway right now is the same water that freezes and cracks the asphalt in winter. Instigate another "how much?" with: "So why don't we set you up for the same deal as all the neighbours and get you done at the same time tomorrow?"

Linking and closing pen to paper. Closing during a PROS day is actually easier than a regular day, because there is no pressure for the homeowner to be called to action immediately — they do not have to move cars or clear the driveway right now. Just like selling normally, the hardest ones to get are the first couple. Once you have your first couple booked, keep your completed contracts on top of your blank ones — flashing the yellow copy of a completed contract is the number-one method of linking on a PROS day. Deliver the price confidently, assume the sale, and put pen to paper.`,
      },
      {
        type: 'text',
        heading: 'The After-Sale Pre-Frames',
        body: `Once the sale is made, lock it in with the after-sale pre-frames — this is the most important part after the close:

Confirm what part of the day the client will be home for payment. They do not need to be home while the work is done, but you need to know when you can collect.

Help the client figure out parking for tomorrow. Flag the lawn — you can use this as another method of linking. If it is a weedy driveway, you can even start a little de-weeding to show good faith.

Ask for referrals right away. If the referred neighbour is not home, mark their name and address in the notes section of your note sheet so you can hit them up the next day. Every name you bank today is a warmer door tomorrow.`,
      },
    ],
    quiz: [
      {
        question: 'What does PROS stand for and what is its purpose?',
        options: [
          'Professional Rain Opportunity Sales — booking driveways on rainy days for the days ahead',
          'Premium Rate Of Sealing — a pricing tier',
          'Property Repair Operations Service — a repair add-on',
          'Public Relations Outreach Strategy — a marketing program',
        ],
        correct_index: 0,
        explanation: 'PROS is Professional Rain Opportunity Sales: you cannot spray in the rain, so you spend the day booking driveways for the days ahead.',
      },
      {
        question: 'Why is the note sheet so important on a PROS day?',
        options: [
          'It is just for doodling between doors',
          'Your route is your office and your note sheet is your planner — without it filled out properly, you cannot have a big day with a line-up',
          'It replaces the contract entirely',
          'It is only used at the end of the season',
        ],
        correct_index: 1,
        explanation: 'The note sheet is your planner for tomorrow. Yes\'s go on contracts, no\'s on the dashes, go-backs and leads in the notes section.',
      },
      {
        question: 'Why should you always get a signature and full details rather than a verbal agreement?',
        options: [
          'Verbal agreements are illegal',
          'Verbal agreements have a high cancel rate; a signature is 100% good to go',
          'Signatures are just for show',
          'It does not matter on a PROS day',
        ],
        correct_index: 1,
        explanation: 'Verbal agreements cancel often. Putting all the info on the contract and getting a signature locks the booking in for the next day.',
      },
      {
        question: 'What is the single most important rule on a PROS day?',
        options: [
          'Close every door with a hard yes or move on',
          'Leave every door as a maybe',
          'Only knock on driveways without cracks',
          'Quote the highest possible price',
        ],
        correct_index: 1,
        explanation: 'Leave every door a maybe. A maybe is a door you can return to tomorrow; a hard no is gone. This is crucial during a rain line-up.',
      },
      {
        question: 'How should pricing work on PROS contracts?',
        options: [
          'Discount heavily to book as many as possible',
          'Stick to flyer pricing and discount very little — you can always close them lower the next day if needed',
          'Charge double because of the weather',
          'There is no pricing on PROS days',
        ],
        correct_index: 1,
        explanation: 'PROS pricing is traditionally better than a regular day. Stick to flyer pricing and discount little, since you can lower it tomorrow if you must.',
      },
      {
        question: 'How should you open the rain-day script?',
        options: [
          'By complaining about the weather',
          'With overwhelming positivity and humour — a light joke about mother nature, then explaining you will be back the next day',
          'By immediately quoting a price',
          'By apologising for disturbing them',
        ],
        correct_index: 1,
        explanation: 'Attack the door with positivity and humour. Joke about the rain, then explain that is exactly why you will be back tomorrow to take care of even more clients.',
      },
      {
        question: 'How can you use the rain itself as a value-building tool?',
        options: [
          'Tell them rain is good for driveways',
          'Point out that the water soaking into their driveway now is the same water that freezes and cracks the asphalt in winter — and our sealant creates a water-repellent barrier',
          'Avoid mentioning the rain',
          'Say the rain means they do not need sealing',
        ],
        correct_index: 1,
        explanation: 'Use the live rain as a demonstration: that water soaking in now freezes and cracks the asphalt in winter; the sealant is the barrier that keeps it out.',
      },
      {
        question: 'What is the number-one method of linking on a PROS day?',
        options: [
          'Shouting prices down the street',
          'Flashing the yellow copy of a completed contract while keeping completed contracts on top of your blank ones',
          'Leaving flyers in every mailbox',
          'Sealing half a driveway as a demo',
        ],
        correct_index: 1,
        explanation: 'Keep completed contracts on top of blank ones and flash the yellow copy — visible proof that neighbours have booked is the top PROS linking method.',
      },
      {
        question: 'Why is closing on a PROS day actually easier than a regular day?',
        options: [
          'Because customers feel sorry for you in the rain',
          'There is no pressure for the homeowner to act immediately — they do not have to move cars or clear the driveway right now',
          'Because you give everything away for free',
          'It is not easier — it is much harder',
        ],
        correct_index: 1,
        explanation: 'On a PROS day the customer is not called to action immediately — no moving cars or clearing the driveway now — which removes the friction of an on-the-spot job.',
      },
      {
        question: 'What is the most important thing to do after making the sale on a PROS day?',
        options: [
          'Leave immediately to find the next door',
          'Lock in the after-sale pre-frames — confirm payment timing, sort out parking, flag the lawn, and ask for referrals right away',
          'Start sealing in the rain anyway',
          'Tell them the price might change tomorrow',
        ],
        correct_index: 1,
        explanation: 'The after-sale pre-frames are the most important part after the close: confirm when they will be home to pay, sort parking, flag the lawn, and bank referral names.',
      },
    ],
  },
];
