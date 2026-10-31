// src/mainstreetai/content.ts — the words on the Main Street AI website, from the company's own document
// (Main_Street_AI.docx). Edit here to change the site; the page lays out whatever is here.

export const COMPANY = {
  name: 'Main Street AI',
  legal: 'Main Street AI, a division of 6260942 Canada Ltd.',
  address: ['1475 Star Top Road, Unit 4', 'Ottawa, ON'],
  email: 'mainstreetai@propertystars.app',
  tagline: 'Smart tools. Real business growth.',
};

export const MISSION =
  'To empower Main Street businesses with the world’s most powerful and effective AI tools, maximizing productivity, streamlining operations, reducing costs, and accelerating profitability.';

export interface Person { name: string; role: string; lead: string; highlight: string; bio: string[]; close: string[] }

export const TEAM: Person[] = [
  {
    name: 'Ben Stewart',
    role: 'Founder & Chief Executive Officer',
    lead: 'A Canadian entrepreneur, business leader, and 17-time World Karate and Kickboxing Champion, Ben Stewart brings more than 30 years of entrepreneurial experience, an unwavering competitive spirit, and a lifelong passion for helping small businesses succeed.',
    highlight: '17-time World Karate and Kickboxing Champion, Team Canada',
    bio: [
      'Throughout his career, Ben has built and operated businesses across a diverse range of industries, including fitness, martial arts, landscaping, property maintenance, business education, and real estate. His entrepreneurial journey has given him a firsthand understanding of the challenges, opportunities, and relentless determination required to build a successful business.',
      'At the heart of his entrepreneurial philosophy is a deep appreciation for the small, independently owned businesses that form the backbone of our communities — the businesses that line the Main Streets of the towns and cities we call home.',
      'As artificial intelligence rapidly transforms the global business landscape, Ben believes small business owners are facing one of the greatest opportunities — and challenges — of their generation. Businesses that embrace AI technology, intelligent automation, and operational innovation can unlock extraordinary improvements in productivity, efficiency, cost savings, and profitability. Those that fail to adapt risk being left behind.',
      'As a 17-time World Karate and Kickboxing Champion representing Team Canada, Ben knows what it takes to compete, overcome adversity, and WIN. That same championship mindset is now driving his latest entrepreneurial mission.',
      'Together with an exceptional team of AI business consultants and technology specialists, Ben founded Main Street AI with one clear purpose: to empower Main Street business owners with the tools, technology, and competitive advantage they need to not only survive the AI revolution — but to compete, thrive, and WIN!',
    ],
    close: ['Because Main Street businesses deserve a fighting chance — and Main Street AI is in their corner!'],
  },
  {
    name: 'Vijay Baskaran',
    role: 'Vice President, AI Tool Development',
    lead: 'For the past 17 years, Vijay Baskaran has been an integral part of the growth, innovation, and success of Main Street AI’s parent company, Canadian Property Stars.',
    highlight: 'Reverse-engineered 30 years of business operations into one AI-powered app',
    bio: [
      'Beginning his career as a field technician, Vijay advanced through the ranks into sales management and ultimately General Manager, developing an extraordinary understanding of the company’s operations, systems, challenges, and opportunities along the way.',
      'Then, in 2025, something remarkable happened. Armed with nearly two decades of firsthand operational knowledge and the emerging power of artificial intelligence, Vijay accomplished what few would have imagined possible. He reverse-engineered 30 years of established business operations and developed a comprehensive, AI-powered, end-to-end Business Management Application that transformed how Canadian Property Stars operates.',
      'The results have been extraordinary. His innovative platform has revolutionized the company’s daily operations, automating administrative processes, streamlining workforce management, eliminating outdated paper-based systems, and delivering hundreds of thousands of dollars in annual savings through reduced staffing, administration, printing costs, and countless hours of previously manual work.',
      'What began as a bold technological experiment revealed something even more exciting — Vijay possessed a rare, almost unicorn-like talent for combining deep business knowledge with the extraordinary capabilities of artificial intelligence.',
      'Today, as Vice President of AI Tool Development at Main Street AI, Vijay is channeling that remarkable ability into an ambitious new mission: developing industry-specific, AI-powered Business Operations Applications designed to help small and medium-sized businesses achieve similar transformations. By simplifying complex operations, automating repetitive tasks, reducing operating expenses, and unlocking new efficiencies, these innovative applications are being designed with one ultimate objective: to help Main Street businesses operate smarter, spend less, and become dramatically more profitable.',
      'With an exciting portfolio of industry-specific applications currently in development and preparing for launch, the future is incredibly bright. The entire Main Street AI team is proud to have this exceptional innovator leading our AI Tool Development division, and we cannot wait to introduce his groundbreaking technology to business owners across Main Street!',
    ],
    close: ['From transforming one 30-year-old company to helping revolutionize thousands of businesses — Vijay Baskaran is just getting started!'],
  },
];

