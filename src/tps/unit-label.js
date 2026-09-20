// Display labels only: preserve the original source codes in the snapshot.
const UNIT_NAMES = {
  HP: "Highway Patrol",
  MAR: "Marine Unit",
  PKE: "Parking Enforcement East",
  PKW: "Parking Enforcement West"
};

export function policeUnitLabel(value) {
  const code = String(value || "Unknown").trim();
  if (Object.hasOwn(UNIT_NAMES, code)) return UNIT_NAMES[code];
  // TPS publishes additional dispatch codes without a public code dictionary.
  if (/^(?=.*[A-Z])[A-Z0-9]+$/.test(code)) return `TPS code ${code} (meaning unconfirmed)`;
  return code;
}
