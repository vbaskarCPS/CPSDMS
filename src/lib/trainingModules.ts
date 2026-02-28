// src/lib/trainingModules.ts
// Hardcoded training module content - single source of truth
// No database needed for content. Add modules here to make them available globally.

export type Region = 'West' | 'Central' | 'East';

// --- Supabase storage base URL for training images ---
const STORAGE_BASE =
  'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/training-images';

// --- Quiz ---
export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

// --- Structured Lesson Sections (new — used by Module 2 & 3) ---

export interface TextSection {
  type: 'text';
  heading?: string;
  body: string; // paragraphs separated by \n\n
}

export interface ImageSection {
  type: 'image';
  heading?: string;
  body: string;
  image: {
    src: string;
    alt: string;
    position?: 'top' | 'inline-right' | 'inline-left' | 'bottom'; // default: 'top'
    maxHeight?: number; // optional max height in px
  };
}

export interface StoryboardFrame {
  label: string;          // e.g. "Step 1: Run All Day"
  caption: string;        // explanation text below the map
  overlays?: {            // icons/labels placed on the map
    type: 'icon' | 'flag' | 'label';
    src?: string;         // for icon type
    text?: string;        // for label type
    x: number;            // % from left
    y: number;            // % from top
    color?: string;       // for labels
  }[];
}

export interface StoryboardSection {
  type: 'storyboard';
  heading: string;
  description?: string;
  baseImage: {
    src: string;
    alt: string;
  };
  frames: StoryboardFrame[];
}

export type LessonSection = TextSection | ImageSection | StoryboardSection;

// --- Training Module ---
export interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  lesson_content: string;        // Plain text fallback (modules 1, 4, 5)
  lesson_sections?: LessonSection[]; // Structured sections (modules 2, 3)
  quiz: QuizQuestion[];
  region?: Region;
  order_index: number;
  is_active: boolean;
}