export const PARTNER = {
  name: 'Taxifi.ai',
  title: 'Revolutionizing bookkeeping & accounting through the power of artificial intelligence',
  intro: [
    'At Main Street AI, we’re on a relentless mission to discover, develop, and deliver the most powerful AI-enhanced business solutions available. Whether it’s an innovative application developed by our own technology team or a groundbreaking service created by one of our strategic partners, our objective remains the same: help Main Street businesses work smarter, eliminate inefficiencies, reduce operating expenses, and maximize profitability!',
    'And when it comes to delivering immediate, measurable savings to business owners, we’re incredibly excited to introduce our flagship strategic partner: Taxifi.ai.',
  ],
  storyTitle: 'A partnership built on trust, experience & innovation',
  story: [
    'Our relationship with Taxifi founder and CEO, David DiNardo, goes back more than a decade. David’s successful cloud-based accounting firm served as the accounting provider for Main Street AI founder Ben Stewart’s businesses for over 10 years, establishing a longstanding professional relationship built on trust, reliability, and results.',
    'After successfully selling his cloud-based accounting firm in 2022, David set out to revolutionize the bookkeeping and accounting industry by combining his extensive financial expertise with the extraordinary capabilities of artificial intelligence. The result was Taxifi.ai — an innovative, AI-enhanced bookkeeping and accounting service designed for the modern business owner.',
  ],
  howTitle: 'The best of both worlds: AI automation + real accountants',
  howIntro: [
    'Every business owner understands the importance of accurate bookkeeping, timely financial reporting, and professional accounting services. Unfortunately, traditional bookkeeping can also be time-consuming, labour-intensive, expensive, and often weeks behind the actual financial activity of a business.',
    'Taxifi.ai is changing that equation. By combining AI-powered bookkeeping automation with the oversight and expertise of qualified accounting professionals, Taxifi.ai delivers a smarter, faster, and more cost-effective approach to managing business finances.',
  ],
  how: [
    { title: 'AI-powered daily bookkeeping', text: 'Intelligent AI agents automate routine bookkeeping processes, helping keep your financial records updated on an ongoing basis.' },
    { title: 'Real-time financial visibility', text: 'Gain more timely insight into your company’s financial performance instead of waiting weeks for traditional bookkeeping reports.' },
    { title: 'Human professional oversight', text: 'Real accounting professionals review and verify the work performed by AI and manage applicable monthly and annual reporting and filing requirements.' },
    { title: 'Reduced accounting costs', text: 'By automating a substantial portion of traditionally manual bookkeeping tasks, Taxifi.ai can deliver significant cost efficiencies compared with conventional service models.' },
    { title: 'More time to grow your business', text: 'Spend less time worrying about bookkeeping and more time doing what you do best — running and growing your company!' },
  ],
  whyTitle: 'Why Main Street AI chose Taxifi.ai',
  why: [
    'At Main Street AI, we don’t believe in promoting technology simply because it’s new or exciting. We believe in promoting AI solutions that deliver real, measurable financial benefits to business owners.',
    'With David DiNardo’s proven entrepreneurial track record, his team’s accounting expertise, and Taxifi.ai’s innovative automation technology, we believe this partnership represents exactly what Main Street AI was created to accomplish.',
    'For Canadian small business owners, bookkeeping and accounting are essential operating expenses. If we can help those same businesses receive reliable professional services, gain faster access to their financial information, and potentially save thousands of dollars annually, that’s a genuine competitive advantage.',
  ],
  motto: 'Same essential business function. Smarter technology. Greater efficiency. Lower potential costs.',
};

export const QUOTE = {
  title: 'Discover how much your business could save',
  text: [
    'Are you a Canadian business owner wondering how much you’re currently overspending on bookkeeping and accounting?',
    'Our Main Street AI business consultants can help you explore whether Taxifi.ai is the right solution for your company and provide a personalized savings quote based on your current accounting needs.',
  ],
  push: 'Stop overpaying for yesterday’s bookkeeping technology. Discover the power of AI-enhanced accounting today!',
  button: 'Request my free savings quote',
  small: 'No obligation. Discover your potential savings and see how AI-powered bookkeeping could transform your business.',
  /** What they spend now, roughly (helps the consultant prepare the quote). */
  spend: ['Under $200 a month', '$200–$500 a month', '$500–$1,000 a month', 'Over $1,000 a month', 'Only at year end', 'Not sure'],
};

export const PILLARS = ['Automation', 'Efficiency', 'Cost savings', 'Higher profits'];
