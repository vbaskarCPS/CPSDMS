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
  linkTo?: string;      // optional internal route path, e.g. '/logsheet'
  linkLabel?: string;   // button label, e.g. 'Open Training Log Sheet'
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

export type LessonSection = TextSection | ImageSection | StoryboardSection | VideoSection;

export interface VideoSection {
  type: 'video';
  heading: string;
  description?: string;  // short intro text above the player
  youtubeId: string;      // just the video ID, e.g. 'C-1wiX42wIE'
  note?: string;          // optional disclaimer like "Prices may be outdated"
}

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
  // MODULE 1 — The Basic Rookie Mindset (REWRITTEN — structured sections + videos + 10 Qs)
  // =====================================================================
  {
    module_id: 'module_01_mindset',
    order_index: 1,
    is_active: true,
    title: 'The Basic Rookie Mindset: Your Blueprint for Success',
    description:
      'Discover the winning attitude and mental toughness required to thrive in door-to-door lawn care sales. Learn how top CPS stars build confidence, handle rejection, and treat every day like a championship game.',
    lesson_content: '', // structured sections below
    lesson_sections: [
      {
        type: 'text',
        heading: 'Welcome to the Professional Aerating League',
        body: `You are entering a training program to join the Professional Aerating League. Working door-to-door property maintenance is a physically and mentally demanding job, but it is also extremely rewarding. As a rookie, the most important tool you have isn't the aerator or the fertilizer — it's your mindset. You will face rejection, long hours on your feet, and varying Canadian weather conditions. A strong, positive attitude is what separates the top earners from the rest.

CPS was designed to truly bring out the very best in each of its workers. Since the workload is very intense, it takes a special kind of person — or at least special effort — to be successful day after day. The concepts in this module come directly from the CPS founder's playbook and will help you understand what it takes to maximize your success this summer.`,
      },
      {
        type: 'video',
        heading: 'Tilo McAllister on the Door-to-Door Mindset',
        description: 'Hear from one of CPS\'s top trainers about the mental approach that separates average workers from stars.',
        youtubeId: 'h6sDMh5xDA4',
      },
      {
        type: 'text',
        heading: 'Building Confidence and a Healthy Ego',
        body: `On your way to the top with CPS it will be vital to develop your confidence and allow a healthy amount of ego into your life. A healthy ego is not cockiness or arrogance — it's the inner drive that holds you to your goals when the going gets tough.

Confidence is built from belief. The more you believe in yourself, the business, the service, and your ability, the quicker your confidence will increase. Confidence grows through working more days (experience), learning new tricks of the trade (knowledge), and by achieving goals you set for yourself — "first sale," "first link," "first end-of-night sale," "first chair," "first win."

Before you leave your seat in morning meeting, check your ego. Your ego should tell you what goals you want to hit — 10 steps, 3 links, or top 3 of the day. When you set that goal, you now have something for your ego to hold you to during the day. When you hit a cold patch, your ego will command you to pick it up, knock again, and try harder.

The more confident you become, the more assertive you will be. The more confident you become, the quicker you will get what you want. The more confident you become, the richer your life will be. Confidence and a healthy ego are the two main ingredients in TAKING YOUR LIFE TO THE NEXT LEVEL.`,
      },
      {
        type: 'text',
        heading: 'Treat the Business Like You Own It',
        body: `As an independent contractor working with CPS, you literally are a small business owner. You are running a small business within a bigger business. Your route is your office and each street is a CPS masterpiece waiting to happen.

Imagine how fast the business would grow if every contractor treated every aspect like it was their own. The top workers link 3 to 10 homes together multiple times per day while average workers speckle a lawn here and there. The main reason stars link so well is the magnetic customer experience they offer — when they ask for neighbours' names and referrals, customers are more inclined to help someone who clearly cares about their job.

If you owned Canadian Property Stars, would you come to work excited or bored? Would you come well-dressed or looking like a slob? Would you work hard or go through the motions? Would you treat customers with respect and honesty? You DO own Canadian Property Stars — treat it that way and the rewards will follow.`,
      },
      {
        type: 'video',
        heading: 'Dave Wilkerson on Attitude and Effort',
        description: 'Dave breaks down why your attitude and effort level are the two factors completely within your control — and why they determine everything.',
        youtubeId: '6RePD5Wo6Bg',
      },
      {
        type: 'text',
        heading: 'On Stage at All Times',
        body: `From the moment you arrive at the shop each morning, act as if you are "on stage." People spend a lifetime building credibility but it only takes one act to destroy it all. CPS stars understand that homeowners are watching everything on their street.

Here's what top stars do to maximize their "stage presence": smile and wave at all drivers passing down the street. Greet all homeowners with a big smile. Treat every homeowner with honesty and respect. Compliment their property. Show that you are hustling hard all day. Appear organized and expert. Use neighbours' names to build credibility.

And the no-nos that can ruin your day: getting in an argument with a homeowner, using curse words, letting anyone see you smoking, complaining about rain or your day, walking slowly, cutting corners on work, sitting or lying down on a lawn, overcharging, lying, or causing property damage.

Once you realize you are being watched and you step up your game, your results will skyrocket.`,
      },
      {
        type: 'text',
        heading: 'The 100% Positivity Rule',
        body: `Your success depends on maintaining a "100% positivity" rule while on the route. It's natural to feel frustrated when a homeowner says no or nobody is answering the door. However, dwelling on negativity will ruin your focus and cost you money. When you encounter a tough customer, shake it off quickly and move to the next door. Every "no" brings you closer to a "yes," and you only need a fraction of a neighbourhood to have an incredibly profitable day.

CPS is a journey, not a sprint. We need to look at the big picture when we have a really tough day. A tough day might mean a ghost town, lots of no's that beat up your confidence, or a take-home pay of only $40. The first thing you must do is put it in perspective by accepting that you had one tough day. With your training, route management support, superior effort, and past results, you are positioned for success. How you respond to your struggles today sets the tone for every day that follows.`,
      },
      {
        type: 'text',
        heading: '"One More Round" — The Champion\'s Mentality',
        body: `"One More Round" is a concept developed by the CPS founder with his karate instructor. After training for hours, exhausted and ready to quit, his instructor would challenge him to go just one more round. Over time, it became a defining philosophy: the body can, and will, do exactly what the mind tells it to do.

Going One More Round in everything you do will place you in a class of your own. Most people are simply not willing to go One More Round. Why don't you decide to be someone who always does?

At CPS, here's what One More Round looks like: when you're tired at 7:30 PM and want to quit, push for one more sale. When you've been told "no" five times in a row, knock one more door. When your body aches and you want to sit down, run to one more house. The extra effort you put in during those moments is what separates the stars from the average — and it's what will earn you the chair at payout.`,
      },
      {
        type: 'text',
        heading: 'Daily Preparation — Set Yourself Up for Success',
        body: `Consistency and endurance are key to your earnings. The door-to-door season is a marathon, not a sprint. To stay sharp and perform at your best, manage your personal time well. Sleep management is critical — get plenty of rest after work and save the partying for the off-season. Set goals and stay extremely competitive every day, showing up as many days as possible.

Daily preparation is just as important as your pitch. Always bring a knapsack packed with enough food and drinks to last the entire day. Dress for the Canadian weather forecast — if rain is predicted, be prepared. Bring sunscreen for sunny days and extra socks for wet days. Mandatory footwear includes high-quality running shoes or steel-toed work boots; old sneakers or sandals are strictly prohibited.

Think of your first week like learning to play hockey: you need to learn how to "skate" before you can "score." Show up with a winning attitude, a ready mind to learn, and be coachable. Trust the company systems, lean on your managers, and push through the initial learning curve.`,
      },
    ],
    quiz: [
      {
        question: 'What is the difference between "cockiness" and a "healthy ego" at CPS?',
        options: [
          'There is no difference — both mean the same thing',
          'Cockiness treats others as inferior; a healthy ego drives you toward your own goals and helps others improve',
          'A healthy ego means never setting goals',
          'Cockiness is required to close sales',
        ],
        correct_index: 1,
        explanation:
          'A healthy ego pushes you to achieve your goals and uplift others, while cockiness tears others down to make yourself feel better.',
      },
      {
        question: 'What does "On Stage at All Times" mean?',
        options: [
          'You must literally perform comedy at the door',
          'Every action you take on the route is being watched by homeowners, so always present yourself professionally',
          'You should only work when a manager is watching',
          'It means wearing a costume while aerating',
        ],
        correct_index: 1,
        explanation:
          'Homeowners observe everything happening on their street. Your professionalism — or lack of it — directly affects referrals and sales.',
      },
      {
        question: 'How should you handle a really tough day with no sales?',
        options: [
          'Quit and go home early',
          'Blame the neighbourhood and demand a new route',
          'Accept it was one tough day, maintain perspective, and come back harder tomorrow',
          'Call your manager to complain about the territory',
        ],
        correct_index: 2,
        explanation:
          'Even top CPS stars occasionally have zero days. How you respond to struggles sets the tone for every day that follows.',
      },
      {
        question: 'What does "Treat the Business Like You Own It" mean in practice?',
        options: [
          'You can set your own hours and skip morning meetings',
          'Come to work excited, dress professionally, work hard, treat customers with respect, and take care of equipment',
          'You can fire your route manager if you disagree',
          'It means nothing — you\'re just an employee',
        ],
        correct_index: 1,
        explanation:
          'As an independent contractor, you are a small business owner within CPS. Your professionalism creates the magnetic customer experience that drives referrals.',
      },
      {
        question: 'What is the "100% Positivity Rule"?',
        options: [
          'Never admit when you\'ve had a bad day',
          'Maintain a positive attitude on the route — shake off rejection quickly and keep moving to the next door',
          'Always agree with the customer, even if they\'re wrong',
          'Post only positive things on social media',
        ],
        correct_index: 1,
        explanation:
          'Dwelling on negativity ruins your focus and momentum. Every "no" brings you closer to a "yes."',
      },
      {
        question: 'What does the "One More Round" philosophy teach?',
        options: [
          'Only work one round of the neighbourhood per day',
          'When you\'re exhausted and want to quit, push for one more effort — the body does what the mind commands',
          'Do one round of push-ups each morning',
          'Always leave one house un-aerated per street',
        ],
        correct_index: 1,
        explanation:
          'The extra effort during those final moments separates stars from average workers and often leads to end-of-night sales.',
      },
      {
        question: 'Why is sleep management important for CPS workers?',
        options: [
          'Because sleeping on the route is encouraged',
          'The job is physically demanding — rest allows you to maintain energy and performance across the whole season',
          'To avoid being late only on Mondays',
          'It\'s not important — you can party every night',
        ],
        correct_index: 1,
        explanation:
          'The season is a marathon. Consistent rest ensures you can bring maximum energy and effort day after day.',
      },
      {
        question: 'What is considered mandatory footwear for the job?',
        options: [
          'Any comfortable sandals',
          'Old sneakers are fine',
          'High-quality running shoes or steel-toed work boots',
          'Rubber rain boots only',
        ],
        correct_index: 2,
        explanation:
          'Proper footwear prevents injury and provides the support needed for running between houses all day.',
      },
      {
        question: 'Which of the following is a "no-no" that can ruin your stage presence?',
        options: [
          'Smiling and waving at passing cars',
          'Complimenting a homeowner\'s landscaping',
          'Sitting down on a homeowner\'s lawn or street corner during work',
          'Using neighbours\' names as referrals',
        ],
        correct_index: 2,
        explanation:
          'Sitting or lying down signals laziness to every homeowner watching the street, destroying your credibility and potential referrals.',
      },
      {
        question: 'How does confidence grow at CPS?',
        options: [
          'It\'s something you\'re born with and can\'t develop',
          'Through experience (working more days), knowledge (learning tricks of the trade), and achieving progressive goals',
          'By avoiding all difficult situations',
          'Only through reading the Next Level Book',
        ],
        correct_index: 1,
        explanation:
          'Confidence builds through a combination of reps, learning, and small wins that compound into bigger achievements over time.',
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
              { type: 'icon', src: `${STORAGE_BASE}/cps-van.png`, x: 46, y: 97 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 47, y: 83 },
            ],
          },
          {
            label: 'Step 1: Run All Day',
            caption:
              'Run or jog lightly between houses — 3x more doors than walking. Leave your machine at the edge of a driveway and canvass 2–3 homes in each direction.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 36, y: 91 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 32, y: 91 },
              { type: 'label', text: 'Run Forest, Run...', x: 49, y: 78, color: '#ef4444' },
            ],
          },
          {
            label: 'Step 2: The 10-Second Rule',
            caption:
              'Ring the doorbell, listen for 10 seconds max. No footsteps? Move immediately. This saves 20–60 seconds per door = at least 1 extra hour per day.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 36, y: 91 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 32, y: 91 },
              { type: 'label', text: '10', x: 49, y: 56, color: '#f59e0b' },
            ],
          },
          {
            label: 'Step 3: Horseshoe Method',
            caption:
              'Cut straight across lawns to the neighbour\'s door instead of using the sidewalk. Canvass up one side, cross, and come back down — a horseshoe pattern.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 51 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 38, y: 53 },
              { type: 'label', text: 'Cut across lawn', x: 60, y: 50, color: '#ef4444' },
            ],
          },
          {
            label: 'First Sale!',
            caption:
              'You\'ve got your first sale! Flag the lawn at the street beside the driveway. Start aerating the front lawn. This flag is now marketing for the whole street.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 51 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 43, y: 47 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 32, y: 31 },
              { type: 'label', text: '1st sale', x: 25, y: 31, color: '#ef4444' },
            ],
          },
          {
            label: 'Complete the Horseshoe',
            caption:
              'After your first sale, complete the horseshoe pattern. The red figure runs across lawns to canvass the neighbours — never going back to the street.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 51 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 48, y: 33 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 32, y: 31 },
              { type: 'label', text: '1st sale', x: 25, y: 31, color: '#ef4444' },
            ],
          },
          {
            label: 'Step 4: No Long-Term Relationships',
            caption:
              'Quick, friendly, and done. Your sales conversation is 60 seconds to 5 minutes max. Don\'t get caught chatting — every extra minute is a missed sale next door.',
            overlays: [
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 38, y: 51 },
              { type: 'icon', src: `${STORAGE_BASE}/red-running-figure.png`, x: 36, y: 55 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 32, y: 31 },
              { type: 'label', text: '1st sale', x: 25, y: 31, color: '#ef4444' },
              { type: 'label', text: 'Fancy a cold one?', x: 67, y: 14, color: '#ef4444' },
            ],
          },
          {
            label: 'Step 5: Aerate Efficiently',
            caption:
              'Smooth curves, 15–20 minutes per lawn. Don\'t cuddle the lawn. 10 lawns at 15 min = 2.5 hrs saved vs 30 min each. That\'s 5 more lawns you can sell and complete.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 32, y: 31 },
              { type: 'label', text: '1st sale', x: 25, y: 31, color: '#ef4444' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 48, y: 32 },
            ],
          },
          {
            label: 'Repeat All Day',
            caption:
              'Aerate efficiently, then use the Horseshoe to find your next sale. Flag it, sell it, aerate it. Go back to horseshoe pattern and repeat this cycle all day.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 32, y: 31 },
              { type: 'label', text: '1st sale', x: 25, y: 31, color: '#ef4444' },
              { type: 'label', text: 'Go Back', x: 26, y: 41, color: '#ef4444' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 48, y: 32 },
            ],
          },
        ],
      },
      {
        type: 'video',
        heading: 'Dave Wilkerson on 5 Steps to High Steps',
        description: 'Hear directly from Dave Wilkerson as he breaks down the 5 Steps system and explains why each step multiplies your earning potential.',
        youtubeId: 'LPkzijaQ_oE',
        note: 'These videos were recorded several years ago — prices mentioned may be outdated, but the concepts still apply 100%.',
      },
      {
        type: 'video',
        heading: 'Dave Wilkerson on Stepping High',
        description: 'Dave goes deeper into what it takes to consistently step high, day after day, and how the top stars use the 5 Steps system as their foundation.',
        youtubeId: '2_DXdsTRt4w',
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
              { type: 'icon', src: `${STORAGE_BASE}/cps-van.png`, x: 96, y: 61 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 68, y: 76 },
            ],
          },
          {
            label: '1st Cold Sale: John',
            caption:
              'You close your first cold sale — John. Ask for his name and neighbours\' names. Flag the lawn. Aerate the front, starting with the section connecting to the neighbour. The linking system begins.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'label', text: '1st sale (John)', x: 80, y: 31, color: '#dc2626' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'label', text: '1st mushroom (Mary)', x: 72, y: 16, color: '#dc2626' },
              { type: 'label', text: 'On the fence', x: 74, y: 23, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 68, y: 76 },
            ],
          },
          {
            label: 'Mushroom Sales: Mary & Mark',
            caption:
              'Using John\'s name, you approach Mary next door — she says yes! Then using John and Mary\'s names, you continue mushrooming across the street. Mark says yes. Some doors say "Not today" or "Too expensive" — that\'s fine. You now have 3 names and 3 flags.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'label', text: '1st sale (John)', x: 80, y: 31, color: '#dc2626' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'label', text: '1st mushroom (Mary)', x: 72, y: 16, color: '#dc2626' },
              { type: 'label', text: 'On the fence', x: 74, y: 23, color: '#f59e0b' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'label', text: '2nd Mushroom (Mark)', x: 36, y: 44, color: '#dc2626' },
              { type: 'label', text: 'Not today', x: 35, y: 36, color: '#f59e0b' },
              { type: 'label', text: 'Nobody home', x: 42, y: 53, color: '#6b7280' },
              { type: 'label', text: 'Nobody home', x: 45, y: 62, color: '#6b7280' },
              { type: 'label', text: 'On the fence', x: 84, y: 41, color: '#f59e0b' },
              { type: 'label', text: 'Too expensive', x: 84, y: 50, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 66, y: 31 },
            ],
          },
          {
            label: 'Eyes & Ears: Car Spotted',
            caption:
              'After completing the mushroom, you return to finish John\'s lawn. On the way back you notice a car pulling into a driveway. STOP. Run over. Using John, Mary, and Mark\'s names, you approach Joe.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'label', text: 'Not today', x: 35, y: 36, color: '#f59e0b' },
              { type: 'label', text: 'Nobody home', x: 42, y: 53, color: '#6b7280' },
              { type: 'label', text: 'Nobody home', x: 45, y: 62, color: '#6b7280' },
              { type: 'label', text: 'On the fence', x: 84, y: 41, color: '#f59e0b' },
              { type: 'label', text: 'Too expensive', x: 84, y: 50, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/car-overhead.png`, x: 59, y: 98 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 66, y: 31 },
            ],
          },
          {
            label: 'Eyes & Ears Sale: Joe',
            caption:
              'Joe says yes — that\'s your 4th sale. Flag his lawn. Now complete the aerations for John, Mary, and Mark. While aerating, keep your eyes and ears on high alert.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'label', text: '1st sale (John)', x: 80, y: 31, color: '#dc2626' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'label', text: '1st mushroom (Mary)', x: 72, y: 16, color: '#dc2626' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'label', text: '2nd Mushroom (Mark)', x: 36, y: 44, color: '#dc2626' },
              { type: 'label', text: 'Not today', x: 35, y: 36, color: '#f59e0b' },
              { type: 'label', text: 'Nobody home', x: 42, y: 53, color: '#6b7280' },
              { type: 'label', text: 'Nobody home', x: 45, y: 62, color: '#6b7280' },
              { type: 'label', text: 'On the fence', x: 84, y: 41, color: '#f59e0b' },
              { type: 'label', text: 'Too expensive', x: 84, y: 50, color: '#f59e0b' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'label', text: '1st Eyes & Ears (Joe)', x: 89, y: 58, color: '#dc2626' },
              { type: 'icon', src: `${STORAGE_BASE}/car-overhead.png`, x: 68, y: 60 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 66, y: 31 },
            ],
          },
          {
            label: 'Eyes & Ears Sale: Julie',
            caption:
              'While aerating Mark\'s lawn, you see a lady walking her dog. STOP the machine. Approach her with your list of names. Julie says yes. That\'s 5 sales from 1 cold start.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'label', text: '1st Eyes & Ears (Joe)', x: 89, y: 58, color: '#dc2626' },
              { type: 'label', text: '2nd Eyes & Ears (Julie)', x: 35, y: 5, color: '#dc2626' },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 51, y: 25 },
              { type: 'icon', src: `${STORAGE_BASE}/lady-walking-dog.png`, x: 64, y: 86 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 56, y: 33 },
              { type: 'label', text: 'On the fence', x: 84, y: 41, color: '#f59e0b' },
              { type: 'label', text: 'Too expensive', x: 84, y: 50, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/car-overhead.png`, x: 68, y: 60 },
            ],
          },
          {
            label: 'Mushroom from Joe: Joanne',
            caption:
              'After completing Joe\'s lawn, start a new mushroom from his house. Joanne says yes — but the rest of the mushroom hits "Not interested," "Too dry," "Have contractor." That\'s fine. Aerate Joanne\'s lawn.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 21, y: 7 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 67 },
              { type: 'label', text: 'Mushroom (Joanne)', x: 87, y: 69, color: '#dc2626' },
              { type: 'label', text: 'Not interested', x: 47, y: 79, color: '#f59e0b' },
              { type: 'label', text: 'Too dry', x: 44, y: 86, color: '#f59e0b' },
              { type: 'label', text: 'Have contractor', x: 65, y: 95, color: '#f59e0b' },
              { type: 'label', text: 'Nobody home', x: 51, y: 98, color: '#6b7280' },
              { type: 'label', text: 'No Habla Ingles', x: 95, y: 89, color: '#f59e0b' },
              { type: 'label', text: 'Too wet', x: 94, y: 96, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 64, y: 47 },
            ],
          },
          {
            label: 'Go-Back Sale: Bill',
            caption:
              'On the way to aerate Julie\'s lawn, you pass Bill\'s house — he was "on the fence" this morning. Now you have 6 names to drop. "John, Mary, Mark, Joe, Julie, and Joanne all got it done today..." Bill caves.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 21, y: 7 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 67 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 40 },
              { type: 'label', text: 'Go back (Bill)', x: 84, y: 41, color: '#dc2626' },
              { type: 'label', text: 'Too expensive', x: 84, y: 50, color: '#f59e0b' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 65, y: 64 },
            ],
          },
          {
            label: 'Go-Back Sale: Rita',
            caption:
              'Rita said "too expensive" earlier. With 7 names and flags everywhere, the social proof is overwhelming. She agrees to the original price. Go-Back closed. That\'s 8 sales from 1 cold start.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 21, y: 7 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 67 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 69, y: 23 },
              { type: 'label', text: 'Go Back (Rita)', x: 74, y: 23, color: '#dc2626' },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 63, y: 36 },
            ],
          },
          {
            label: 'The Cycle Restarts',
            caption:
              'Head to Julie\'s house to complete her lawn aeration, then start the entire Mushroom process over from her location. This is how top stars step 20 lawns in a day — one cold sale mushrooms into an entire street.',
            overlays: [
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 75, y: 31 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 66, y: 14 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 42, y: 43 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 83, y: 57 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 21, y: 7 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 67 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 79, y: 40 },
              { type: 'flag', src: `${STORAGE_BASE}/flag.png`, x: 69, y: 23 },
              { type: 'icon', src: `${STORAGE_BASE}/aerator-icon.png`, x: 56, y: 29 },
              { type: 'label', text: 'Start over from here!', x: 56, y: 22, color: '#22c55e' },
            ],
          },
        ],
      },
      {
        type: 'video',
        heading: 'Dave Wilkerson on Mushroom with a Name',
        description: 'Dave explains the Mushroom linking strategy in detail — how one cold sale mushrooms outward into an entire street of customers using names as your secret weapon.',
        youtubeId: 'cRgTNwCbw0o',
        note: 'These videos were recorded several years ago — prices mentioned may be outdated, but the concepts still apply 100%.',
      },
      {
        type: 'video',
        heading: 'Tilo McAllister on Eyes and Ears',
        description: 'Tilo breaks down the Eyes & Ears linking method — the highest-percentage sale type in the CPS system. When you see or hear a homeowner outside, STOP everything and go link.',
        youtubeId: 'cImSAtGbKjU',
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
  // MODULE 4 — Basic Sales Concepts (REWRITTEN — structured sections + videos + 10 Qs)
  // =====================================================================
  {
    module_id: 'module_04_sales_basics',
    order_index: 4,
    is_active: true,
    title: 'Basic Sales Concepts: Pricing, Pitching, and Closing',
    description:
      'Master the fundamental sales scripts and pricing strategies used by top CPS stars. Learn how to approach the door, navigate to the backyard, quote using the "Lawn Split," handle objections, and confidently close the deal.',
    lesson_content: '', // structured sections below
    lesson_sections: [
      {
        type: 'text',
        heading: 'The CPS Sales Process — Your Earning Engine',
        body: `A successful door-to-door pitch is fast, confident, and structured — this is your "shooting" practice. The CPS sales system is designed so that even a worker with developing scripts will succeed if they follow the systems and get to enough doors. But when you combine strong scripting with the 5 Steps and Linking systems, you become an unstoppable earning machine.

Your sales conversation should last 60 seconds to 5 minutes maximum. Time is money. Every extra minute you spend at a property before or after a sale is counterproductive — and the customer understands you need to get going. Be very polite but keep all conversation beyond the sale on point.`,
      },
      {
        type: 'video',
        heading: 'Dave Wilkerson on the Basic Script',
        description: 'Dave walks you through the core script structure that every CPS worker needs to master before hitting the route.',
        youtubeId: 'C-1wiX42wIE',
        note: 'These videos were recorded several years ago — prices mentioned may be outdated, but the concepts still apply 100%.',
      },
      {
        type: 'text',
        heading: 'Goal #1: Build Trust and Get to the Backyard',
        body: `Your first goal at the door is to gain the customer's trust and quickly direct the conversation toward the backyard. Introduce yourself, tell them exactly what you are doing on the street, and ask your first engaging question: "Have you ever had your lawn aerated before?"

Whether they confirm or need education, transition smoothly to your second question: "Which way is it to your backyard — left or right?" This is a powerful assumptive close technique. It bypasses a yes-or-no decision and physically moves the conversation toward the larger, more profitable backyard. Getting physical access to the backyard makes the full property sale highly probable.

Remember: you are interrupting a homeowner's day, so you need to quickly and effectively communicate that you have a solution to a problem they weren't thinking about. If you can get to the backyard, you've already won half the battle.`,
      },
      {
        type: 'video',
        heading: 'Getting Into the Backyard with Marco Morelli',
        description: 'Marco demonstrates the techniques for smoothly transitioning from the front door to the backyard — where the real money is. While this video was made for window cleaning, the exact same approach applies for aeration.',
        youtubeId: 'f161cP0wfW8',
      },
      {
        type: 'video',
        heading: 'Tilo McAllister on Maximizing Your Presentation',
        description: 'Tilo shares advanced tips for making your sales presentation irresistible — from body language to value building to creating urgency.',
        youtubeId: 'TJmGzew2SMs',
      },
      {
        type: 'text',
        heading: 'Goal #2: The "Lawn Split" Pricing Strategy',
        body: `Never quote a single massive number right away. Instead, use the "Lawn Split" strategy: pull out your Service Guide and break the price down into front and back.

Say: "Normally, the front is $60 and the back is $60. But since I'm already here doing the neighbour's property, I can do the front for $60 and give you the backyard for half off, making it just $90 for the whole property."

This negotiation tactic makes the pricing feel like an exclusive, time-sensitive deal. The customer feels like they're getting a special neighbourhood discount, which increases urgency and reduces price resistance.

You must absolutely adhere to the company's minimum pricing structures: the absolute minimum charge for the smallest front lawn is $50.00. The minimum for a front and back (like a small townhouse) is $60.00. Professionals aim higher — the average property should be billed at $80.00+. Do not undercharge large corner lots — these require more time and effort, so the minimum charge is $100.00+.`,
      },
      {
        type: 'text',
        heading: 'Supply and Demand — Adjusting Your Price to the Street',
        body: `Understanding basic supply and demand economics will make you a smarter seller. In the CPS context, the primary "supply" factor is you and your aerator on the street. "Demand" is expressed by homeowners purchasing the service.

If you're knocking for 30 minutes and you've lost 2–3 potential customers based on price, you have a problem. Maybe your value-building scripts are weak, or maybe there just isn't enough demand at your asking price. Use supply and demand to adapt.

Conversely, if you sell the first three homes on a new street for $60 with no resistance and neighbours are stopping you asking to be next — the demand is overwhelming and supply is limited to you. Raise your price to $80 and keep going. We use $3,000+ machinery and the service is easily worth more than $100. The reason we sometimes get a lower price is too much competition or weak salespeople.

When you're on a hot link with flags everywhere, you've created high demand and low supply. That's when you push the price up closer to what the service is actually worth.`,
      },
      {
        type: 'text',
        heading: 'Closing the Deal',
        body: `Closing involves securing the commitment and determining payment. Ask for the sale confidently with a simple phrase like "Sounds good?" while nodding your head. Let them know we accept Cash, Cheque, Credit Card, or E-Transfer. If they pay by cheque, ensure it is made payable exactly to "Canadian Property Stars."

As a legitimate Canadian business, you must charge HST on every single lawn. Do not offer "under the table" deals. Accurately complete the receipt and log sheet for every transaction.

When a customer is on the fence, use your link credibility: "John and Mary next door both just got it done, and I can extend the same neighbourhood deal to you since I'm already here." The combination of names, visible flags, and urgency is incredibly powerful.`,
      },
      {
        type: 'video',
        heading: 'Closing the Sale with Dave Wilkerson',
        description: 'Dave demonstrates proven closing techniques that turn "maybe" into "yes" — from creating urgency to handling the final objection.',
        youtubeId: 'cuFSilgE7UI',
      },
      {
        type: 'text',
        heading: 'Pre-Framing the Street and Handling Objections',
        body: `Pre-framing means setting up your sales environment before you even knock. When you flag a lawn and start aerating, every homeowner on the street sees and hears you working. The sound of the aerator, the sight of flags and cores on the lawn, and the knowledge that neighbours bought the service — these all pre-frame the next door you knock on.

Common objections and how to think about them: "Too expensive" — you haven't built enough value yet, or your pricing structure needs adjustment. "Not interested" — you may need to work on your opening approach. "I already have a service" — respect it, but mention that many customers use CPS for the convenience of same-day service. "Nobody home" — mark it and come back later as a Go-Back.

Think critically about where in the process you're losing prospects. Are you getting no's before the backyard? Work on your presentation. No's based on price? You're not building enough value or structuring pricing correctly. Work with your manager on a new approach.

Keep in mind: all of the top stars get no's every day! Some of the best workers in company history got the MOST no's on a regular basis — they just follow 5 Steps so consistently that they reach enough doors to make up for it.`,
      },
    ],
    quiz: [
      {
        question: 'What is the absolute minimum charge allowed for a small front lawn aeration?',
        options: ['$20.00', '$30.00', '$50.00', '$80.00'],
        correct_index: 2,
        explanation:
          'To maintain profitability and professional standards, the absolute minimum charge for even the smallest front lawn is $50.00.',
      },
      {
        question: 'What is the strategic purpose of asking "Which way is it to your backyard — left or right?"',
        options: [
          'To figure out where to park the aerator',
          'It assumes the sale and physically moves the conversation toward the larger, more profitable backyard',
          'To check if they have a dog',
          'To see if they have a gate lock',
        ],
        correct_index: 1,
        explanation:
          'This assumptive question bypasses a yes/no decision and smoothly advances the physical inspection of the property.',
      },
      {
        question: 'How should cheques be made payable?',
        options: [
          'To your personal name',
          'To "Cash"',
          'To "Canadian Property Stars"',
          'To your route manager',
        ],
        correct_index: 2,
        explanation:
          'All cheque payments must be made out directly to the official company name, Canadian Property Stars.',
      },
      {
        question: 'What is the "Lawn Split" pricing strategy?',
        options: [
          'Charging separately for the left and right sides',
          'Breaking the quote into front and back prices, then offering a discount on the back to incentivize the full property sale',
          'Physically dividing the lawn with flags',
          'Splitting the bill with the neighbour',
        ],
        correct_index: 1,
        explanation:
          'Splitting the price makes the total feel more digestible and highlights the discount they\'re receiving as a neighbourhood deal.',
      },
      {
        question: 'What is the minimum pricing rule for large corner lots?',
        options: [
          'Same price as standard lawns',
          'Heavily discounted to win the business',
          'Minimum $100+ because of the extra square footage',
          'Charge by the hour instead',
        ],
        correct_index: 2,
        explanation:
          'Corner lots have significantly more square footage and require more work — they must be priced at a minimum of $100+.',
      },
      {
        question: 'When should you raise your pricing above $60?',
        options: [
          'Never — always charge the same price',
          'When demand is high (no resistance, neighbours asking for service) and you\'re the only supply on the street',
          'Only when the manager tells you to',
          'When you\'re tired and want to go home early',
        ],
        correct_index: 1,
        explanation:
          'When supply is limited (just you) and demand is high (everyone wants the service), basic economics say the price should go up.',
      },
      {
        question: 'How long should a typical sales conversation last?',
        options: [
          '15 to 30 minutes',
          '60 seconds to 5 minutes maximum',
          'At least 20 minutes to build deep rapport',
          'As long as the customer wants to talk',
        ],
        correct_index: 1,
        explanation:
          'Time is money. A quick, confident pitch closes more deals than a drawn-out conversation, and the customer understands you need to keep moving.',
      },
      {
        question: 'What does "pre-framing the street" mean?',
        options: [
          'Building a picture frame for the customer',
          'The sound of the aerator, sight of flags, and cores on lawns set up your next sale before you even knock',
          'Framing photos of the street',
          'Pre-ordering materials for the job',
        ],
        correct_index: 1,
        explanation:
          'Pre-framing creates social proof — every visible sign of your work on the street makes the next homeowner more likely to say yes.',
      },
      {
        question: 'If you keep losing sales based on price, what should you do?',
        options: [
          'Get angry at the customers',
          'Always drop to the minimum price immediately',
          'Analyze whether your value-building is weak or pricing is wrong, and work with your manager on a new approach',
          'Stop selling and only aerate the lawns you already have',
        ],
        correct_index: 2,
        explanation:
          'Price resistance usually means you aren\'t building enough value or are structuring prices incorrectly — work with your manager to adjust.',
      },
      {
        question: 'Must you charge HST on every lawn service?',
        options: [
          'Only on large properties over $100',
          'Yes — as a legitimate Canadian business, HST is mandatory on every transaction',
          'No — you can offer "under the table" deals to win the sale',
          'Only when the customer asks for a receipt',
        ],
        correct_index: 1,
        explanation:
          'HST must be charged on every single lawn. Offering "under the table" deals is not permitted.',
      },
    ],
  },

  // =====================================================================
  // MODULE 5 — Your First Week (REWRITTEN — structured sections + 10 Qs)
  // =====================================================================
  {
    module_id: 'module_05_first_week',
    order_index: 5,
    is_active: true,
    title: 'Your First Week: 3 Goals for Rookie Success',
    description:
      'Prepare for your first week on the job by focusing on three clear, achievable goals. Learn how to "tie your skates," operate safely, handle early-day challenges, and master the basics of the route.',
    lesson_content: '', // structured sections below
    lesson_sections: [
      {
        type: 'text',
        heading: 'Welcome to Training Camp',
        body: `Your first week on the job is like a professional training camp. It's perfectly normal to feel nervous or overwhelmed by the physical work and the reality of sales rejection. To ensure you succeed, focus strictly on mastering the basics rather than worrying about breaking sales records. You are entering the Professional Aerating League, and you need to build a solid foundation.

The focus for your first week is to learn the basic systems: 5-Steps-to-High-Steps, Linking, machine training, and basic sales scripts. With these basic systems firmly in your toolbox, you will be able to start generating very good income. Set personal goals for the day, bring a great attitude, and give maximum effort.`,
      },
      {
        type: 'text',
        heading: 'Goal 1: "Skating" — Learn to Operate the Equipment',
        body: `Your first goal is Skating: learning how to safely and effectively operate the equipment. Whether you are using a core aerator or applying lawn rejuvenation products, spend your first few days focusing on machine control, turning, and loading or unloading safely.

Your machine is your livelihood — respect it, maintain it, and never cut corners on safety protocols. Once you can operate the machine effortlessly, your speed will naturally increase. Remember: your only two roles as a CPS contractor are selling or aerating. You are either trying to find a customer or you are servicing a customer. There is literally nothing else you do during the day.

If you ever have a machine breakdown, don't panic. Attempt to troubleshoot it yourself, then call your route manager. While your manager is on the way to fix it, set a goal for the number of sales you will have lined up before they arrive. A breakdown is never an excuse to stop working — it's an opportunity to pre-sell your next 2–3 lawns.`,
      },
      {
        type: 'text',
        heading: 'Goal 2: "Shooting" — Master the Basic Sales Script',
        body: `Don't worry about complex, advanced objection handling during your first week. Focus entirely on delivering a smooth, confident introduction and executing a proper "lawn split" price quote. Practice your pitch in the mirror and with your manager until the words flow naturally without sounding robotic.

The continuous learning mindset is what separates stars from one-season workers. CPS is all about adding to your toolbox. We realize that the more you can internalize the systems and psychology behind the game, the better you will become. But don't try to learn everything in week one — master the basic script first, then layer in advanced techniques as you gain confidence.

Many workers assume (wrongly) that once they've succeeded at the basic level, they don't need to keep learning. The truth is that even the top stars of CPS are constantly refining their approach. Every morning meeting is an opportunity to learn something new.`,
      },
      {
        type: 'text',
        heading: 'Goal 3: "Tying Your Skates" — Master the Paperwork',
        body: `Mastering the paperwork and daily procedures is what guarantees you get paid correctly for the physical work you've done. This means strictly following the 5 Steps, accurately filling out your daily log sheet, managing your 5 receipts and 2 upsell contracts, placing flags correctly, and understanding how your payout works at the end of the day.

Before you leave the shop, check your gear: 10 flags, 10 poles, your folder (with route map and log sheet), pouch, pen, and your knapsack with food and drinks. Ensure you are wearing your CPS shirt. Most importantly, communicate — never leave the route without authorization, and always work with your team for load-ins and load-outs.

Your All-Star Preparation checklist: Folder stocked with route map, log sheet, 5 receipts, and 2 upsell contracts. Sales glossy for your pitch. Pouch loaded for collecting cash and cheques. At least one working pen. Knapsack with food, drinks, sunscreen, extra socks, and rain gear if needed. 10 flags and 10 poles. CPS shirt on, clean and professional.

CPS uses a digital log sheet that you'll use every day on the route. You can practice with it right now in Training Mode — log in with username "training" and password "training" to access a sandbox log sheet loaded with sample prebooks. Try completing a job, logging a new sale, and reviewing your stats so you're comfortable before your first real day.`,
      },
      {
        type: 'text',
        heading: '🖥️ Try the Digital Log Sheet — Training Mode',
        body: `Ready to practice? The CPS Digital Log Sheet has a built-in Training Mode that lets you experience the full workflow without affecting any real data.

How to access it: Go to the Log Sheet section of the app and log in with username: training / password: training. You'll be loaded in as "Super Star" with pre-booked customers on a practice route (Wayne Gretzky, Sidney Crosby, Connor McDavid, and more). Practice completing prebooks, adding new cold sales, handling different payment types (Cash, Cheque, E-Transfer, Credit Card, Prepaid), and watch how your daily stats update in real time.

This is the exact same interface you'll use on the job — the only difference is that Training Mode uses sample data and resets when you log out. Get comfortable with it now so your first real day is smooth and stress-free.`,
        linkTo: '/logsheet',
        linkLabel: '📋 Open Digital Log Sheet',
      },
      {
        type: 'text',
        heading: 'Early Day Pains — Your Body Will Adjust',
        body: `If you've never worked with CPS before and haven't been extremely active coming up to the season, your body is in for a shock. Walking, jogging, or running with an aerator all day is incredibly taxing. Most workers find their first day or two are the most dreadful — old injuries surface, foot and knee aches appear, and general stiffness sets in. This is simply your body working its way into a groove.

Stay well-hydrated throughout the day and wear very good running shoes. Good running shoes provide the shock absorbers that prevent shin splints, knee pain, and foot issues as you rack up consecutive days. There's no way around developing blisters and stiffness, but the good news is that it's only temporary for workers who work 5 or more days per week.

If you're feeling beat up after your 1st or 2nd day — congratulations! You kicked your own ass! Just like with any sport, the best way to overcome stiffness is to get up and go after it again. Most workers remark that morning stiffness is completely gone by the time they finish their 1st or 2nd lawn. It just takes an elevated heart rate and a little adrenaline for the cobwebs to disappear.`,
      },
      {
        type: 'text',
        heading: 'Bad Weather Is Your Opportunity',
        body: `The reality of outdoor work in spring or summer is that you are at the mercy of the weather. You can look at bad weather in one of two ways: as a negative where you'll be wet, cold, and miserable — or as a positive because homeowners will be impressed by your hustle on a crappy day while your competition stays home.

Things to remember about bad weather: always check the forecast and pack a rain jacket, extra socks, bags to cover your socks, and a sweater. On cold and rainy days, the "equivalent bar" needed to win a chair lowers — increasing your odds if you bring your A-game. More people are actually home on bad weather days because families prefer to stay in. If you come to doors excited about the rain, explaining that wet days give even better tine penetration, you will impress homeowners. And the competition stays home — giving you a monopoly on the street.

Bad weather is an opportunity for workers who look at it correctly. Top CPS workers look forward to and prepare for cold and wet weather to maximize their paydays.`,
      },
      {
        type: 'text',
        heading: 'You Are Not Alone',
        body: `You might feel isolated working solo on your route, but remember: you are not alone. You drove out in a van with 10+ co-workers. Your location has multiple vans with more co-workers. Across the country, dozens of CPS vans are filled with fellow workers. You are part of the largest outdoor direct sales company in Canada.

The reason you work solo is because it's more profitable for you — splitting commission with a partner would cut your earnings in half. Your route manager is always just around the corner for safety, equipment checks, motivation, and sales training when needed.

If you're ever lonely out there, keep in mind that you're only a few doors away from a potential new friend — and at CPS, your new friends at the door will pay you for talking to them!`,
      },
      {
        type: 'text',
        heading: 'The Importance of Your 1st Step',
        body: `Your 1st step of the day is your most important step. The momentum from that first sale will propel you through the entire day if people are home and your linking is on the money. Even though we know it only takes about 3–4 hours of real aeration to get paid well, most workers get demoralized if they don't make a sale in the first hour or two.

You must decide when you get dropped off that you will maintain the same level of intensity at every door until you get that 1st sale. Since timeline is important to your mentality, there must be urgency in your voice. Be willing to give a homeowner a great deal if it's going to get you on a lawn and off a zero. Your first step is setting you up for a huge day — the homeowner should be rewarded for helping keep your mentality in check.

And your 2nd most important step? That's right — your 2nd step. Top stars immediately link from their first sale, while average workers can go 2–3 hours before finding sale #2. The difference? Mental pressure. Stars create pressure to continually get more steps — no number is ever enough. Average workers create pressure around money, so once they have some "in the bank," they release the pressure and results drop. Focus on scoring more steps, not on the money, and the money will follow.`,
      },
    ],
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
          'Safety and basic operational competence are the foundation you need before you can focus on speed and selling.',
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
          'Mastering administrative and procedural tasks ensures you stay organized and get paid accurately.',
      },
      {
        question: 'What should you do if your aerator breaks down on the route?',
        options: [
          'Sit down and wait for your manager',
          'Go home for the day',
          'Try to fix it yourself, call your manager, then canvass for sales while waiting for repair',
          'Ask a homeowner to fix it',
        ],
        correct_index: 2,
        explanation:
          'Your only two jobs are selling and aerating. If you can\'t aerate, you should be selling. A breakdown is never an excuse to stop working.',
      },
      {
        question: 'Why should bad weather excite you as a CPS worker?',
        options: [
          'Because you can go home early',
          'Because competitors stay home, more people are inside to answer doors, and the bar to win a chair is lower',
          'Because the aerator works better in snow',
          'Because managers cancel morning meetings',
        ],
        correct_index: 1,
        explanation:
          'Bad weather gives you a monopoly on the street, more people home, lower competition for chairs, and impressed homeowners.',
      },
      {
        question: 'Why is your 1st step of the day the most important?',
        options: [
          'Because it\'s always the most expensive lawn',
          'Because the momentum from your first sale propels you through the entire day and sets your mentality',
          'Because your manager only checks on you once',
          'Because the first lawn is always the easiest',
        ],
        correct_index: 1,
        explanation:
          'Getting off zero early prevents the mentality drop that stalls many workers. The first step sets up your linking system for the whole day.',
      },
      {
        question: 'What separates stars from average workers after the 1st sale?',
        options: [
          'Stars take a break to celebrate',
          'Stars focus on money and relax once they have some "in the bank"',
          'Stars create pressure to keep scoring more steps — no number is ever enough — while average workers release pressure once they have income',
          'Stars switch to a different route',
        ],
        correct_index: 2,
        explanation:
          'Stars maintain "morning energy" all day by focusing on step count rather than money. Average workers ease up once they have income secured.',
      },
      {
        question: 'How many flags and poles should you have before leaving the shop?',
        options: [
          '5 flags / 5 poles',
          '10 flags / 10 poles',
          '50 flags / 50 poles',
          '0 flags / 0 poles',
        ],
        correct_index: 1,
        explanation:
          'Standard daily preparation requires 10 flags and 10 poles ready to mark completed and upcoming lawns.',
      },
      {
        question: 'How should you handle body soreness after your first or second day?',
        options: [
          'Take the rest of the week off to recover',
          'Get up and go after it again — morning stiffness disappears after your 1st or 2nd lawn from elevated heart rate and adrenaline',
          'Switch to a desk job within CPS',
          'Only work half days until it passes',
        ],
        correct_index: 1,
        explanation:
          'The best cure for stiffness is to work through it. Consecutive days help your body adapt — taking days off actually makes it worse.',
      },
      {
        question: 'What should you do while waiting for your manager to fix a broken aerator?',
        options: [
          'Sit down and wait',
          'Go home for the day',
          'Canvass for sales so you have lawns lined up when the machine is back online',
          'Walk to the nearest coffee shop',
        ],
        correct_index: 2,
        explanation:
          'Your only two jobs are selling and aerating. If you can\'t aerate, you should be selling. Use the downtime to pre-sell your next several lawns.',
      },
      {
        question: 'Why should you work as many consecutive days as possible?',
        options: [
          'Because the company requires it',
          'Because your body adapts, your confidence builds, and momentum from linking carries into the next day',
          'Because you only get paid on consecutive days',
          'Because the weather is always better on consecutive days',
        ],
        correct_index: 1,
        explanation:
          'Working consecutive days builds physical endurance, sharpens your scripts, and maintains the mental momentum that drives high step counts.',
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