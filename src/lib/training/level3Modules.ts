// src/lib/training/level3ModulesA.ts
// Level 3 Training Modules — Driveway Sealing — PART A (Modules 11–15).
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

export const LEVEL_3_MODULES_A: TrainingModule[] = [
  // =====================================================================
  // MODULE 11 — Health, Safety & WHMIS for Sealing
  // =====================================================================
  {
    module_id: 'module_11_sealing_safety',
    order_index: 11,
    is_active: true,
    level: 3,
    title: 'Health, Safety & WHMIS for Sealing',
    description:
      'Before you sell a single driveway, learn how to work safely with the chemicals used in sealing season. Covers the five hazardous materials, your PPE, the WHMIS system, first-aid responses, and safe cart handling.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'Why Safety Comes First in Sealing',
        body: `Driveway sealing is the only CPS season where you handle genuinely hazardous materials every single day. In aeration, your biggest risk is a sprinkler head. In sealing, you are working with gasoline, solvents, and a tar-based sealant — products that are flammable, harmful to breathe, and dangerous if they touch your eyes or skin. That is why this is the very first module of the level: before you sell a single driveway, you need to know how to keep yourself safe.

The good news is that CPS provides everything you need to work safely. Goggles, face masks, and gloves are all supplied by the company. Your job is to actually use them, to know what you are handling, and to know exactly what to do if something goes wrong.

This module is built around WHMIS — the Workplace Hazardous Materials Information System — which is the Canadian standard for identifying and safely handling hazardous products. Knowing this material is not optional. It protects you, your teammates, and the customer's property.`,
      },
      {
        type: 'text',
        heading: 'The Three-Step Hazard Process: Recognize, Assess, Control',
        body: `Every workplace hazard is handled with the same three-step process.

Recognize: Identifying a hazard and determining whether there is a chance of someone being affected by it. Anyone can identify a hazard — if you see one, you are expected to flag it.

Assess: Once a hazard is identified, it is assessed. If it is found to be significant, a plan is made to control it.

Control: A hazard can be controlled at its source, along the path between the source and the worker, or at the worker. Control at the source is always preferred. Controlling hazards is the employer's responsibility.

A simple example: you notice a fuel container left too close to a heat source. You tell your manager. He agrees it is a risk and moves it to a cool, ventilated spot. Hazard recognized, assessed, and controlled.`,
      },
      {
        type: 'text',
        heading: 'The Five Materials You Will Handle',
        body: `During sealing season you will come into contact with five hazardous materials. Know them by name and know their dangers.

Gasoline — poured from jerry cans into the engines that power the sealing sprayer. Flammable as both a liquid and a vapour. Never inhale it while gassing up the machine.

Driveway Sealant — the tar-based product sprayed onto the driveway. A flammable liquid that is harmful if inhaled and may be fatal if swallowed or if it enters your airways.

Crack Filler — the rubberized product applied to major cracks before sealing. Same family of hazards as the sealant: flammable and a skin/health hazard.

Varsol — a low-odour paint-thinner solvent used to clean driveway sealant off the spray-wand bolt tips. Combustible and toxic. Always wear rubber gloves when cleaning bolts in Varsol.

EcoSol — a clear, citrus-based degreaser used to clean sealant and crack filler off surfaces. Combustible and an irritant to the lungs, skin, and eyes.

For all five, the rules are the same: keep them away from heat, sparks, open flames, and hot surfaces; never smoke around them; use them only outdoors or in a well-ventilated area; wear your protective gear; and wash your hands thoroughly after handling.`,
      },
      {
        type: 'text',
        heading: 'Your PPE and the MSDS Sheets',
        body: `Personal Protective Equipment (PPE) reduces or prevents your exposure to hazards. For sealing season, your PPE is: sturdy closed-toe shoes, suitable clothing for the weather, gloves, eye goggles, and a face mask. The goggles, masks, and gloves are all provided by the company — wear them.

Every hazardous product has a Material Safety Data Sheet (MSDS) that lists its hazards, safe handling, storage, and first-aid response. You must know where the MSDS sheets are kept at your workplace. If you do not know, ask your manager before you start the season — do not wait until there is an emergency to go looking.`,
      },
      {
        type: 'text',
        heading: 'First Aid: What To Do If Something Goes Wrong',
        body: `Memorise these responses. They apply across the sealing chemicals.

If it gets in your eyes: Flush your eyes with running water, keeping the eyelids open, for several minutes. Then seek medical attention.

If it gets on your skin or in your hair: Remove any contaminated clothing. For sealant, remove it with a petroleum solvent-based hand cleaner (the orange mechanic's soap type) and then rinse with water.

If you inhale it: Move to fresh air immediately and monitor your breathing. If symptoms persist, call a physician.

If you swallow it: Rinse your mouth. Do NOT induce vomiting — bringing these products back up can cause more damage. Immediately call a poison centre or doctor.

When in doubt, tell your Route Manager right away. The manager will assess the situation and decide whether you should switch routes, end your day early, or seek medical attention — and will report the incident as required.`,
      },
      {
        type: 'text',
        heading: 'Safe Cart Handling — Protecting Your Body',
        body: `Sealing carts are heavy, and pushing them the wrong way is how workers hurt their backs and shoulders. The company-wide rule for avoiding sprains and strains is simple:

Always push the cart from the rear, using the vertical or horizontal bars. Never pull or steer the cart from the front. If a partner is helping, they direct or help push from the side only, using the rails or handles — never from in front of the cart.

Beyond cart handling: rest your body briefly after completing each job, and tell your manager right away if you feel any physical discomfort. Sealing is a long, physical day — looking after your body is part of looking after your earnings.`,
      },
    ],
    quiz: [
      {
        question: 'What does WHMIS stand for?',
        options: [
          'Workplace Hazard Monitoring and Inspection Standard',
          'Workplace Hazardous Materials Information System',
          'Worker Health Management and Industrial Safety',
          'Warehouse Handling of Materials and Inventory System',
        ],
        correct_index: 1,
        explanation: 'WHMIS is the Workplace Hazardous Materials Information System — the Canadian standard for identifying and safely handling hazardous products.',
      },
      {
        question: 'How many hazardous materials will you regularly handle during sealing season, and what are they?',
        options: [
          'Two: gasoline and water',
          'Three: gasoline, sealant, and crack filler only',
          'Five: gasoline, driveway sealant, crack filler, Varsol, and EcoSol',
          'Six: including WD40 and resin',
        ],
        correct_index: 2,
        explanation: 'Sealing season involves five hazardous materials: gasoline, driveway sealant, crack filler, Varsol, and EcoSol. (WD40 is aeration; resin is cleaning season.)',
      },
      {
        question: 'It is safe to inhale gasoline while you gas up the machines. True or False?',
        options: ['True', 'False'],
        correct_index: 1,
        explanation: 'False. Gasoline is hazardous as both a liquid and a vapour. Never inhale it while fuelling — work in a ventilated area and keep your face clear of the fumes.',
      },
      {
        question: 'If you get a hazardous material in your eyes, what should you do?',
        options: [
          'Rub them dry with a cloth and continue working',
          'Flush them with running water, keeping the eyelids open, then seek medical attention',
          'Wait a few minutes to see if the irritation passes',
          'Apply hand cleaner directly to the eye',
        ],
        correct_index: 1,
        explanation: 'For any chemical eye contact, flush with running water keeping the eyelids open for several minutes, then seek medical attention.',
      },
      {
        question: 'If you swallow a hazardous material such as sealant or solvent, you should induce vomiting. True or False?',
        options: ['True', 'False'],
        correct_index: 1,
        explanation: 'False. Never induce vomiting — these products can do more damage coming back up. Rinse your mouth and immediately call a poison centre or doctor.',
      },
      {
        question: 'You should wear gloves when cleaning the sealing wand bolts in Varsol. True or False?',
        options: ['True', 'False'],
        correct_index: 0,
        explanation: 'True. Varsol is a combustible, toxic solvent and a skin irritant. Always wear rubber gloves when cleaning bolts in it.',
      },
      {
        question: 'Is it safe to reuse empty Varsol containers to store other liquids?',
        options: [
          'Yes, as long as you rinse them once',
          'No — never reuse Varsol containers for other liquids',
          'Only if you relabel them',
          'Only for storing water',
        ],
        correct_index: 1,
        explanation: 'No. Reusing solvent containers for other liquids risks dangerous chemical residue, contamination, and mislabelling. Do not reuse them.',
      },
      {
        question: 'Driveway sealant and crack filler pose no hazards as long as they are used outdoors. True or False?',
        options: ['True', 'False'],
        correct_index: 1,
        explanation: 'False. Working outdoors helps with ventilation, but these are flammable products that are harmful if inhaled and may be fatal if swallowed. PPE and safe handling are still required.',
      },
      {
        question: 'Where should you find the specific hazards and first-aid steps for a product, and where are they kept?',
        options: [
          'On the product label only; they are kept in the van glovebox',
          'On the MSDS sheets; you must know where they are kept at your workplace (ask your manager if unsure)',
          'You memorise them — there is no document',
          'On the CPS website only',
        ],
        correct_index: 1,
        explanation: 'Every hazardous product has an MSDS sheet detailing its hazards, handling, and first-aid response. You must know where they are kept — ask your manager before the season starts if you do not.',
      },
      {
        question: 'What is the correct way for two people to move a sealing cart down a street?',
        options: [
          'One pulls from the front while the other pushes from the rear',
          'Both push from the rear or one pushes from the rear while a partner helps from the side — never from in front',
          'One person carries the front end off the ground',
          'Push it as fast as possible to get it over with',
        ],
        correct_index: 1,
        explanation: 'Always push from the rear using the bars; a partner helps from the side only. Never pull or direct the cart from in front — that is how back and shoulder injuries happen.',
      },
    ],
  },

  // =====================================================================
  // MODULE 12 — Intro to Driveway Sealing (SealStar/+ & Acrylic vs Tar)
  // =====================================================================
  {
    module_id: 'module_12_intro_sealing',
    order_index: 12,
    is_active: true,
    level: 3,
    title: 'Intro to Driveway Sealing: The Product That Sells Itself',
    description:
      'Understand what driveway sealing actually is, why homeowners need it, the two programs you offer (SealStar and SealStar +), and the single most important piece of product knowledge: why our oil/tar-based sealant beats cheap acrylic.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'What Driveway Sealing Is — and Why It Sells',
        body: `Driveway sealing is one of the most satisfying and highly sellable services CPS offers. The reason is simple: it just looks so good. A freshly sealed driveway goes from grey, cracked, and tired to a clean, deep black matte finish — and the whole street sees the transformation. That visible result is your best salesperson.

But it is far more than a cosmetic upgrade. Asphalt is constantly being eroded by the sun's natural oxidation and by the chemicals it meets every day — gasoline, engine oil, transmission fluid, antifreeze. Left unprotected, that erosion leads to cracks, then heaving, then potholes, and eventually a major bill for a brand-new driveway. A newly laid asphalt driveway lasts roughly five to fifteen years if neglected. With regular seal coating, that same driveway can last fifteen to thirty years. An annual seal is the single best thing a homeowner can do to protect their asphalt.`,
      },
      {
        type: 'text',
        heading: 'The Two Programs: SealStar and SealStar +',
        body: `Every driveway you quote falls into one of two programs. Knowing the difference cold is the foundation of every pitch and every price.

SealStar (logsheet code: SS) — the standard program, suited for newer driveways that have not formed any visible cracks. It includes a thorough removal of all dirt, debris, and weeds, taping off concrete and stone borders, and a high-quality commercial-grade tar-based sealant that cures and dries to a black matte finish.

SealStar + (logsheet code: SSP) — the upgraded program, suited for mature driveways that have begun to crack or that need a lot of preparation, cleaning, or taping. It includes everything in SealStar, plus a professional application of commercial-grade rubberized crack filler. That filler goes in as a liquid and forms a solid rubber, keeping moisture out of the cracks so it cannot freeze, expand, and tear the driveway apart over winter.

In short: no real cracks, sell SealStar. Cracks that need filling, sell SealStar +.`,
      },
      {
        type: 'text',
        heading: 'Know Your Product: Acrylic vs Oil/Tar-Based Sealant',
        body: `This is the single most important piece of product knowledge you carry, and it wins sales on its own. Homeowners — and cheap competitors — often use acrylic-based sealants from the hardware store. You need to be able to explain, with confidence, why ours is fundamentally different and better.

Cheap acrylic sealants are essentially paint. They sit on top of the asphalt as a surface layer. Worse, because they are acrylic they actually prevent the permeability the asphalt needs, and they tend to crack and peel rather than protect.

Our commercial-grade oil/tar-based sealant works the opposite way. It does not sit on the surface — it soaks down into the top layer of the asphalt and cures right into it, restoring the asphalt's natural elastic properties and creating a water-repellent barrier. It will not be dissolved by petroleum products like gasoline or oil.

The clearest way to explain it to a customer: sealing with a cheap acrylic product is like painting a piece of wood — the paint just stays on the surface. Sealing with our commercial tar-based product is like staining a piece of wood — the liquid soaks right in and becomes part of it. One coats; the other protects from within.`,
      },
      {
        type: 'text',
        heading: 'The Water Story — Your Simplest Value Argument',
        body: `If you only remember one way to explain why sealing matters, make it this one — and use the weather to do it.

Unsealed asphalt is porous. Water soaks into it. In the winter, that trapped water freezes, expands, and forces the asphalt apart — that is how cracks form and grow. Our tar-based sealant creates a water-repellent barrier that keeps the moisture out in the first place.

On a wet or rainy day, this practically demonstrates itself: point to the water soaking into their bare driveway and explain that the same thing happens all winter long, except then it freezes and cracks the surface. You are not selling a paint job — you are selling protection against a problem they can see happening right in front of them.`,
      },
    ],
    quiz: [
      {
        question: 'Why is driveway sealing such a highly sellable, linkable service?',
        options: [
          'Because it is the cheapest service CPS offers',
          'Because the finished result is so visibly striking that the whole street sees the transformation',
          'Because homeowners are legally required to seal their driveways',
          'Because it can only be done once per driveway, ever',
        ],
        correct_index: 1,
        explanation: 'A freshly sealed driveway transforms from grey and cracked to a deep black finish. That dramatic, visible result sells the neighbours for you.',
      },
      {
        question: 'How long can a properly maintained asphalt driveway last with regular seal coating versus without?',
        options: [
          'About the same either way',
          '5–15 years neglected, versus 15–30 years with regular sealing',
          '1–2 years neglected, versus 5 years with sealing',
          '30 years neglected, versus 50 years with sealing',
        ],
        correct_index: 1,
        explanation: 'A neglected asphalt driveway lasts roughly 5–15 years; with regular seal coating it can last 15–30 years. Annual sealing is the #1 way to extend its life.',
      },
      {
        question: 'Which program is suited for a newer driveway with no visible cracks?',
        options: ['SealStar +', 'SealStar', 'Hot Asphalt Ramp', 'Neither — newer driveways do not need sealing'],
        correct_index: 1,
        explanation: 'SealStar (SS) is the standard program for newer driveways with no cracks: clean, tape, and apply the tar-based sealant.',
      },
      {
        question: 'What does SealStar + add that SealStar does not?',
        options: [
          'A second coat of the same sealant',
          'A professional application of commercial-grade rubberized crack filler',
          'A longer warranty only',
          'Pressure washing only',
        ],
        correct_index: 1,
        explanation: 'SealStar + includes everything in SealStar plus a professional application of rubberized crack filler for mature, cracked driveways.',
      },
      {
        question: 'What is the logsheet code for SealStar +?',
        options: ['SS', 'SSP', 'FP', 'BO'],
        correct_index: 1,
        explanation: 'SealStar = SS and SealStar + = SSP on the logsheet.',
      },
      {
        question: 'How does a cheap acrylic sealant behave on a driveway?',
        options: [
          'It soaks deep into the asphalt and restores its elasticity',
          'It is essentially paint — it sits on the surface, prevents permeability, and tends to crack and peel',
          'It is identical to commercial tar-based sealant',
          'It permanently waterproofs the driveway better than tar',
        ],
        correct_index: 1,
        explanation: 'Acrylic sealants are essentially paint that sits on top of the asphalt, prevents the permeability the asphalt needs, and cracks rather than protects.',
      },
      {
        question: 'How does our commercial oil/tar-based sealant work differently?',
        options: [
          'It sits on top as a glossy coat',
          'It soaks into the top layer of the asphalt, cures right into it, restores elasticity, and resists petroleum products',
          'It only works on concrete, not asphalt',
          'It washes away in the first rain',
        ],
        correct_index: 1,
        explanation: 'Our tar-based sealant soaks into and cures into the asphalt, restoring its natural elastic properties and creating a water-repellent barrier that petroleum products will not dissolve.',
      },
      {
        question: 'What is the best plain-language analogy for acrylic versus tar-based sealant?',
        options: [
          'Acrylic is like waxing a car; tar is like washing it',
          'Acrylic is like painting wood (stays on the surface); tar is like staining wood (soaks right in)',
          'They are the same — like two brands of the same paint',
          'Acrylic is like glue; tar is like tape',
        ],
        correct_index: 1,
        explanation: 'Acrylic is like painting wood — it stays on the surface. Tar-based sealant is like staining wood — it soaks right in and becomes part of the asphalt.',
      },
      {
        question: 'Why does unsealed asphalt crack over the winter?',
        options: [
          'The cold air alone shrinks the asphalt',
          'Water soaks into the porous asphalt, then freezes, expands, and forces the surface apart',
          'Salt trucks scrape the surface',
          'Asphalt is allergic to snow',
        ],
        correct_index: 1,
        explanation: 'Unsealed asphalt is porous, so water soaks in. When that water freezes it expands and forces the asphalt apart — that is how cracks form and grow.',
      },
      {
        question: 'On a rainy day, how can you turn the weather into a value argument?',
        options: [
          'Tell the customer to wait for a sunny day to even think about it',
          'Point to the water soaking into their bare driveway and explain the same thing happens all winter, except then it freezes and cracks the surface',
          'Explain that rain permanently ruins all driveways',
          'Avoid mentioning water entirely',
        ],
        correct_index: 1,
        explanation: 'Use the rain as a live demonstration: water soaking in now is the same water that freezes and cracks the driveway in winter. Sealing creates the barrier that keeps it out.',
      },
    ],
  },

  // =====================================================================
  // MODULE 13 — The Service, Step by Step
  // =====================================================================
  {
    module_id: 'module_13_service_steps',
    order_index: 13,
    is_active: true,
    level: 3,
    title: 'The Service, Step by Step',
    description:
      'Learn exactly what we do on every driveway, in order: weeds and vegetation, sweeping and power-blowing, taping, crack-filling, sealant application, and flagging. Knowing the process cold is what lets you build value at the door.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'The Process Is the Pitch',
        body: `Every step of the sealing process is also a selling point. When you can walk a homeowner through exactly what you do — in order, with confidence — they realise how much care goes into the job, and the value builds itself. Learn this sequence until you can recite it in your sleep. It is the backbone of the Building Value module later in this level.

There are six core steps to a CPS driveway sealing job: clear the weeds and vegetation, sweep and power-blow, tape the borders, fill the cracks (SealStar + only), apply the sealant, and flag the finished driveway.`,
      },
      {
        type: 'text',
        heading: 'Step 1: Weeds and Vegetation',
        body: `We use cutters and scrapers to remove all the weeds growing in the asphalt and along the edges where the asphalt meets the curbing. This matters more than it sounds — homeowners will literally buy a sealing job for the vegetation removal alone, because weeds growing through a driveway are an eyesore they have been staring at all season.

Always point out the weeds you will be clearing as you talk. It is one of the easiest pieces of visible value on the whole driveway.`,
      },
      {
        type: 'text',
        heading: 'Step 2: Sweep, Brush, and Power-Blow',
        body: `Before any product goes down, the driveway must be completely clean — sealant cannot bond to a dirty surface. We remove all debris with a broom and a power blower, and we use a wire brush for any caked-in dirt that will not sweep away.

Even a driveway that looks clean is not. Exhaust gas leaves a light, sometimes oily film, and that film — along with dirt and tree sap — has to come off so the sealant can properly grip the asphalt. Thorough cleaning is what separates a professional job from a cheap one.`,
      },
      {
        type: 'text',
        heading: 'Step 3: Painter\'s Tape',
        body: `We apply painter's tape along every surface that meets the asphalt — concrete aprons, stone borders, garage thresholds, walkway edges. This guarantees a clean, sharp line and protects the customer's property from stray sealant.

Taping is a visible signal of care. When a homeowner sees you taking the time to mask off their borders, it tells them this is a precise, professional job — not a slap-and-dash.`,
      },
      {
        type: 'text',
        heading: 'Step 4: Crack-Filling (SealStar + only)',
        body: `On a SealStar + job, we take care of the major cracks on the driveway — always point out the specific cracks you will be helping with as you walk the driveway. We use a rubberized crack filler that goes in as a liquid and cures into a solid rubber.

The reason this matters: that rubber keeps moisture out of the crack. Without it, water pools in the crack, freezes, expands, and tears the driveway apart from the inside. Filling the cracks first is what stops a small problem from becoming a new-driveway-sized problem.`,
      },
      {
        type: 'text',
        heading: 'Step 5: High-Quality Tar-Based Sealant',
        body: `Once the prep is done, we apply a good, even coat of high-quality commercial-grade tar-based sealant. As covered in the product module, this sealant soaks into the asphalt and helps prolong its life — unlike cheap acrylic products that sit on top like paint and crack.

Spray slowly and carefully for an even coat. A good coat is what the customer is paying for, and a rushed, patchy coat creates fix-ups that destroy your day.`,
      },
      {
        type: 'text',
        heading: 'Step 6: Flag the End — and Mind the Cure Time',
        body: `Finally, we run a line of flagging (caution) tape along the end of the driveway so the fresh seal is not disturbed while it dries. Drying time depends on the asphalt: roughly 24 hours for porous asphalt and up to 48 hours for smoother pavement.

Always set the customer's expectations on cure time before you leave — and confirm where they will park in the meantime. A customer who drives on a wet seal ruins the job and your reputation on the street, so this final step protects everyone.`,
      },
    ],
    quiz: [
      {
        question: 'What are the six core steps of a CPS driveway sealing job, in order?',
        options: [
          'Tape, seal, weeds, blow, crack-fill, flag',
          'Weeds/vegetation, sweep & power-blow, tape, crack-fill, seal, flag',
          'Seal, tape, flag, weeds, blow, crack-fill',
          'Crack-fill, seal, weeds, tape, flag, blow',
        ],
        correct_index: 1,
        explanation: 'The order is: clear weeds/vegetation, sweep and power-blow, tape the borders, fill cracks (SealStar +), apply sealant, then flag the end.',
      },
      {
        question: 'Why is weed and vegetation removal such an easy value point?',
        options: [
          'It is the most expensive part of the job',
          'Homeowners will buy a sealing job for the vegetation removal alone — weeds in a driveway are a visible eyesore',
          'Weeds make the sealant stick better',
          'It is not important and can be skipped',
        ],
        correct_index: 1,
        explanation: 'Weeds growing through the asphalt are an eyesore homeowners have stared at all season. Many will buy the whole job just to be rid of them.',
      },
      {
        question: 'Why must the driveway be thoroughly cleaned before sealing, even if it looks clean?',
        options: [
          'To make it look nice for photos',
          'Sealant cannot bond to a dirty surface — exhaust film, dirt, and tree sap must come off so the sealant grips properly',
          'Cleaning is only for the customer\'s benefit, not the seal',
          'It is not necessary if you use enough sealant',
        ],
        correct_index: 1,
        explanation: 'Even a clean-looking driveway has an oily exhaust film. That, plus dirt and sap, must be removed or the sealant will not properly adhere.',
      },
      {
        question: 'What is the purpose of applying painter\'s tape along the borders?',
        options: [
          'To decorate the driveway',
          'To guarantee a clean, sharp line and protect the customer\'s concrete and stone borders from stray sealant',
          'To hold the sealant in place while it dries',
          'To mark where the customer should park',
        ],
        correct_index: 1,
        explanation: 'Taping every surface that meets the asphalt ensures a clean line and protects the property — and it visibly signals a careful, professional job.',
      },
      {
        question: 'On which program do we fill the cracks?',
        options: ['Every job', 'SealStar only', 'SealStar + only', 'Only if the customer asks'],
        correct_index: 2,
        explanation: 'Crack-filling is the upgrade that defines SealStar + (SSP). SealStar (SS) is for driveways without cracks needing filling.',
      },
      {
        question: 'How does rubberized crack filler protect the driveway?',
        options: [
          'It makes the driveway look shinier',
          'It goes in as a liquid and cures into solid rubber, keeping moisture out so it cannot freeze, expand, and tear the asphalt apart',
          'It adds weight to hold the asphalt down',
          'It only fills cracks for cosmetic reasons',
        ],
        correct_index: 1,
        explanation: 'The filler cures into a rubber that blocks water from pooling in the crack, freezing, expanding, and destroying the driveway from the inside.',
      },
      {
        question: 'Why must the sealant be sprayed slowly and carefully?',
        options: [
          'To use up more product',
          'To put down a good, even coat — rushing creates patchy work and fix-ups that destroy your day',
          'Because the machine cannot go fast',
          'To impress the neighbours with how slow you are',
        ],
        correct_index: 1,
        explanation: 'A slow, careful spray gives the even coat the customer paid for. Rushing causes fix-ups and cleanups that wreck your productivity.',
      },
      {
        question: 'What is the final step of the job?',
        options: [
          'Collect payment and leave immediately',
          'Run a line of flagging tape along the end of the driveway so the fresh seal is not disturbed while drying',
          'Apply a second coat of acrylic',
          'Remove the painter\'s tape and pour water on the seal',
        ],
        correct_index: 1,
        explanation: 'We flag the end with caution tape to protect the fresh seal while it cures, and we set the customer\'s expectations on drying time.',
      },
      {
        question: 'What are the approximate cure times for the sealant?',
        options: [
          '1 hour for all driveways',
          'About 24 hours for porous asphalt and up to 48 hours for smoother pavement',
          'A full week regardless of surface',
          '10 minutes in the sun',
        ],
        correct_index: 1,
        explanation: 'Porous asphalt cures in roughly 24 hours; smoother pavement can take up to 48 hours. Always tell the customer before you leave.',
      },
      {
        question: 'Why is confirming parking and cure time with the customer so important?',
        options: [
          'It is just a courtesy with no real consequence',
          'A customer who drives on a wet seal ruins the job and your reputation on the street — so it protects everyone',
          'It lets you charge them extra',
          'It is required only on SealStar + jobs',
        ],
        correct_index: 1,
        explanation: 'Driving on an uncured seal destroys the work and your street reputation. Setting expectations on cure time and parking protects the job and your linking potential.',
      },
    ],
  },

  // =====================================================================
  // MODULE 14 — Sales Script: The Intro & Reason for the Deal
  // =====================================================================
  {
    module_id: 'module_14_intro_and_deal',
    order_index: 14,
    is_active: true,
    level: 3,
    title: 'Sales Script: The Intro & Reason for the Deal',
    description:
      'Master the opening of your pitch — the first impression — and the all-important move that gets the homeowner off the porch and onto the driveway, where sales actually happen.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'The Intro Is Your First Impression',
        body: `The introduction of your sales script is the first impression a customer has of you, so make it a good one. Treat every door like it is your first — open with enthusiasm, positivity, and a big smile.

The goal of the intro is to ask an open-ended question that starts a real conversation. For a driveway that has been sealed before, ask: "When was the last time you had your driveway sealed?" For a driveway that has never been sealed, ask: "When was the driveway laid?" The key is to ask these questions with genuine curiosity — not as a scripted line, but as someone who actually wants to know.`,
      },
      {
        type: 'text',
        heading: 'The Intro Structure: Intro — Neighbours — Deal — Question',
        body: `A great intro follows a simple four-part structure. Run it in order every time:

Intro: Ask them how they are, and introduce yourself and the company.

Neighbours: Tell them you are sealing driveways for the neighbours. Include a number of driveways if you can, and always mention their neighbours' names. Names are your credibility.

Deal: Talk about a deal and build urgency with words like "today" and "right now." Talking about a deal enough will build immediate interest.

Question: Ask the appropriate open-ended question — "When was the last time you had your driveway sealed?" or "When was the driveway laid?" — and ask it with genuine curiosity.

Intro, Neighbours, Deal, Question. Four beats, and you have opened a real conversation while establishing instant credibility.`,
      },
      {
        type: 'text',
        heading: 'The Reason for the Deal: Get Them on the Driveway',
        body: `The second part of your pitch — giving them a reason for the deal — is a crucial step, because its real purpose is to get the homeowner out of the doorway and onto the driveway. This is your first partial close, and it matters enormously: it is about 100 times easier to make a sale with the homeowner standing on their driveway than at their door. Once they are out there with you, looking at their own cracks and weeds, the sale half-closes itself.

Re-emphasise what you already said in the intro. Use phrases like "like I said" to repeat the neighbours you are taking care of and the great deal everyone is getting. Remember: sales is not about how many different things you can say — it is about who can say the same thing in different ways the longest.

Then give them a great, personalised reason for the deal. Options include a showcase driveway, a mid-afternoon special, a blanket street discount, or an end-of-night special. Use that reason either to pull a "how much?" out of them, or use your body language to physically draw them out onto the driveway.`,
      },
      {
        type: 'text',
        heading: 'Why "On the Driveway" Changes Everything',
        body: `It is worth understanding why this single move is so powerful. At the door, the homeowner is in a defensive posture — there is literally a threshold between you, and they are ready to say "no thanks" and close it. On the driveway, that barrier is gone. They are standing on the very thing you are talking about. You can point at the actual weeds, the actual cracks, the actual oil stains.

Everything in the intro and the reason-for-the-deal exists to earn that step onto the driveway. Get them out there, and you have already won the hardest part of the sale.`,
      },
    ],
    quiz: [
      {
        question: 'What is the goal of your sales introduction?',
        options: [
          'To quote a price as fast as possible',
          'To make a great first impression and ask an open-ended question that starts a real conversation',
          'To explain the entire sealing process in detail',
          'To get the customer to sign before they speak',
        ],
        correct_index: 1,
        explanation: 'The intro is your first impression. Open with enthusiasm and ask an open-ended question — with genuine curiosity — to start the conversation.',
      },
      {
        question: 'What open-ended question should you ask for a driveway that has been sealed before?',
        options: [
          '"Do you want this done today?"',
          '"When was the last time you had your driveway sealed?"',
          '"How much do you want to spend?"',
          '"Is the homeowner in?"',
        ],
        correct_index: 1,
        explanation: 'For a previously-sealed driveway, ask "When was the last time you had your driveway sealed?" For an unsealed one, ask "When was the driveway laid?"',
      },
      {
        question: 'What is the four-part structure of a great intro?',
        options: [
          'Price — Product — Push — Pen',
          'Intro — Neighbours — Deal — Question',
          'Knock — Wait — Pitch — Leave',
          'Smile — Silence — Stare — Sell',
        ],
        correct_index: 1,
        explanation: 'Intro (greet and introduce yourself), Neighbours (mention names and numbers), Deal (build urgency), Question (ask the open-ended question).',
      },
      {
        question: 'Why should you mention the neighbours by name in your intro?',
        options: [
          'To prove you have a good memory',
          'Names are your credibility — they shift you from a random salesperson to a trusted neighbourhood service provider',
          'It is legally required',
          'To fill time while you think of the price',
        ],
        correct_index: 1,
        explanation: 'Mentioning neighbours by name transfers their trust to you and establishes instant credibility at the door.',
      },
      {
        question: 'What is the real purpose of giving a "reason for the deal"?',
        options: [
          'To justify a higher price',
          'To get the homeowner off the porch and onto the driveway — your first partial close',
          'To delay quoting a price',
          'To end the conversation politely',
        ],
        correct_index: 1,
        explanation: 'The reason for the deal exists to pull the homeowner onto the driveway, where it is far easier to close.',
      },
      {
        question: 'How much easier is it to make a sale with the homeowner on the driveway versus at the door?',
        options: ['About twice as easy', 'About 5 times easier', 'About 100 times easier', 'There is no difference'],
        correct_index: 2,
        explanation: 'It is about 100 times easier to close with the homeowner on the driveway, where they can see their own cracks, weeds, and stains.',
      },
      {
        question: 'According to the CPS philosophy, what is sales really about?',
        options: [
          'Saying as many different things as possible',
          'Saying the same thing in different ways, longer than the customer can resist',
          'Memorising a single perfect line',
          'Talking faster than the customer can think',
        ],
        correct_index: 1,
        explanation: 'Sales is not about variety — it is about who can repeat the same core message in different ways the longest. Use "like I said" to reinforce.',
      },
      {
        question: 'Which of these is a valid "reason for the deal" you can offer?',
        options: [
          'A showcase driveway, mid-afternoon special, blanket street discount, or end-of-night special',
          'A free driveway',
          'A lifetime guarantee with no conditions',
          'A refund if they do not like it',
        ],
        correct_index: 0,
        explanation: 'Personalised reasons for the deal include a showcase driveway, a mid-afternoon special, a blanket street discount, or an end-of-night special.',
      },
      {
        question: 'Once the homeowner is on the driveway, why does the sale get so much easier?',
        options: [
          'The doorway barrier is gone and you can point at their actual weeds, cracks, and stains',
          'They are legally committed once they step outside',
          'They cannot hear your price out there',
          'It does not get easier — the door is better',
        ],
        correct_index: 0,
        explanation: 'On the driveway the defensive doorway barrier disappears and you can reference the real, visible problems on their own property.',
      },
      {
        question: 'What two tools can you use to pull a homeowner onto the driveway?',
        options: [
          'A loud voice and a long pitch',
          'The reason for the deal (to prompt a "how much?") and your body language to draw them out',
          'A discount and a deadline only',
          'Their neighbour\'s phone number',
        ],
        correct_index: 1,
        explanation: 'Use the reason for the deal to provoke a "how much?", and use your body language to physically draw them out onto the driveway.',
      },
    ],
  },

  // =====================================================================
  // MODULE 15 — Sales Script: Building Value
  // =====================================================================
  {
    module_id: 'module_15_building_value',
    order_index: 15,
    is_active: true,
    level: 3,
    title: 'Sales Script: Building Value',
    description:
      'Once the homeowner asks "how much?" and steps onto the driveway, it is time to forget the price and show them the true value of the service. Learn to turn every step of the job into a reason to buy.',
    lesson_content: '',
    lesson_sections: [
      {
        type: 'text',
        heading: 'Forget the Price — Show the Value',
        body: `Now that the homeowner has asked "how much?" and been brought out onto the driveway, here is the counter-intuitive move: forget about the price for a moment. This is the time to show the homeowner the true value behind getting their driveway done with you.

Talk about the service step by step. As you walk them through what you actually do, they realise how much you care about your workmanship on their property. Value is not a number you say — it is a picture you paint, one step at a time, standing on their driveway pointing at the real thing.

The golden rule: when value exceeds price, a sale occurs. Your entire job in this part of the pitch is to stack up so much visible value that the price feels small by comparison.`,
      },
      {
        type: 'text',
        heading: 'Turn Each Step Into a Selling Point',
        body: `Walk the driveway and narrate the job, pointing at the real thing as you go. Each step is a reason to buy:

Weeds and vegetation: "We use cutters and scrapers to pull out all these weeds in the asphalt and along the curb edges." Point at the actual weeds — homeowners will buy a sealing for vegetation removal alone.

Sweep, brush, and power-blow: "We remove all the debris with a broom and blower, and we use a wire brush on the caked-in dirt so the surface is completely clean for the product."

Painter's tape: "We tape along every surface that meets the asphalt — your concrete, your stone borders — so you get a perfectly clean line."

Crack-filling (SealStar +): "We take care of the major cracks — see these ones here? — with a rubberized filler that goes in liquid and turns to solid rubber, keeping the moisture out so it cannot freeze and split the driveway."

High-quality tar-based sealant: "Then we lay down a good coat of high-quality tar-based sealant. Unlike the acrylic stuff that just sits on top like paint and cracks, ours soaks in and actually helps prolong your driveway."

Caution tape: "Finally we flag off the end so nobody drives on it while it cures — about 24 hours for your surface."`,
      },
      {
        type: 'text',
        heading: 'Point Out the Cracks',
        body: `Always remember to point out the specific cracks you will be helping with. This is one of the most powerful things you can do on the driveway, because it makes the problem concrete and personal. A homeowner can ignore "your driveway has cracks" as a sales line — they cannot ignore you pointing at the exact crack running across their own asphalt.

The same goes for weeds, oil stains, and rough patches. The more real, visible problems you can point at, the more the value stacks up — and the more obvious it becomes that they need this done.`,
      },
      {
        type: 'text',
        heading: 'When Value Exceeds Price',
        body: `Keep this principle at the front of your mind for the rest of this level: when value exceeds price, a sale occurs.

If you have done your job building value, you will be able to deliver the price confidently and move to the close. But if it is hard for the customer to see the value — if they are hesitating or balking at the number — the answer is not to immediately discount. The answer is to loop back and build more value. Point out another crack. Re-explain the tar-versus-acrylic difference. Remind them what happens to unsealed asphalt over the winter.

Discounting is a tool for later and a last resort. Building value is the main event.`,
      },
    ],
    quiz: [
      {
        question: 'Once the homeowner asks "how much?" and is on the driveway, what should you do first?',
        options: [
          'Immediately give them the lowest possible price',
          'Forget about the price for a moment and show them the true value by walking through the service step by step',
          'Ask them to sign before explaining anything',
          'Tell them you will email a quote later',
        ],
        correct_index: 1,
        explanation: 'Before talking price, build value by walking through the service step by step so they see how much care goes into the job.',
      },
      {
        question: 'What is the golden rule of building value?',
        options: [
          'The lowest price always wins',
          'When value exceeds price, a sale occurs',
          'Never mention the service details',
          'Always discount before quoting',
        ],
        correct_index: 1,
        explanation: 'When the value you have demonstrated exceeds the price, the sale happens naturally.',
      },
      {
        question: 'How do you "build value" most effectively on a driveway?',
        options: [
          'Read the price list aloud',
          'Walk the driveway narrating each step of the job and pointing at the real weeds, cracks, and stains',
          'Talk only about the warranty',
          'Stay at the door and describe it in general terms',
        ],
        correct_index: 1,
        explanation: 'Value is a picture you paint step by step, standing on the driveway and pointing at the actual problems you will fix.',
      },
      {
        question: 'Why is pointing out specific cracks so powerful?',
        options: [
          'It scares the customer into buying',
          'It makes the problem concrete and personal — they cannot ignore a crack you are pointing at on their own driveway',
          'It is required by CPS policy',
          'It has no real effect',
        ],
        correct_index: 1,
        explanation: 'A general "your driveway has cracks" is easy to dismiss; pointing at the exact crack on their asphalt makes it real and personal.',
      },
      {
        question: 'A homeowner will often buy a sealing job for which single step alone?',
        options: ['The flagging tape', 'The vegetation/weed removal', 'The painter\'s tape', 'The cure time'],
        correct_index: 1,
        explanation: 'Weeds growing through the driveway are a visible eyesore — many homeowners will buy the job for the vegetation removal alone.',
      },
      {
        question: 'When explaining the sealant, how should you contrast it with cheap products?',
        options: [
          'Say all sealants are basically the same',
          'Explain that acrylic sits on top like paint and cracks, while our tar-based sealant soaks in and helps prolong the driveway',
          'Avoid mentioning other products',
          'Tell them to buy acrylic themselves to save money',
        ],
        correct_index: 1,
        explanation: 'Contrast the surface-sitting acrylic "paint" with our tar-based sealant that soaks in and protects from within.',
      },
      {
        question: 'If the customer is struggling to see the value and is balking at the price, what should you do?',
        options: [
          'Immediately cut the price as low as you can',
          'Loop back and build more value — point out another crack, re-explain the product, remind them about winter damage',
          'End the pitch and walk away',
          'Tell them the price is final and wait silently',
        ],
        correct_index: 1,
        explanation: 'When value is not landing, build more value rather than discounting. Discounting is a last resort, not the first move.',
      },
      {
        question: 'How should you describe the crack-filling step while building value?',
        options: [
          '"We pour some tar in the cracks, that\'s it."',
          '"We fill these cracks with a rubberized filler that goes in liquid and turns to solid rubber, keeping moisture out so it cannot freeze and split the driveway."',
          '"Cracks aren\'t really a problem, don\'t worry about them."',
          '"You should fill those yourself with hardware-store filler."',
        ],
        correct_index: 1,
        explanation: 'Explain that the rubberized filler cures into solid rubber and blocks the moisture that freezes, expands, and splits the asphalt.',
      },
      {
        question: 'What is the relationship between this module and the Pricing & Closing module?',
        options: [
          'They are the same thing',
          'Building Value comes first (make the price feel small); Pricing & Closing is how you then deliver the number and structure any discount',
          'Pricing should always come before value',
          'They contradict each other',
        ],
        correct_index: 1,
        explanation: 'You build value first so the price feels small, then deliver the price and structure the close — the two modules work in sequence.',
      },
      {
        question: 'What is the main message a homeowner takes away from a good value walkthrough?',
        options: [
          'That you are the cheapest option around',
          'That you genuinely care about your workmanship on their property',
          'That the job is quick and they barely need it',
          'That they should shop around first',
        ],
        correct_index: 1,
        explanation: 'Walking through the service step by step shows the homeowner how much care goes into the job — which is what justifies the price.',
      },
    ],
  },
];
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
