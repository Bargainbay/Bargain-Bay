// NO IMPORTS: the staff composer runs this in the browser to warn before the server refuses.
//
// The platform's rule is that a seller is never given a customer's email address or phone number. Staff are
// the people who know them, so the risk is a rep pasting a customer's details into a message the seller can
// read. This is a pattern check, deliberately blunt: it warns and asks for a confirmation, it does not try
// to decide whether the number is the customer's. It applies only to a message the seller will see; an
// internal staff note is never checked.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i;
// North American numbers with or without separators / country code.
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

/** What looks like contact details in `text`: [] or a list of 'email address' / 'phone number'. */
export function contactDetailsIn(text) {
  const t = String(text ?? '');
  const found = [];
  if (EMAIL.test(t)) found.push('email address');
  if (PHONE.test(t)) found.push('phone number');
  return found;
}

export const contactWarning = (found) =>
  `This message looks like it contains a ${found.join(' and a ')}. Sellers must never be given a customer's contact details. ` +
  'If it is not a customer\'s, confirm to send it anyway.';
