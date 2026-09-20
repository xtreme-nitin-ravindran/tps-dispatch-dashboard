// Display labels only: preserve the original source codes in the snapshot.
const UNIT_NAMES = {
  HP: "Highway Patrol",
  MAR: "Marine Unit",
  PKE: "Parking Enforcement East",
  PKW: "Parking Enforcement West"
};

export function policeUnitLabel(value) {
  const code = String(value ?? "").trim();
  if (!code || /^unknown$/i.test(code)) return "Unknown";
  const name = UNIT_NAMES[code.toUpperCase()];
  if (Object.hasOwn(UNIT_NAMES, code.toUpperCase())) return name;
  if (/^Division \d+$/.test(code) || /^Possible divisions \d+(?: \/ \d+)+$/.test(code)) return code;
  if (Object.values(UNIT_NAMES).includes(code)) return code;
  // Unknown values use the fallback regardless of their spelling or format.
  // Preserve the source value rather than guessing an expansion.
  return `TPS code ${code} (meaning unconfirmed)`;
}
