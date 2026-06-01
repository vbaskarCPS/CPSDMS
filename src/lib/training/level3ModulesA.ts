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
