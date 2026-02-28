// src/lib/trainingModules.ts
// Hardcoded training module content - single source of truth
// No database needed for content. Add modules here to make them available globally.

export type Region = 'West' | 'Central' | 'East';

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface TrainingModule {
  module_id: string;        // Stable unique ID - never change once live
  title: string;
  description: string;
  lesson_content: string;   // Paragraphs separated by \n\n
  quiz: QuizQuestion[];
  region?: Region;          // undefined = show to all regions
  order_index: number;      // Display order
  is_active: boolean;
}

export const TRAINING_MODULES: TrainingModule[] = [
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

  {
    module_id: 'module_02_high_steps',
    order_index: 2,
    is_active: true,
    title: '5 Steps to High Steps: Maximizing Your Daily Sales Efficiency',
    description:
      'Learn the vital speed, efficiency, and safety techniques that will allow you to visit up to five times more homes every day. Master these rules to skyrocket your daily step count.',
    lesson_content: `In our business, 'steps' mean sales. The more lawns you complete, the higher your daily payout will be. The '5 Steps to High Steps' system is designed to maximize the number of doors you knock on and the lawns you complete, without even needing advanced sales skills. By simply moving faster and working smarter, you can dramatically increase your earning potential.

The first three steps are all about reaching more doors and maximizing your physical speed on the route. First, 'Run All Day': literally run or jog lightly between houses instead of walking. This alone helps you hit three times as many doors. Second, use the 'Horseshoe Method' by cutting straight across the lawn to the neighbour's door instead of walking down the driveway and up the next. Third, apply the '10-Second Rule': after ringing the doorbell, wait and listen for a maximum of 10 seconds. If you don't hear footsteps or activity inside, move on immediately to avoid wasting time.

The final two steps optimize your time during the actual service. 'Aerate Efficiently' means learning to manoeuvre the equipment using smooth curves and smart strategies to finish a standard lawn in 15 to 20 minutes. Just as importantly, practice 'No Long-Term Relationships.' You are a lawn care professional, not a conversationalist. Keep your interactions friendly but brief. Spending an extra 15 minutes chatting with a friendly customer means you just missed out on your next sale.

Beyond speed, you must operate safely and responsibly to protect your earnings. Always keep your eyes on your machine—never leave it unattended on the street or sidewalk. When aerating, you must stay exactly 18 inches away from all fixed objects (sprinklers, lights, walkway edges). The rule is simple: if you break it, you pay for it! Finally, never leave your assigned route to meet up with a co-worker; stay in your zone and maximize your time.

Efficiency also applies to the start and end of your day. All staff must help with loading and unloading the machines. Teamwork during drop-off and pick-up makes the process quick and smooth for everyone. Make sure to place a company flag in every completed lawn at the street beside the driveway, and always return any extra flags to the stock bins before leaving the shop.`,
    quiz: [
      {
        question: 'What is the "Horseshoe Method"?',
        options: [
          'A game played during lunch breaks',
          'Cutting directly across the lawn to the neighbour\'s door instead of using the sidewalk',
          'Walking in a wide circle around the property',
          'Leaving a horseshoe on the porch for good luck',
        ],
        correct_index: 1,
        explanation:
          'Cutting across the lawn saves valuable seconds at every house, adding up to massive time savings.',
      },
      {
        question:
          'How far must you keep the aerator away from fixed objects like sprinklers and lights?',
        options: ['6 inches', '12 inches', '18 inches', '3 feet'],
        correct_index: 2,
        explanation:
          'Staying 18 inches away from fixed objects is mandatory to prevent property damage, which you would be responsible for paying.',
      },
      {
        question: 'What is the "10-Second Rule"?',
        options: [
          'You must complete a pitch in 10 seconds',
          'Wait a maximum of 10 seconds at the door after knocking before moving on',
          'Run to the next house in under 10 seconds',
          'You have 10 seconds to start the machine',
        ],
        correct_index: 1,
        explanation:
          'The 10-second rule ensures you don\'t waste time waiting at empty houses.',
      },
      {
        question:
          'What must you do to clearly mark a completed job for the neighbourhood to see?',
        options: [
          'Spray paint the curb',
          'Place a company flag in the lawn at the street beside the driveway',
          'Leave a business card taped to the mailbox',
          'Yell that the job is done',
        ],
        correct_index: 1,
        explanation:
          'Placing a flag at the street acts as physical proof of your service and serves as marketing for the rest of the neighbourhood.',
      },
      {
        question:
          'What is the policy regarding your equipment when you are knocking on doors?',
        options: [
          'Leave it running on the sidewalk',
          'Keep your eyes on your machine and never leave it alone',
          'Ask a neighbour to watch it',
          'Hide it behind a bush',
        ],
        correct_index: 1,
        explanation:
          'Machines are expensive and vital to your job; they must never be left unattended or out of sight.',
      },
    ],
  },

  {
    module_id: 'module_03_linking',
    order_index: 3,
    is_active: true,
    title: 'Basic Linking Strategies: The Power of the Neighbourhood',
    description:
      'Master the "passing" game of sales. Learn how to use linking, the "Mushroom with a Name" strategy, and situational awareness to dominate an entire street.',
    lesson_content: `Selling 'cold' at the door can be tough because the homeowner doesn't know you or your company. But what if you told them that you're already taking care of their neighbour's lawn? This is called 'linking.' By referencing the neighbours you are already working for, you build instant credibility. Homeowners love to follow the crowd; if everyone else is getting an aeration or overseeding, they won't want to miss out on the street deal. This is what we call 'passing'—setting yourself up for an easy goal.

The absolute foundation of linking is the 'Mushroom with a Name' strategy. Once you get your first cold sale (or complete a pre-booked job), ask the customer for their first name and the names of their immediate neighbours. When you knock on the neighbour's door, say, 'Hi! I'm just next door doing a core aeration for John, and since I'm already here, I can give you the same street deal.' This dramatically lowers their guard, builds immediate trust, and makes the sale five times easier.

To become a top earner, your situational awareness must be flawless. We call this 'Eyes & Ears'—and it trumps everything else on the route. Always be observant. If you hear a garage door opening, see a car pulling into a driveway down the street, or spot someone walking their dog, pause your work immediately. Approach them confidently using the names of the neighbours you've gathered. Striking while the iron is hot is the easiest way to secure impulse sales.

As the afternoon turns into evening, you must execute your 'Go Backs.' These are the doors you knocked on earlier where nobody was home. When you return between 5:00 PM and 7:00 PM, you aren't just a cold knocker anymore. You now have a list of names. You can confidently drop the names of 4 or 5 neighbours who already bought the service that day. This creates massive social proof and urgency.

To effectively manage all this linking, you must stay organized. Always carry your company folder with your route map and log sheet. Keep 5 receipts and 2 upsell contracts ready in the folder, along with your sales glossy. Keep your pouch loaded and have at least one working pen. By keeping your tools organized, you can quickly jot down neighbour names and transition seamlessly from one linked sale to the next.`,
    quiz: [
      {
        question: 'What is the "Mushroom with a Name" strategy?',
        options: [
          'Selling organic mushroom compost to clients',
          'Asking a new customer for their name and their neighbours\' names to use at the next doors',
          'Finding a mushroom on the lawn and showing it to the customer',
          'A special technique for aerating around fungi',
        ],
        correct_index: 1,
        explanation:
          'Gathering names from a confirmed customer allows you to "mushroom" your sales outward to surrounding houses by dropping names.',
      },
      {
        question: 'What does "Eyes & Ears" refer to on the route?',
        options: [
          'Wearing safety goggles and earplugs while operating machinery',
          'Highly observant situational awareness, like spotting cars pulling in or people walking dogs',
          'Staring at the homeowner while they speak',
          'Listening to music while walking between houses',
        ],
        correct_index: 1,
        explanation:
          'Eyes & Ears means staying hyper-alert to your surroundings to spot immediate sales opportunities.',
      },
      {
        question:
          'When executing a "Go Back" later in the day, what is your primary advantage?',
        options: [
          'You are more rested',
          'You can drop the names of multiple neighbours who have already purchased the service that day',
          'The machinery is already warmed up',
          'You can offer the service for free',
        ],
        correct_index: 1,
        explanation:
          'Going back to unanswered doors with a list of participating neighbours provides massive social proof.',
      },
      {
        question: 'What should be kept in your daily folder to stay organized?',
        options: [
          'Your lunch and water bottle',
          'Route map, log sheet, 5 receipts, 2 upsell contracts, and a sales glossy',
          'Personal magazines and a novel',
          'Spare parts for the aerator',
        ],
        correct_index: 1,
        explanation:
          'Keeping these specific administrative items in your folder ensures you are always ready to close a sale and log it correctly.',
      },
      {
        question: 'Why does linking work so effectively?',
        options: [
          'It forces the customer to sign a legal contract',
          'It builds instant credibility and leverages the psychological desire to not miss out on a neighbourhood deal',
          'It allows you to bypass the sales pitch entirely',
          'It confuses the homeowner into saying yes',
        ],
        correct_index: 1,
        explanation:
          'People trust their neighbours; mentioning a neighbour proves you are legitimate and creates a fear of missing out.',
      },
    ],
  },

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