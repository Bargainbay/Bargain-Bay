// The Business Development Sales Toolkit (Drive: "RS Solutions – Business
// Development Sales Toolkit"), as data. NO IMPORTS. The wording is the owner's;
// change it here and the Resources page follows. Merge fields: {first_name}
// {company} {rep_name} {rep_phone} (see mergeTemplate in lib/lead-rules.js).

export const PITCH =
  'RS Solutions is a one-stop appliance and logistics partner for the GTA. We repair, maintain, install, deliver and liquidate appliances, and we build AI automations that save businesses time, all under one roof.';

export const TARGETS = [
  { who: 'Property management companies', offers: 'Repair and maintenance contracts, installs, appliance supply for units', hook: 'One vendor for every unit turnover, fast response, volume pricing' },
  { who: 'Real estate firms and realtors', offers: 'Appliance staging, installs, delivery, move-in services', hook: 'Make listings move-in ready fast; referral rewards for agents' },
  { who: 'Retailers and appliance stores', offers: 'Liquidation (list stock on Bargain Bay), delivery and install outsourcing', hook: 'Turn returns, scratch-and-dent and overstock into cash' },
  { who: 'Resellers and flippers', offers: 'Reseller accounts on the website', hook: 'Pick units for their clients at dealer pricing' },
  { who: 'Logistics and delivery companies', offers: 'AI delivery tracking systems, overflow delivery capacity', hook: 'Fewer "where is my order" calls, more capacity without new trucks' },
  { who: 'Contractors, builders, renovators', offers: 'Bulk appliance supply, delivery and install', hook: 'On-schedule delivery and install for each project' },
  { who: 'Any growing business', offers: 'Custom AI integrations and automations', hook: 'Automate quoting, follow-ups, inventory and customer service' },
  { who: 'Anyone with a network', offers: 'Affiliate and referral program', hook: 'Earn for every client they send' }
];

export const COLD_CALL =
  'Hi {first_name}, it is {rep_name} from RS Solutions. We work with property managers across the GTA on appliance repairs, installs and replacements, so you have one call for every unit. Quick question: who handles your appliance issues right now, and how fast do they show up?\n\nThen: listen, find the pain (slow response, too many vendors, cost), and ask for a 15-minute meeting or a trial job.';

export const EMAIL_TEMPLATES = [
  { key: 'property', title: 'Property managers', subject: 'One vendor for every appliance in your buildings',
    body: 'Hi {first_name}, RS Solutions handles appliance repair, maintenance, installation and replacement for GTA properties, with our own technicians, trucks and inventory. Property managers use us to cut vendor count and speed up unit turnovers. Could we do a 15-minute call this week? We can start with a single trial job so you can see our response time. – {rep_name}, RS Solutions' },
  { key: 'retail', title: 'Retailers (liquidation)', subject: 'Turn your returns and overstock into cash',
    body: 'Hi {first_name}, we help retailers clear returned, scratch-and-dent and overstock appliances through our Bargain Bay outlet and website. You list it, we handle the selling, delivery and install. Open to a quick call to see if it fits? – {rep_name}' },
  { key: 'realtor', title: 'Realtors', subject: 'Move-in ready listings, faster',
    body: 'Hi {first_name}, RS Solutions supplies, delivers and installs appliances for listings and new buyers across the GTA, and we reward agents for referrals. Want me to send our referral details? – {rep_name}' },
  { key: 'reseller', title: 'Resellers', subject: 'Dealer pricing on appliances for your clients',
    body: 'Hi {first_name}, our reseller program gives you access to our live appliance inventory at dealer pricing, with delivery available. Want me to set you up with an account? – {rep_name}' },
  { key: 'ai', title: 'AI services', subject: 'Automate the busywork in your business',
    body: 'Hi {first_name}, we build AI systems for businesses like yours, from delivery tracking to automated quotes and customer follow-ups. We run them in our own operations every day. Worth a 15-minute demo? – {rep_name}' },
  { key: 'followup', title: 'Follow-up (send 3 days later)', subject: 'Following up',
    body: 'Hi {first_name}, just bumping this up. Happy to start small with one trial job or a quick demo. Does Tuesday or Thursday work? – {rep_name}' }
];

export const OBJECTIONS = [
  { says: 'We already have a vendor.', reply: 'Makes sense. Most clients keep theirs at first and use us as a backup for urgent jobs. Can we be your second call?' },
  { says: 'Too expensive.', reply: 'Let us look at the full cost, including wait times and repeat visits. A trial job will show you the difference.' },
  { says: 'Not right now.', reply: 'No problem. When does your next unit turnover or busy season start? I will check in then.' },
  { says: 'Send me info.', reply: 'Will do. What is the one thing you would most want fixed so I send the right thing?' }
];

export const PIPELINE_NOTE =
  'New lead → Contacted → Conversation → Meeting booked → Proposal sent → Won (paid) → Repeat/upsell. Commission counts only once the client has paid.';

export const WEEKLY_CHECKIN =
  'Every Friday: review touches, meetings, proposals, Collected Sales vs the $37,500 weekly pace, top 5 deals, and blockers.';
