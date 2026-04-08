export type Persona =
  | "dog_sitter"
  | "childcare"
  | "house_sitter"
  | "overnight_guest"
  | "long_term_guest"
  | "relative";

export interface EvalQuestion {
  id: string;
  persona: Persona;
  question: string;
  keyFacts: string[];
  antiHallucinations?: string[];
  sourceDoc: string;
}

export const QUESTIONS: EvalQuestion[] = [
  // ── Dog Sitter ──────────────────────────────────────────────

  {
    id: "dog-feeding",
    persona: "dog_sitter",
    question: "How much do I feed Luna and when?",
    keyFacts: [
      "Twice a day at 7:00am and 5:30pm",
      "1.5 cups of dry food per meal",
      "Blue Buffalo brand from the pantry bottom shelf",
      "Add pumpkin puree with dinner (canned, in the fridge)",
    ],
    antiHallucinations: [
      "Luna eats wet food",
      "Luna eats once a day",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "dog-walk-route",
    persona: "dog_sitter",
    question: "Where should I walk Luna and for how long?",
    keyFacts: [
      "Morning walk: 20-30 minutes, ideally before 8am",
      "Evening walk: 15-20 minutes after dinner",
      "Route: left on Ash, up to Sunnyside Park, loop around, come back",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "dog-skateboard",
    persona: "dog_sitter",
    question: "Luna is going crazy barking at something on our walk. What's going on?",
    keyFacts: [
      "She barks at skateboards and scooters",
      "It's not aggression, she just doesn't understand wheels",
      "Redirect her attention and keep walking",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "dog-thunder",
    persona: "dog_sitter",
    question: "There's a thunderstorm and Luna is shaking. What should I do?",
    keyFacts: [
      "She gets nervous during thunderstorms",
      "Let her be near you — she just wants company",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "dog-couch",
    persona: "dog_sitter",
    question: "Luna keeps trying to get on the couch. Is that allowed?",
    keyFacts: [
      "She is NOT allowed on the couch",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "dog-meds",
    persona: "dog_sitter",
    question: "Does Luna take any medications?",
    keyFacts: [
      "Monthly heartworm/flea chew on the 1st of each month",
      "The box is in the pantry next to her food",
      "No other current medications",
    ],
    sourceDoc: "Pets",
  },

  // ── Cat ──────────────────────────────────────────────────────

  {
    id: "cat-feeding",
    persona: "dog_sitter",
    question: "What about the cat? How do I feed Mochi?",
    keyFacts: [
      "Twice a day, morning and evening",
      "1/4 cup dry food (Purina) plus one small can of wet food (Fancy Feast)",
      "Food and water on the counter in the laundry room",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "cat-escape",
    persona: "dog_sitter",
    question: "Can Mochi go outside?",
    keyFacts: [
      "She is indoor-only",
      "Do not let her outside",
      "She'll try to dart out when you open the front door",
      "Block her with your foot",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "cat-hiding",
    persona: "house_sitter",
    question: "I haven't seen the cat all day. Is she okay?",
    keyFacts: [
      "She's shy with strangers — she'll hide for the first day or two",
      "That's normal",
      "Leave food and water out, she'll eat when you're not looking",
    ],
    sourceDoc: "Pets",
  },

  // ── Childcare ───────────────────────────────────────────────

  {
    id: "noa-allergy",
    persona: "childcare",
    question: "Does Noa have any allergies I should know about?",
    keyFacts: [
      "Peanut allergy — this is serious",
      "No peanuts, no peanut butter, no foods processed in a facility with peanuts",
      "Check labels",
      "EpiPen in the front pocket of the red backpack by the front door",
      "Second EpiPen in the medicine cabinet upstairs",
      "If reaction: use EpiPen, call 911, then call parents",
    ],
    antiHallucinations: [
      "Eli has a peanut allergy",
      "Noa is allergic to shellfish",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "eli-bedtime",
    persona: "childcare",
    question: "What's Eli's bedtime routine?",
    keyFacts: [
      "8:00pm start routine, 8:30pm lights out",
      "Brush teeth, pajamas, pick a book, read",
      "He'll try to negotiate more time — be friendly but firm",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "noa-bedtime",
    persona: "childcare",
    question: "How do I put Noa to bed?",
    keyFacts: [
      "7:00pm start routine, 7:30pm asleep",
      "Bath every other night",
      "Brush teeth, 2 stories, Twinkle Twinkle song",
      "Sound machine on (the Hatch)",
      "She needs her stuffed elephant Ellie",
    ],
    antiHallucinations: [
      "Noa's bedtime is 8:30",
      "Eli needs a sound machine",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "noa-water-call",
    persona: "childcare",
    question: "Noa keeps calling out saying she needs water after I put her to bed. What do I do?",
    keyFacts: [
      "She has a water cup by her bed",
      "She doesn't actually need water",
      "One reassurance visit is fine, then let her settle",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "eli-screen-rules",
    persona: "childcare",
    question: "Can Eli use his iPad? What are the rules?",
    keyFacts: [
      "1 hour on school days, 2 hours on weekends",
      "His iPad has the blue case — NOT the living room iPad",
      "Allowed: PBS Kids, math games, Minecraft",
      "Not allowed: YouTube unsupervised, social media, buying in apps",
      "Homework before screens",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "noa-screen-rules",
    persona: "childcare",
    question: "Can Noa watch TV?",
    keyFacts: [
      "30 minutes max per day",
      "Allowed: Daniel Tiger, Bluey, Sesame Street",
      "On the living room TV via Roku",
    ],
    antiHallucinations: [
      "Noa has her own iPad",
      "Noa can watch YouTube",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "eli-school-pickup",
    persona: "childcare",
    question: "What time do I pick Eli up from school?",
    keyFacts: [
      "2:45pm at the front entrance on Orange St",
      "Wednesday is early release — pick up at 1:30pm",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "noa-preschool",
    persona: "childcare",
    question: "Where does Noa go to school and what time?",
    keyFacts: [
      "Little Sprouts Preschool, 1920 SE Belmont St",
      "Hours: 8:30am to 12:30pm (half day)",
      "Pick up at 12:30",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "lunch-separate",
    persona: "childcare",
    question: "What should I make the kids for lunch?",
    keyFacts: [
      "Eli: PB&J or mac and cheese (Annie's boxes)",
      "Noa: cheese quesadilla cut into triangles, or turkey and cheese roll-ups",
      "Make Noa's lunch separately — no peanut butter near her food",
      "Wash hands between making their lunches",
    ],
    antiHallucinations: [
      "Both kids can eat peanut butter sandwiches",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },
  {
    id: "eli-soccer",
    persona: "childcare",
    question: "Does Eli have any after-school activities?",
    keyFacts: [
      "Soccer practice Tuesdays and Thursdays, 4:00-5:15pm",
      "Sewallcrest Park",
      "Shin guards and cleats in the mudroom",
    ],
    sourceDoc: "Kids - Routines and Rules",
  },

  // ── House Sitter ────────────────────────────────────────────

  {
    id: "wifi-password",
    persona: "house_sitter",
    question: "What's the WiFi password?",
    keyFacts: [
      "Network name: CastilloPark-5G",
      "Password: sunflower2024",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "alarm-code",
    persona: "house_sitter",
    question: "How do I use the alarm system?",
    keyFacts: [
      "SimpliSafe system, keypad by the front door",
      "Code to disarm: 4821",
      "Away mode when everyone leaves",
      "Home mode at night (doesn't trigger motion sensors)",
      "If it goes off accidentally, enter the code, then verbal password 'maple' when they call",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "thermostat",
    persona: "house_sitter",
    question: "How do I adjust the temperature?",
    keyFacts: [
      "Ecobee thermostat controlled through the Home app",
      "Use the iPad on the wall by the kitchen entrance",
      "Tap Climate or find the Ecobee tile",
      "Daytime default: 70°F, nighttime: 66°F",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "play-music",
    persona: "overnight_guest",
    question: "How do I play music in the house?",
    keyFacts: [
      "Open the Sonos app on the living room iPad",
      "Pick a room or Everywhere for all rooms",
      "Spotify is connected — House Favorites playlist",
      "AirPlay also works from your own phone",
      "Speakers in living room, kitchen, and master bedroom",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "tv-audio",
    persona: "overnight_guest",
    question: "I turned on the TV but there's no sound. What do I do?",
    keyFacts: [
      "The Sonos Arc is the TV soundbar",
      "Audio should route automatically through the Arc when the TV is on",
      "Use the TV remote for volume",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "lights-not-responding",
    persona: "house_sitter",
    question: "The living room lights aren't responding in the app. What's wrong?",
    keyFacts: [
      "If a light isn't responding in the app, check the physical switch first",
      "Flipping a switch off cuts power to the smart bulb",
      "HomeKit can't control it until you flip the switch back on",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "good-night-scene",
    persona: "house_sitter",
    question: "Is there an easy way to turn off all the lights at night?",
    keyFacts: [
      "Good Night scene in the Home app on the iPad",
      "Dims everything and turns off downstairs lights",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "garbage-day",
    persona: "house_sitter",
    question: "When does the garbage go out?",
    keyFacts: [
      "Garbage collected Tuesday mornings, put out Monday night",
      "Recycling every other Tuesday — calendar on the fridge",
      "Compost also goes out Tuesday",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "furnace-noise",
    persona: "house_sitter",
    question: "The furnace is making loud clunking sounds. Is that normal?",
    keyFacts: [
      "Yes, it's old and makes clunking sounds when it kicks on — that's normal",
      "If it stops working, check the basement — pilot light sometimes goes out",
      "There's a lighter on the shelf next to it and instructions taped to the side panel",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "kitchen-drip",
    persona: "overnight_guest",
    question: "The kitchen faucet won't stop dripping. How do I turn it off?",
    keyFacts: [
      "Push the handle all the way to the right",
      "All the way right equals off",
      "Just right of center causes a slow drip",
    ],
    sourceDoc: "House Operations",
  },

  // ── Overnight Guest ─────────────────────────────────────────

  {
    id: "house-address",
    persona: "overnight_guest",
    question: "What's the house address? I need to give it to my Uber driver.",
    keyFacts: [
      "1847 SE Ash Street, Portland, OR 97214",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "ipad-passcode",
    persona: "overnight_guest",
    question: "What's the passcode for the iPad in the living room?",
    keyFacts: [
      "Passcode is 0000",
      "The iPad controls the house (lights, thermostat, music)",
    ],
    sourceDoc: "House Operations",
  },

  // ── Relative / Long-term Guest ──────────────────────────────

  {
    id: "emergency-contacts",
    persona: "relative",
    question: "Who do I call in an emergency?",
    keyFacts: [
      "Mia Castillo (mom): (503) 555-0147 — fastest by text",
      "David Park (dad): (503) 555-0293",
      "Grandma Rosa: (503) 555-0381 — backup, has a house key",
      "Neighbors the Brennans: (503) 555-0422 — Greg and Lisa",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "nearest-er",
    persona: "relative",
    question: "Where's the nearest hospital?",
    keyFacts: [
      "Providence Portland Medical Center, 4805 NE Glisan St",
      "About 10 minutes away",
      "For non-emergencies: ZoomCare on Hawthorne, 3537 SE Hawthorne Blvd, about 7 minutes",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "eli-stomachache",
    persona: "relative",
    question: "Eli says his stomach hurts. Should I be worried?",
    keyFacts: [
      "He tends to get stomachaches when anxious",
      "Usually just needs to sit quietly for a bit",
      "Not a medical issue",
    ],
    antiHallucinations: [
      "Eli has a food allergy",
      "Eli needs medication for stomachaches",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "vet-info",
    persona: "long_term_guest",
    question: "Where do the pets go to the vet?",
    keyFacts: [
      "Hawthorne Animal Hospital",
      "(503) 555-8200",
      "3442 SE Hawthorne Blvd",
      "Dr. Nguyen sees both Luna and Mochi",
    ],
    sourceDoc: "Emergency and General Info",
  },
  {
    id: "litter-box",
    persona: "long_term_guest",
    question: "Where's the cat's litter box and how often should I clean it?",
    keyFacts: [
      "In the laundry room, behind the door",
      "Scoop daily",
      "Full litter change once a week",
    ],
    sourceDoc: "Pets",
  },
  {
    id: "creaky-stair",
    persona: "overnight_guest",
    question: "I need to go downstairs without waking the kids. Any tips?",
    keyFacts: [
      "The third stair from the top creaks loudly",
    ],
    sourceDoc: "House Operations",
  },
  {
    id: "noa-seasonal-allergy",
    persona: "childcare",
    question: "Noa is really sneezy today. Should I give her anything?",
    keyFacts: [
      "She gets seasonal allergies in spring",
      "Children's Zyrtec in the medicine cabinet",
      "2.5mL once daily if she's sneezy",
    ],
    antiHallucinations: [
      "Give her Benadryl",
      "This is related to her peanut allergy",
    ],
    sourceDoc: "Emergency and General Info",
  },
];