export const TRAINING_MODULES: TrainingModule[] = [
  // =====================================================================
  // MODULE 1 — The Basic Rookie Mindset (UNCHANGED)
  // =====================================================================
  {
    module_id: 'module_01_mindset',
    order_index: 1,
    is_active: true,
    title: 'The Basic Rookie Mindset: Your Blueprint for Success',
    description:
      'Discover the winning attitude and mental toughness required to thrive in door-to-door lawn care sales. You\'ll learn how to handle rejection, prepare for your day, and treat the season like a professional sport.',
    lesson_content: `Welcome to the team! You are entering a training program to join the Professional Aerating League. Working door-to-door property maintenance is a physically and mentally demanding job, but it is also extremely rewarding. As a rookie, the most important tool you have isn't the aerator or the fertilizer—it's your mindset. You will face rejection, long hours on your feet, and varying Canadian weather conditions. A strong, positive attitude is what separates the top earners from the rest.

Your success depends on maintaining a '100% positivity' rule while on the route. It's natural to feel frustrated when a homeowner says no or if nobody is answering the door. However, dwelling on negativity will only ruin your focus and cost you money. When you encounter a tough customer, shake it off quickly and move to the next door. Remember, every 'no' brings you closer to a 'yes,' and you only need a fraction of a neighbourhood to have an incredibly profitable day.

Consistency and endurance are key to your earnings. The door-to-door season is a marathon, not a sprint. To stay sharp and perform at your best, you need to manage your personal time well. Sleep management is critical—that means getting plenty of rest after work and saving the partying for the off-season. You need to set goals and stay extremely competitive every day, showing up as many days as possible without giving up.

Daily preparation is just as important as your pitch. The doors open at 8:10 AM, and the earlier you arrive, the better. Always bring a knapsack packed with enough food and drinks to last the entire day. Dress for the Canadian weather forecast—if rain is predicted, be prepared. Bring sunscreen for sunny days and extra socks for wet days. Mandatory footwear includes high-quality shoes or steel-toed work boots; old sneakers or sandals are strictly prohibited.

Think of your first week like learning to play hockey: you need to learn how to 'skate' before you can 'score.' Show up with a winning attitude, a ready mind to learn, and be coachable. Trust the company systems, lean on your managers, and push through the initial learning curve. By mastering this rookie mindset, you are setting yourself up for massive commission cheques.`,
    quiz: [
      {
        question: 'What is considered mandatory footwear for the job?',
        options: [
          'Running shoes',
          'High-quality shoes or steel-toed work boots',
          'Sandals',
          'Rubber rain boots only',
        ],
        correct_index: 1,
        explanation:
          'Proper, high-quality footwear or steel-toed boots are mandatory to prevent injury and handle the physical demands of the job.',
      },
      {
        question: 'How should you handle rejection at the door?',
        options: [
          'Argue with the homeowner to change their mind',
          'Take a 15-minute break to recover',
          'Shake it off quickly and move to the next door',
          'Call your manager to complain',
        ],
        correct_index: 2,
        explanation:
          'Dwelling on rejection ruins your focus; moving on quickly keeps your momentum high.',
      },
      {
        question: 'What does "sleep management" mean in the context of this job?',
        options: [
          'Sleeping in the work truck between lawns',
          'Getting plenty of rest after work and avoiding partying during the season',
          'Working overnight shifts only',
          'Taking daily afternoon naps on the route',
        ],
        correct_index: 1,
        explanation:
          'The job is physically demanding, so prioritizing sleep over late-night activities is crucial for endurance.',
      },
      {
        question: 'What should always be packed in your daily knapsack?',
        options: [
          'Food, drinks, sunscreen, and extra socks',
          'A portable video game console',
          'Extra marketing flyers only',
          'A spare uniform',
        ],
        correct_index: 0,
        explanation:
          'Proper nutrition, hydration, and weather protection are vital for maintaining energy throughout a long physical day.',
      },
      {
        question: 'What does the "learning to skate before you score" analogy mean?',
        options: [
          'You must join the company hockey team',
          'You need to master the basics of the job before expecting to break sales records',
          'You should wear rollerblades on the route',
          'You need to rush through the training program',
        ],
        correct_index: 1,
        explanation:
          'Just like in sports, you must master fundamental skills before achieving high-level success.',
      },
    ],
  },

  // =====================================================================
  // MODULE 2 — 5 Steps to High Steps (REWRITTEN — structured sections + 10 Qs)
  // =====================================================================
  {
    module_id: 'module_02_high_steps',
    order_index: 2,
    is_active: true,
    title: '5 Steps to High Steps: Maximizing Your Daily Sales Efficiency',
    description:
      'Learn the vital speed, efficiency, and safety techniques that will allow you to visit up to five times more homes every day. Master these rules to skyrocket your daily step count.',

    // Plain-text fallback (kept for safety — not rendered when lesson_sections exists)
    lesson_content: `In our business, 'steps' mean sales. The more lawns you complete, the higher your daily payout will be. The '5 Steps to High Steps' system is designed to maximize the number of doors you knock on and the lawns you complete, without even needing advanced sales skills.`,

    // --- NEW structured lesson ---
    lesson_sections: [
      {
        type: 'text',
        body: `In our business, 'steps' mean sales. The more lawns you complete, the higher your daily payout will be. The '5 Steps to High Steps' system is designed to maximize the number of doors you knock on and the lawns you complete — without even needing advanced sales skills.

Here's what makes this system so powerful: you can't always count on a lot of people being home, or on the receptivity of homeowners, or even on your own scripting ability. What you CAN count on is 5 Steps to High Steps. It's preached every morning meeting for a reason. If this system is implemented, even a worker with rough scripts and little experience will still get sales — because they get to enough doors.

None of these 5 steps require sales skills, but together they will allow you to visit up to 5 times more homes in a single day. By simply moving faster and working smarter, you can dramatically increase your earning potential.`,
      },
      {
        type: 'image',
        heading: 'Step 1: Run All Day',
        body: `Literally run all day. This is the simplest and most impactful step. Instead of walking casually between houses, jog lightly or run. The numbers don't lie: running between doors gets you to 3 times more houses than walking over the course of the day.

Think about it — if walking gets you to 30 doors in a day, running gets you to 90. That's 60 extra chances to make a sale, just by picking up your pace. Every top CPS star treats their route like a fitness challenge. You're not strolling through a park — you're an athlete competing for the highest step count of the day.

Leave your machine on the side of the road at the edge of a driveway and canvass 2 to 3 homes up one side and then 2 to 3 homes down the other before moving the machine.`,
        image: {
          src: `${STORAGE_BASE}/red-running-figure.png`,
          alt: 'Red running figure — run all day',
          position: 'inline-right',
          maxHeight: 180,
        },
      },
      {
        type: 'text',
        heading: 'Step 2: Ring \'n\' Listen — The 10-Second Rule',
        body: `When you knock on the door or ring the bell, listen carefully for the sound of someone inside the house. Never wait more than 10 seconds after ringing unless you hear someone approaching the door.

This might seem like a small thing, but the math is massive. Waiting an extra 30 to 60 seconds at every empty house adds up fast. Over the course of a full day, those wasted seconds become at least one full extra hour — an hour you could have spent finding your next sale.

The psychology behind this is about momentum. Every second you stand idle at an empty door chips away at your energy and focus. Top stars keep their feet moving and their rhythm unbroken. Ring, listen, 10 seconds — move.`,
      },
      {
        type: 'text',
        heading: 'Step 3: Across the Lawn — The Horseshoe Method',
        body: `Instead of walking down the driveway, along the sidewalk, and back up the next driveway, cut straight across the lawn to the neighbour's front door. This is called the 'Horseshoe Method' because you canvass 2–3 homes up one side, cross, and come back down the other side in a horseshoe pattern — all without going back to the street.

This saves massive amounts of time. Walking the sidewalk route between two neighbouring doors might take 30–45 seconds. Cutting across the lawn takes 5–10 seconds. Multiply that by every house on the street, and the Horseshoe Method gives you a 3-to-1 time advantage over using the street.

It also keeps you visible to homeowners. When people see you confidently moving from lawn to lawn, it creates the impression that you belong there and that business is happening all around them.`,
      },
      {
        type: 'image',
        heading: 'Step 4: No Long-Term Relationships',
        body: `You are a lawn care professional, not a conversationalist. In professional sales, it can take 4 to 6 meetings with a prospect before you close a deal — sometimes stretching over weeks or months. At CPS, an aeration sales call should last 60 seconds to 5 minutes. Maximum. Time is money.

It's very easy during the day to get caught up in a long conversation about school, your future, or a customer's family. As much as that's a nice thing to do, it will hurt you financially and will often break any rhythm or momentum you've created. Spending an extra 15 minutes chatting with a friendly customer means you just missed out on your next sale — potentially $60–$100 in commission.

Be very polite, but do your best to keep all conversation beyond the sale brief. The customer understands that you have to get going. They don't expect you to hang around — they respect the hustle.`,
        image: {
          src: `${STORAGE_BASE}/no-long-term-relationships.jpg`,
          alt: 'No long term relationships — keep it brief',
          position: 'top',
          maxHeight: 200,
        },
      },
      {
        type: 'image',
        heading: 'Step 5: Aerate Efficiently',
        body: `When you get the sale, don't cuddle with the lawn. You're there to work. Figure out the most efficient manner to get the job done well and get to it. Most normal-sized single-family homes should not take more than 20 minutes to aerate correctly.

Put yourself on a clock and track your productivity. Here's the math that will change how you think about efficiency:

Aerating 10 lawns at 30 minutes each = 5 hours of work.
Aerating 10 lawns at 15 minutes each = 2.5 hours of work.
That's 2.5 extra hours freed up to sell and aerate 5 more lawns.

Use smooth curves instead of sharp turns. Develop a consistent pattern — start at one edge, work in smooth loops to cover the entire property. The more lawns you aerate, the more natural and fast your technique will become. Speed comes from repetition, not from rushing.`,
        image: {
          src: `${STORAGE_BASE}/aeration-pattern.png`,
          alt: 'Efficient aeration pattern with smooth curves',
          position: 'top',
          maxHeight: 220,
        },
      },
      {
        type: 'storyboard',
        heading: '5 Steps in Action',
        description:
          'Walk through a real neighbourhood and see how each step plays out on the route. Use the arrows to step through the sequence.',
        baseImage: {
          src: `${STORAGE_BASE}/5steps-aerial-map.png`,
          alt: 'Aerial view of Kathleen Circle neighbourhood',
        },
        frames: [
          {
            label: 'Drop-Off Point',
            caption:
              'You arrive at the corner of Kathleen Circle and Shauna Drive. Your machine is unloaded and your day begins. Check your gear: flags, folder, pouch, pen, knapsack.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/cps-van.png`, x: 78, y: 88 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 72, y: 85 },
            ],
          },
          {
            label: 'Step 1: Run All Day',
            caption:
              'Run or jog lightly between houses — 3x more doors than walking. Leave your machine at the edge of a driveway and canvass 2–3 homes in each direction.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 72, y: 85 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 55, y: 70 },
              { type: 'label', text: 'Run!', x: 55, y: 63, color: '#ef4444' },
            ],
          },
          {
            label: 'Step 2: The 10-Second Rule',
            caption:
              'Ring the doorbell, listen for 10 seconds max. No footsteps? Move immediately. This saves 20–60 seconds per door = at least 1 extra hour per day.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 72, y: 85 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 42, y: 55 },
              { type: 'label', text: '10 sec', x: 38, y: 48, color: '#f59e0b' },
              { type: 'label', text: '10 sec', x: 48, y: 62, color: '#f59e0b' },
              { type: 'label', text: '10 sec', x: 35, y: 68, color: '#f59e0b' },
            ],
          },
          {
            label: 'Step 3: Horseshoe Method',
            caption:
              'Cut straight across lawns to the neighbour\'s door instead of using the sidewalk. Canvass up one side, cross, and come back down — a horseshoe pattern.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 72, y: 85 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 30, y: 42 },
              { type: 'label', text: 'Cut across lawn', x: 25, y: 35, color: '#22c55e' },
            ],
          },
          {
            label: 'First Sale!',
            caption:
              'You\'ve got your first sale! Flag the lawn at the street beside the driveway. Start aerating the front lawn. This flag is now marketing for the whole street.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 50 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 40, y: 55 },
              { type: 'label', text: '1st Sale', x: 35, y: 43, color: '#22c55e' },
            ],
          },
          {
            label: 'Step 4: No Long-Term Relationships',
            caption:
              'Quick, friendly, and done. Your sales conversation is 60 seconds to 5 minutes max. Don\'t get caught chatting — every extra minute is a missed sale next door.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 50 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 40, y: 55 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 45, y: 48 },
              { type: 'label', text: '5 min max!', x: 50, y: 42, color: '#f59e0b' },
            ],
          },
          {
            label: 'Step 5: Aerate Efficiently',
            caption:
              'Smooth curves, 15–20 minutes per lawn. Don\'t cuddle the lawn. 10 lawns at 15 min = 2.5 hrs saved vs 30 min each. That\'s 5 more lawns you can sell and complete.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 40, y: 55 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 36, y: 52 },
              { type: 'label', text: '15-20 min', x: 30, y: 47, color: '#3b82f6' },
            ],
          },
          {
            label: 'Repeat All Day',
            caption:
              'Aerate efficiently, then use the Horseshoe to find your next sale. Flag it, sell it, aerate it. Repeat this cycle all day long and watch your steps climb.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 40, y: 55 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 30, y: 40 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 28, y: 43 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 22, y: 35 },
              { type: 'label', text: 'Keep going!', x: 18, y: 28, color: '#22c55e' },
            ],
          },
        ],
      },
      {
        type: 'text',
        heading: 'Safety & Equipment Rules',
        body: `Beyond speed, you must operate safely and responsibly to protect your earnings. These rules are non-negotiable:

Keep your eyes on your machine. Your aerator is your livelihood — never leave it unattended on the street or sidewalk. When you park it to knock on doors, always keep it within your line of sight.

18-inch rule. When aerating, you must stay exactly 18 inches away from all fixed objects — sprinklers, lights, walkway edges, garden borders. The rule is simple: if you break it, you pay for it. Sprinkler head repairs can cost $50–$150, which comes straight out of your commission.

Never leave your route. Do not leave your assigned route to meet up with a co-worker. Stay in your zone and maximize your time. Every minute spent off your route is money lost.

Complete the entire lawn. Always confirm the property boundaries with the homeowner before you start. Leaving patches undone creates unhappy customers and hurts the company's reputation on the street — which directly hurts your linking potential.

Charge HST on every lawn. As a legitimate Canadian business, HST must be collected on every transaction. Do not offer 'under the table' deals. Accurately complete the receipt and log sheet for every sale.`,
      },
      {
        type: 'text',
        heading: 'Start & End of Day Efficiency',
        body: `Efficiency doesn't start when you hit your first door — it starts at the shop. All staff must help with loading and unloading the machines. Teamwork during drop-off and pick-up makes the process quick and smooth for everyone. The faster the load-out, the sooner you're on your route earning money.

Before you leave the shop, make sure you're set: 10 flags, 10 poles, your folder with route map and log sheet, pouch, pen, and your knapsack with food and drinks for the day.

On completed lawns, always place a company flag at the street beside the driveway. These flags are your marketing — every neighbour who drives by sees proof that business is happening on their street. At the end of the day, return any extra flags to the stock bins before leaving.

If cheques are used as payment, ensure they are made payable exactly to 'Canadian Property Stars.'`,
      },
    ],

    quiz: [
      {
        question: 'What is the "Horseshoe Method"?',
        options: [
          'A game played during lunch breaks',
          'Cutting directly across the lawn to the neighbour\'s door instead of using the sidewalk',
          'Walking in a wide circle around the entire property',
          'A special technique for aerating corner lots',
        ],
        correct_index: 1,
        explanation:
          'Cutting across the lawn saves massive time at every house. The horseshoe pattern means you canvass 2–3 homes up one side and back down the other — all without returning to the street.',
      },
      {
        question:
          'How far must you keep the aerator from fixed objects like sprinklers and walkway edges?',
        options: ['6 inches', '12 inches', '18 inches', '3 feet'],
        correct_index: 2,
        explanation:
          '18 inches is the mandatory distance. If you damage a sprinkler head, light, or walkway edge, you are personally responsible for the repair cost.',
      },
      {
        question: 'What is the "10-Second Rule"?',
        options: [
          'You must deliver your pitch in under 10 seconds',
          'After ringing the doorbell, wait a maximum of 10 seconds before moving on if you don\'t hear anyone',
          'Run to the next house in under 10 seconds',
          'You have 10 seconds to start the aerator after arriving at a property',
        ],
        correct_index: 1,
        explanation:
          'Waiting longer at empty houses wastes 20–60 seconds per door, which adds up to at least one full hour lost per day. Ring, listen, move.',
      },
      {
        question:
          'Why is "Run All Day" (Step 1) considered the most impactful single step?',
        options: [
          'It helps you stay warm in cold weather',
          'It gives you a 3-to-1 door advantage over walking, tripling your sales opportunities',
          'It impresses homeowners when they see you running',
          'It counts as your daily exercise so you don\'t need to work out after',
        ],
        correct_index: 1,
        explanation:
          'Running between doors gets you to roughly 3 times more houses than walking. More doors = more chances to sell, which is the foundation of the entire system.',
      },
      {
        question:
          'According to the efficiency math, if you aerate 10 lawns at 15 minutes each instead of 30 minutes each, how much extra time do you free up?',
        options: ['30 minutes', '1 hour', '2.5 hours', '5 hours'],
        correct_index: 2,
        explanation:
          '10 lawns × 30 min = 5 hours. 10 lawns × 15 min = 2.5 hours. That\'s 2.5 extra hours you can use to sell and aerate roughly 5 more lawns — potentially $300+ in additional revenue.',
      },
      {
        question:
          'What must you do to clearly mark a completed job for the neighbourhood to see?',
        options: [
          'Spray paint the curb',
          'Place a company flag in the lawn at the street beside the driveway',
          'Leave a business card taped to the mailbox',
          'Take a photo and text it to your manager',
        ],
        correct_index: 1,
        explanation:
          'Flags serve as both proof of your work and powerful marketing. Every neighbour who drives by sees that business is happening on their street, which feeds directly into the linking system.',
      },
      {
        question:
          'What is the maximum time an aeration sales conversation should last?',
        options: [
          '30 seconds',
          '5 minutes',
          '15 minutes',
          'As long as the customer wants to talk',
        ],
        correct_index: 1,
        explanation:
          'An aeration sales call should last 60 seconds to 5 minutes maximum. Spending unnecessary time in conversation breaks your momentum and costs you money. Be polite but keep it brief.',
      },
      {
        question:
          'What is the policy regarding your equipment when knocking on doors?',
        options: [
          'Leave it running on the sidewalk so customers know you\'re working',
          'Keep your eyes on your machine at all times and never leave it unattended',
          'Ask a neighbour to watch it while you canvass',
          'Lock it to a fence post',
        ],
        correct_index: 1,
        explanation:
          'Aerators are expensive and essential to your earnings. They must always be within your line of sight, never left unattended.',
      },
      {
        question:
          'Why does the 5 Steps to High Steps system work even for workers with weak sales scripts?',
        options: [
          'Because the system includes a cheat sheet with scripts',
          'Because getting to enough doors means you\'ll find buyers regardless of your pitch quality',
          'Because managers close the sales for you',
          'Because the steps teach advanced negotiation techniques',
        ],
        correct_index: 1,
        explanation:
          'The entire philosophy is based on volume. You can\'t control how receptive homeowners are or how polished your pitch is — but you CAN control how many doors you reach. More doors always means more sales.',
      },
      {
        question: 'What should you NEVER do while on your assigned route?',
        options: [
          'Take a short water break on a customer\'s porch',
          'Leave your route to meet up with a co-worker',
          'Check your route map between streets',
          'Ask a customer for their neighbour\'s name',
        ],
        correct_index: 1,
        explanation:
          'Leaving your route wastes time and takes you away from your earning zone. Every minute off your route is money lost. Stay in your zone and maximize your time.',
      },
    ],
  },

  // =====================================================================
  // MODULE 3 — Basic Linking Strategies (REWRITTEN — structured sections + 10 Qs)
  // =====================================================================
  {
    module_id: 'module_03_linking',
    order_index: 3,
    is_active: true,
    title: 'Basic Linking Strategies: The Power of the Neighbourhood',
    description:
      'Master the "passing" game of sales. Learn how to use linking, the "Mushroom with a Name" strategy, and situational awareness to dominate an entire street.',

    // Plain-text fallback
    lesson_content: `Selling 'cold' at the door can be tough because the homeowner doesn't know you or your company. But what if you told them that you're already taking care of their neighbour's lawn? This is called 'linking.'`,

    // --- NEW structured lesson ---
    lesson_sections: [
      {
        type: 'text',
        body: `Selling 'cold' at the door is tough. The homeowner doesn't know you, doesn't know the company, and wasn't thinking about lawn care when you rang the bell. You're interrupting their day and asking them to buy something on the spot. But what if you told them you're already taking care of their neighbour's lawn? Everything changes.

This is called 'linking' — the act of expanding outward from a single initial customer into multiple customers, all within view of one another on the same or connected streets. It has been proven year after year that closing a customer on a link is at least 5 times easier than closing a cold customer.

Here's what separates average workers from top stars. Average workers step about 6–10 lawns per day: 5–7 from cold sales, only 1–3 from linking. Top workers step 20 lawns per day: only 3–5 from cold sales, and 15–17 from linking.

Do you see the difference? Top earners don't have magical sales skills — they master linking. The bulk of their income comes from the credibility and momentum of their links, not from cold-knocking 60 houses hoping for a yes.

Make it your goal every day that more than 50% of your lawns come as direct links from other lawns. The higher you raise this percentage, the fewer dry spells you'll have and the higher your step count will climb.`,
      },
      {
        type: 'text',
        heading: 'The Psychology Behind Linking',
        body: `Homeowners inherently want to take care of their properties, but they typically procrastinate when it comes to acting on their intentions. When you show up cold at a door, you're asking someone to make an immediate decision about a service they weren't thinking about, from a person they've never met, representing a company they may not know. That's a lot of barriers.

Linking removes almost all of those barriers at once. Here are some of the actual thoughts that go through homeowners' minds when they see you working on their street:

1. "Well, if Tommy next door is doing it, then we probably need it too."
2. "If Tommy paid $60, then I should do the same."
3. "If Tommy is helping this kid at the door, then so should I."
4. "If everyone on the street is getting it done, I don't want to be left out."
5. "If his lawn is going to be green, I want mine to be green too."
6. "If he paid for it, I don't want to look cheap by passing on it."
7. "If they're all doing it, then obviously the service and value must be good."
8. "If they're all doing it, then obviously this is a great company."
9. "If this kid knows all my neighbours' names, what have I been missing out on?"
10. "Wow, I'm glad he caught me at home — I would have missed out on the street sale."

These aren't random. They represent powerful psychological forces: social proof (everyone else is doing it), fear of missing out (I don't want to be left out), trust transfer (if my neighbour trusts this person, I can too), and reciprocity (my neighbours helped this worker, so should I).

When you knock on a door cold, you have zero credibility. When you knock on a door with 5 names and 5 flags on the street, you have overwhelming credibility. That's the power of linking.`,
      },
      {
        type: 'text',
        heading: 'Technique 1: Mushroom with a Name',
        body: `When you close your first sale of the day or on a new street, don't just start aerating. Before you fire up the machine, ask the customer for their first name and the names of their surrounding neighbours. Mention that you want all the lawns to be equally green and that you'd appreciate any help getting as many people as possible involved in the same great street deal.

Here's the step-by-step process:

1. Close your first sale. Get the customer's name (let's say it's John).

2. Get neighbour names. Ask John: "Do you know the names of your neighbours on either side or across the street?" Even one name is gold.

3. Flag the lawn near the driveway so it's visible from the street.

4. Aerate half the front lawn — specifically the section that connects to the property next door. This is strategic: you're creating a visual chain.

5. Approach the neighbour. Turn down your throttle (so it's not too loud), go to the connecting house, and say something like: "Hi! I'm just next door doing a core aeration for John, and since I'm already here, I can give you the same street deal."

6. Address them by name if John gave it to you. This dramatically lowers their guard.

7. Close, get MORE names, flag, and continue. Follow this process 2–3 houses to one side, then cross the street and work back the other way.

This is called 'mushrooming' because your sales spread outward from a single point — like a mushroom growing from a single spore. Each new sale gives you more names and more credibility for the next door.

The psychology: You're no longer a stranger. You're "John's guy." The neighbour can literally look over and see the flag on John's lawn and hear your machine. All the barriers of a cold sale have vanished.`,
      },
      {
        type: 'image',
        heading: 'Technique 2: Eyes & Ears — Trumps Everything',
        body: `Eyes & Ears sales have a closing percentage that is twice that of Mushroom linking and Go-Backs. From the moment you start your day, your eyes and ears should be on high alert.

The concept is simple: no matter what you're doing during the day, whenever you see or hear the presence of a homeowner you haven't serviced yet, you must stop what you're doing and approach them. This means:

A car pulling into or out of a driveway. Someone working in their yard or garage. Someone walking their dog. Someone walking to their mailbox. Someone looking over their hedge or fence at you. Someone looking out their window at you.

Why is the closing rate so much higher? Because these people are already outside. There's no door between you and them. They can see your flags, hear your machine, and watch you working. You're approaching them in a natural, non-threatening way — not interrupting them behind a closed door.

The critical rule: If you are in the middle of aerating and you see someone outside — stop and go link. If you're in the middle of your Mushroom canvassing and you see a car pulling into a driveway four doors up — run over and get your link. If you see someone walking their dog in the opposite direction — stop and go link.

Eyes & Ears trumps everything. The lawn can wait. The mushroom can wait. An outdoor prospect who is right there, right now, cannot wait.`,
        image: {
          src: `${STORAGE_BASE}/car-overhead.png`,
          alt: 'Car pulling into driveway — Eyes & Ears opportunity',
          position: 'inline-right',
          maxHeight: 120,
        },
      },
      {
        type: 'image',
        heading: 'Technique 3: Go-Backs with Names',
        body: `Throughout the day, you've been knocking on doors where nobody was home. You've also had some homeowners who were 'on the fence' — not a definite yes, but not a hard no either. Between 5:00 PM and 7:00 PM, these people come home from work. This is when you execute your Go-Backs.

Here's what makes Go-Backs so powerful: when you knocked on these doors at 10 AM, you were a cold stranger with zero credibility. Now you're returning at 6 PM with a list of 5–6 names of neighbours who all bought the service today, flags visible up and down the street, and the confidence of someone who has been working the neighbourhood all day.

The key to effective Go-Backs is how you SET THEM UP earlier in the day. When a homeowner is objecting or trying to dismiss you in the morning, don't push for a hard close. Instead, respectfully say: "I can see you aren't sure right now and need to think about it. I'll go aerate a few more of your neighbours and will try back after I'm done." Then move on.

By doing this, you've avoided a definite "No" — the door is still open. When you return later and address them by name, the homeowner is caught off guard. They ask how you know their name, and you say: "Oh, I was just down the street with John and he mentioned your name. I've done John, Mary, Mark, Joe, and Julie today and just wanted to check back with you because I could tell you were interested."

That's how you turn a maybe into a yes. As homeowners see more and more neighbours getting aerated throughout the day, they realize it's better to just get it done rather than be the odd one out. The social proof compounds with every flag that goes up.`,
        image: {
          src: `${STORAGE_BASE}/lady-walking-dog.png`,
          alt: 'Lady walking dog — Eyes & Ears opportunity',
          position: 'inline-right',
          maxHeight: 160,
        },
      },
      {
        type: 'text',
        heading: 'Your Two Daily Linking Goals',
        body: `To keep your linking sharp every single day, commit to these two goals:

Goal 1: Always have the next lawn sold and flagged BEFORE finishing your current lawn. Think about when your confidence is highest — it's right after getting a sale. Your energy is up, your scripts are flowing naturally, and you're in the zone. Use that moment of heightened confidence to approach the next neighbour. The last thing you want is to finish aerating, collect payment, and then have to start cold with zero momentum. Don't worry if keeping the link going means some lawns take a little longer to get done. The customers are waiting next to no time at all — what's most important is that you keep the chain going.

Goal 2: Expand each cold sale into at least 3 more lawns within view. If over the course of your day you make 5 cold sales and you link at least 2–3 steps off each one, you'll hit 15–20 steps every day. Getting 5 cold sales is not difficult. With the correct focus on linking, you can ensure yourself a seat at the winner's table every night.`,
      },
      {
        type: 'storyboard',
        heading: 'Linking in Action: A Real Neighbourhood Story',
        description:
          'Step through a full day of linking on a real neighbourhood map. Watch how one cold sale turns into 9+ steps through Mushroom, Eyes & Ears, and Go-Backs.',
        baseImage: {
          src: `${STORAGE_BASE}/linking-aerial-map.png`,
          alt: 'Aerial view of Fessenden Way & Jarlan Terrace neighbourhood',
        },
        frames: [
          {
            label: 'Drop-Off Point',
            caption:
              'You\'re dropped off at the corner of Fessenden Way & Jarlan Terrace. Machine unloaded, gear checked. Time to find your first sale.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/cps-van.png`, x: 62, y: 88 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 55, y: 85 },
            ],
          },
          {
            label: '1st Cold Sale: John',
            caption:
              'You close your first cold sale — John. Ask for his name and neighbours\' names. Flag the lawn. Aerate the front, starting with the section connecting to the neighbour. The linking system begins.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 57, y: 43 },
              { type: 'label', text: 'John', x: 63, y: 35, color: '#22c55e' },
            ],
          },
          {
            label: 'Mushroom Sale: Mary',
            caption:
              'Using John\'s name, you approach Mary next door. "Hi, I\'m just next door with John..." Mary says yes! Get her name and neighbours\' names. Flag and continue the mushroom.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'label', text: 'John', x: 63, y: 35, color: '#22c55e' },
              { type: 'label', text: 'Mary', x: 70, y: 30, color: '#22c55e' },
              { type: 'label', text: 'On the fence', x: 55, y: 30, color: '#f59e0b' },
            ],
          },
          {
            label: 'Mushroom Sale: Mark',
            caption:
              'Using John and Mary\'s names, you continue mushrooming. Mark says yes. Some doors say "Not today" or "Too expensive" — that\'s fine. You now have 3 names and 3 flags.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'label', text: 'John', x: 63, y: 35, color: '#22c55e' },
              { type: 'label', text: 'Mary', x: 70, y: 30, color: '#22c55e' },
              { type: 'label', text: 'Mark', x: 46, y: 48, color: '#22c55e' },
              { type: 'label', text: 'Not today', x: 55, y: 55, color: '#ef4444' },
              { type: 'label', text: 'Too expensive', x: 45, y: 60, color: '#ef4444' },
              { type: 'label', text: 'Nobody home', x: 40, y: 55, color: '#6b7280' },
            ],
          },
          {
            label: 'Eyes & Ears Sale: Joe',
            caption:
              'While returning to finish aerations, you notice a car pulling into a driveway. STOP. Run over. Using John, Mary, and Mark\'s names, you approach Joe. He says yes. Eyes & Ears trumps everything!',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'icon', src: `${STORAGE_BASE}/car-overhead.png`, x: 42, y: 45 },
              { type: 'label', text: 'Joe', x: 42, y: 37, color: '#3b82f6' },
              { type: 'label', text: 'Eyes & Ears!', x: 35, y: 42, color: '#3b82f6' },
            ],
          },
          {
            label: 'Eyes & Ears Sale: Julie',
            caption:
              'While aerating Mark\'s lawn, you see a lady walking her dog down the street. STOP the machine. Approach her with your list of names. Julie says yes. That\'s 5 sales from 1 cold start.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 72, y: 22 },
              { type: 'icon', src: `${STORAGE_BASE}/lady-walking-dog.png`, x: 68, y: 25 },
              { type: 'label', text: 'Julie', x: 75, y: 18, color: '#3b82f6' },
            ],
          },
          {
            label: 'Mushroom from Joe: Joanne',
            caption:
              'After completing Joe\'s lawn, start a new mushroom from his house. Joanne says yes — but the rest of the mushroom hits "Not interested," "Too dry," and "Have contractor." That\'s fine. Aerate Joanne\'s lawn.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 72, y: 22 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 38, y: 50 },
              { type: 'label', text: 'Joanne', x: 34, y: 46, color: '#22c55e' },
              { type: 'label', text: 'Not interested', x: 30, y: 55, color: '#ef4444' },
              { type: 'label', text: 'Too dry', x: 25, y: 62, color: '#ef4444' },
            ],
          },
          {
            label: 'Go-Back Sale: Bill',
            caption:
              'On the way to aerate Julie\'s lawn, you pass Bill\'s house — he was "on the fence" this morning. Now you have 6 names to drop. "John, Mary, Mark, Joe, Julie, and Joanne all got it done today..." Bill caves.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 72, y: 22 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 38, y: 50 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 55, y: 30 },
              { type: 'label', text: 'Bill', x: 52, y: 25, color: '#f59e0b' },
              { type: 'label', text: 'Go-Back!', x: 48, y: 30, color: '#f59e0b' },
            ],
          },
          {
            label: 'Go-Back Sale: Rita',
            caption:
              'Rita was also on the fence earlier. With 7 names and flags everywhere, the social proof is overwhelming. Go-Back closed. That\'s 8 sales from 1 cold start.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 72, y: 22 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 38, y: 50 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 55, y: 30 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 64, y: 28 },
              { type: 'label', text: 'Rita', x: 67, y: 23, color: '#f59e0b' },
              { type: 'label', text: 'Go-Back!', x: 62, y: 23, color: '#f59e0b' },
            ],
          },
          {
            label: 'The Cycle Restarts',
            caption:
              'Head to Julie\'s house to complete her lawn aeration, then start the entire Mushroom process over from her location. This is how top stars step 20 lawns in a day — one cold sale mushrooms into an entire street.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 60, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 67, y: 35 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 50, y: 52 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 45, y: 42 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 72, y: 22 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 38, y: 50 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 55, y: 30 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 64, y: 28 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 70, y: 24 },
              { type: 'label', text: 'Start over from here!', x: 72, y: 17, color: '#22c55e' },
            ],
          },
        ],
      },
      {
        type: 'text',
        heading: 'Staying Organized — Your Tools Are Your Ammunition',
        body: `To effectively manage all this linking, you must stay organized. Names are your most valuable currency on the route — if you forget a name, you've lost a potential sale. Write every name down immediately.

Before you leave the shop, make sure your folder is stocked and ready:

Route map and log sheet — your game plan and scorecard for the day. 5 receipts and 2 upsell contracts — always have more than you think you'll need. Sales glossy — your visual tool for the pitch. Pouch loaded — for collecting cash and cheques. At least one working pen — sounds basic, but running out of ink mid-route is a rookie mistake.

Keep your folder organized so you can quickly jot down neighbour names and transition seamlessly from one linked sale to the next. The fastest way to break a hot link is to fumble around looking for a receipt or pen.`,
      },
    ],

    quiz: [
      {
        question:
          'How many times easier is it to close a customer on a link compared to a cold sale?',
        options: [
          '2 times easier',
          '3 times easier',
          '5 times easier',
          '10 times easier',
        ],
        correct_index: 2,
        explanation:
          'It has been proven year after year that closing on a link is at least 5 times easier than cold-selling. This is why linking is the #1 system top earners master.',
      },
      {
        question: 'What is the "Mushroom with a Name" strategy?',
        options: [
          'Selling organic mushroom compost to clients',
          'Closing a sale, then getting the customer\'s name and neighbours\' names to use at surrounding doors',
          'Finding mushrooms on the lawn to show the customer their soil needs help',
          'A special pricing discount for bulk neighbourhood sales',
        ],
        correct_index: 1,
        explanation:
          'After closing your first sale, you gather names from that customer and use them to build instant credibility at the next doors — spreading outward like a mushroom from a single point.',
      },
      {
        question: 'Which linking method has the HIGHEST closing percentage?',
        options: [
          'Cold knocking',
          'Mushroom with a Name',
          'Go-Backs with Names',
          'Eyes & Ears',
        ],
        correct_index: 3,
        explanation:
          'Eyes & Ears has a closing percentage twice that of Mushroom linking and Go-Backs. Approaching people who are already outside removes the door barrier entirely.',
      },
      {
        question:
          'According to CPS data, how do top workers (20 steps/day) get most of their sales?',
        options: [
          '15–17 from cold sales, 3–5 from linking',
          '10 from cold sales, 10 from linking',
          '3–5 from cold sales, 15–17 from linking',
          'All 20 from cold sales — they just knock faster',
        ],
        correct_index: 2,
        explanation:
          'Top workers get the vast majority of their sales from linking. Only 3–5 come from cold knocking — the rest are all built through Mushroom, Eyes & Ears, and Go-Backs.',
      },
      {
        question:
          'What should you do if you\'re in the middle of aerating a lawn and you see someone getting out of their car 4 doors up?',
        options: [
          'Finish the lawn first, then go talk to them',
          'Wave but keep aerating — you\'ll catch them on the Go-Back',
          'Stop aerating immediately and go approach them with your names',
          'Yell your pitch from across the street',
        ],
        correct_index: 2,
        explanation:
          'Eyes & Ears trumps everything. The lawn can wait — an outdoor prospect who is right there right now cannot. Stop what you\'re doing and go link.',
      },
      {
        question:
          'Which of the following is NOT one of the psychological reasons homeowners buy off a link?',
        options: [
          '"If my neighbour is doing it, we probably need it too"',
          '"I don\'t want to look cheap by passing on it"',
          '"This salesperson offered me the lowest price on the street"',
          '"If everyone on the street is getting it done, I don\'t want to be left out"',
        ],
        correct_index: 2,
        explanation:
          'Linking psychology is based on social proof, fear of missing out, and trust transfer — not on low prices. Linked sales often command the same or higher prices because credibility does the selling.',
      },
      {
        question: 'What is the ideal time window for executing Go-Backs?',
        options: [
          '8:00 AM – 10:00 AM',
          '12:00 PM – 2:00 PM',
          '5:00 PM – 7:00 PM',
          'After 8:00 PM',
        ],
        correct_index: 2,
        explanation:
          'Between 5–7 PM is when people who weren\'t home earlier return from work. You now have maximum social proof — a full list of names and flags visible everywhere.',
      },
      {
        question:
          'When a homeowner is objecting to your pitch in the morning and you plan to Go-Back later, what is the KEY thing to avoid?',
        options: [
          'Giving them a flyer',
          'Letting them say a definite "No"',
          'Telling them your name',
          'Mentioning the neighbours',
        ],
        correct_index: 1,
        explanation:
          'If they say a hard "No," the door is closed. Instead, respectfully say you can see they need to think about it and you\'ll try back after doing a few more neighbours. This keeps the door open for a powerful Go-Back later.',
      },
      {
        question: 'What is your first daily linking goal?',
        options: [
          'Get at least 20 cold sales before starting to link',
          'Always have the next lawn sold and flagged BEFORE finishing your current lawn',
          'Complete your entire route map before 3 PM',
          'Memorize every homeowner\'s name on the street',
        ],
        correct_index: 1,
        explanation:
          'You want to use the confidence high from each sale to immediately secure the next one. Never finish a lawn and then have to start cold again — keep the chain going.',
      },
      {
        question:
          'What should be ready in your folder at all times while linking?',
        options: [
          'Your lunch, water bottle, and phone charger',
          'Route map, log sheet, 5 receipts, 2 upsell contracts, sales glossy, and a pen',
          'Personal magazines and spare aerator parts',
          'A laptop for looking up property records',
        ],
        correct_index: 1,
        explanation:
          'Names are your ammunition, and organized paperwork ensures you can close and log sales instantly without breaking your linking momentum.',
      },
    ],
  },

  // =====================================================================
  // MODULE 4 — Basic Sales Concepts (UNCHANGED)
  // =====================================================================
  {
    module_id: 'module_04_sales_basics',
    order_index: 4,
    is_active: true,
    title: 'Basic Sales Concepts: Pricing, Pitching, and Closing',
    description:
      'Learn the fundamental sales scripts and pricing strategies. We\'ll cover how to navigate to the backyard, quote the "Lawn Split," and confidently close the deal using company standards.',
    lesson_content: `A successful door-to-door pitch is fast, confident, and structured—this is your 'shooting' practice. Your Goal #1 at the door is to gain the customer's trust and quickly direct the conversation toward the backyard. Introduce yourself, tell them exactly what you are doing on the street, and ask your first engaging question: 'Have you ever had your lawn aerated before?' Whether they affirm or need education, transition smoothly to your second question: 'Which way is it to your backyard—left or right?' Getting physical access to the backyard makes the full property sale highly probable.

Goal #2 is mastering pricing and closing using the 'Lawn Split' strategy. Never quote a single, massive number right away. Instead, pull out your Service Guide and break it down. Say, 'Normally, the front is $60 and the back is $60. But since I'm already here doing the neighbour's property, I can do the front for $60 and give you the backyard for half off, making it just $90 for the whole property.' This negotiation tactic makes the pricing feel like an exclusive, time-sensitive deal.

You must absolutely adhere to the company's minimum pricing structures. The absolute minimum charge for the smallest chunk of front lawn is $50.00. The minimum for a front and back (like a small townhouse) is $60.00. However, professionals aim higher; the average property should be billed at $80.00+. Finally, do not undercharge for large corner lots—these require more time and effort, so the minimum charge for a corner lot is $100.00+.

Closing the deal involves securing the commitment and determining the payment method. Ask for the sale confidently with a simple phrase like, 'Sounds good?' while nodding your head. Let them know we accept Cash, Cheque, Credit Card, or E-Transfer. If they pay by cheque, ensure it is made payable exactly to 'Canadian Property Stars'.

Finally, as a legitimate Canadian business, you must charge HST on every single lawn. Do not offer 'under the table' deals. Accurately complete the receipt and log sheet for every transaction. Deliver your pitch with a clean uniform (always wear your Canadian Property Stars shirt), a positive attitude, and max effort, and your closing rate will soar.`,
    quiz: [
      {
        question:
          'What is the absolute minimum charge allowed for a small front lawn aeration?',
        options: ['$20.00', '$30.00', '$50.00', '$80.00'],
        correct_index: 2,
        explanation:
          'To maintain profitability and professional standards, the absolute minimum charge for even the smallest front lawn is $50.00.',
      },
      {
        question:
          'What is the strategic purpose of asking "Which way is it to your backyard—left or right?"',
        options: [
          'To figure out where to park your truck',
          'It assumes the sale and physically moves the conversation toward the larger, more profitable backyard',
          'To check if they have a dog',
          'To see if they have a gate lock',
        ],
        correct_index: 1,
        explanation:
          'This question bypasses a yes or no decision and smoothly advances the physical inspection of the property.',
      },
      {
        question: 'How should cheques be made payable?',
        options: [
          'To your personal name',
          'To "Cash"',
          'To "Canadian Property Stars"',
          'To "Lawn Care Pros"',
        ],
        correct_index: 2,
        explanation:
          'All cheque payments must be made out directly to the official company name, Canadian Property Stars.',
      },
      {
        question: 'What is the "Lawn Split" pricing strategy?',
        options: [
          'Charging separately for the left and right sides of the lawn',
          'Breaking the quote into front and back prices, then offering a discount on the back to incentivize a full property sale',
          'Physically dividing the lawn with flags',
          'Splitting the total bill with the neighbour',
        ],
        correct_index: 1,
        explanation:
          'Splitting the price makes the total cost seem more digestible and highlights the discount they are receiving.',
      },
      {
        question: 'What is the minimum pricing rule for large corner lots?',
        options: [
          'They are the same price as standard lawns',
          'They should be heavily discounted to win the business',
          'Do not undercharge; the minimum is $100+',
          'Charge by the hour instead',
        ],
        correct_index: 2,
        explanation:
          'Corner lots have significantly more square footage and require more work, so they must be priced at a minimum of $100+.',
      },
    ],
  },

  // =====================================================================
  // MODULE 5 — Your First Week (UNCHANGED)
  // =====================================================================
  {
    module_id: 'module_05_first_week',
    order_index: 5,
    is_active: true,
    title: 'Your First Week: 3 Goals for Rookie Success',
    description:
      'Prepare for your first week on the job by focusing on three clear, achievable goals. Learn how to "tie your skates," operate safely, and master the basics of the route.',
    lesson_content: `Your first week on the job is like a professional training camp. It's perfectly normal to feel nervous or overwhelmed by the physical work and the reality of sales rejection. To ensure you succeed, we want you to focus strictly on mastering the basics rather than worrying about breaking sales records immediately. You are entering the Professional Aerating League, and you need to build a solid foundation. Set personal goals for the day, bring a great attitude, and give maximum effort.

Your first goal is 'Skating': learning how to safely and effectively operate the equipment. Whether you are using a core aerator or applying lawn rejuvenation products, spend your first few days focusing on machine control, turning, and loading or unloading safely. Your machine is your livelihood—respect it, maintain it, and never cut corners on safety protocols. Once you can operate the machine effortlessly, your speed will naturally increase.

Your second goal is 'Shooting': mastering the basic sales script. Don't worry about complex, advanced objection handling during your first week. Focus entirely on delivering a smooth, confident introduction and executing a proper 'lawn split' price quote. Practice your pitch in the mirror and with your manager until the words flow naturally without sounding robotic.

Your third goal is 'Tying Your Skates': mastering the paperwork and daily procedures. This means strictly following the 5 steps to high steps, accurately filling out your daily log sheet, managing your 5 receipts and 2 upsell contracts, placing flags correctly, and understanding how your payout works at the end of the day. Proper administrative work is what guarantees you get paid correctly for the physical work you've done.

Preparation ties all these goals together. Check your gear before you leave the shop: 10 flags, 10 poles, your folder (with map and log sheet), pouch, pen, and your knapsack with food and drinks. Ensure you are wearing your CPS shirt. Most importantly, communicate. Never leave the route without authorization, and always work with your team for load-ins and load-outs. Focus on these core goals, and the high-commission days will follow!`,
    quiz: [
      {
        question: 'What does the "Skating" goal refer to in your first week?',
        options: [
          'Learning how to safely and effectively operate the aerator equipment',
          'Learning to literally rollerblade between houses',
          'Sliding past angry customers quickly',
          'Cleaning the shop floor',
        ],
        correct_index: 0,
        explanation:
          'Safety and basic operational competence are the foundation you need before you can focus on working quickly and selling.',
      },
      {
        question: 'What is meant by "Tying Your Skates"?',
        options: [
          'Ensuring your work boots are double-knotted',
          'Mastering the paperwork, daily procedures, log sheets, and understanding payouts',
          'Securing the machine to the trailer',
          'Tying flags to trees',
        ],
        correct_index: 1,
        explanation:
          'Mastering the administrative and procedural tasks ensures you stay organized and get paid accurately.',
      },
      {
        question:
          'What type of sales script should a rookie focus on mastering first ("Shooting")?',
        options: [
          'A highly complex script with 20 advanced objection rebuttals',
          'A basic script with a smooth introduction and proper "lawn split" quote',
          'A telemarketing script',
          'A script focused entirely on weather patterns',
        ],
        correct_index: 1,
        explanation:
          'Mastering the fundamentals of the basic script prevents you from getting overwhelmed early on.',
      },
      {
        question:
          'How many flags and poles should you check that you have before leaving the shop?',
        options: [
          '5 flags / 5 poles',
          '10 flags / 10 poles',
          '50 flags / 50 poles',
          '0 flags / 0 poles',
        ],
        correct_index: 1,
        explanation:
          'Standard daily preparation requires starting the route with 10 flags and 10 poles ready to mark completed lawns.',
      },
      {
        question:
          'What should be your primary focus regarding sales expectations during your very first week?',
        options: [
          'Breaking the all-time company sales record',
          'Focusing strictly on mastering the basics, setting personal goals, and giving max effort',
          'Selling higher-priced upsells only',
          'Only talking to people who already want the service',
        ],
        correct_index: 1,
        explanation:
          'Your first week is about building a foundation of operational and basic sales skills, not stressing over breaking records immediately.',
      },
    ],
  },
];

// Helper: Get a module by ID
export const getModuleById = (moduleId: string): TrainingModule | undefined => {
  return TRAINING_MODULES.find((m) => m.module_id === moduleId);
};

// Helper: Get active modules for a region (or all if no region)
export const getModulesForRegion = (region?: Region): TrainingModule[] => {
  return TRAINING_MODULES.filter(
    (m) => m.is_active && (!m.region || m.region === region)
  ).sort((a, b) => a.order_index - b.order_index);
};

// Pass threshold: 80% or higher to mark a module complete
export const QUIZ_PASS_THRESHOLD = 0.8;