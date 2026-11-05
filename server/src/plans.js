// Approved filing-plan prices, in INR paise (Rs 1 = 100 paise). The server is the only source of truth for what a
// plan costs: the browser may display these values but can never change them.
//
// !! PLACEHOLDER TEST PRICES. Replace with Vision-Tax's real prices before launch. Keys must match the <option>
// values of the "Select Filing Plan" dropdown on the homepage. The "custom" plan has no fixed price: it can only be
// paid with an admin-created payment reference (see payment_references / Admin -> Payment References).
const PLANS = {
  'student-nr': { label: 'Student & Non-Resident Return (1040-NR)', paise: 499900 },
  'professional-resident': { label: 'Professional Resident Return (1040 + 1 State)', paise: 999900 },
  'business-llc': { label: 'Business / LLC / Corporate Return', paise: 1999900 },
  itin: { label: 'ITIN Application (W-7)', paise: 799900 },
  'fbar-fatca': { label: 'FBAR & FATCA Disclosure', paise: 599900 },
  custom: { label: 'Other / Custom CPA Consultation Invoice', paise: null },
};

module.exports = { PLANS };
