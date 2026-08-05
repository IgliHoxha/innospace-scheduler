// Builders for the "ask us about this slot" links. Pure: no env imports.

/** wa.me wants bare digits: a "+" or a space gives a dead link. */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** A mailto with the slot already described, so nobody has to retype it. */
export function mailtoLink(
  email: string,
  subject: string,
  body: string,
): string {
  if (!email) return "";
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${email}?${q}`;
}

/** One sentence naming the slot, shared by both links so they read the same. */
export function slotEnquiry(
  boothName: string,
  dateLabel: string,
  from: string,
  to: string,
): string {
  return `Hi, I'd like to ask about the ${boothName} booking on ${dateLabel}, ${from} - ${to}.`;
}
