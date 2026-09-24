export const DISPATCH_GLOSSARY_FOOTER = "Dispatch descriptions reflect the source agency’s initial call classification and may change as responders assess the situation.";

export const DISPATCH_GLOSSARY = Object.freeze({
  "MEDICAL": "A call for medical assistance.",
  "ALARM SINGLE SOURCE": "An alarm reported from a single detector or alarm source.",
  "DISORDERLIES": "A report of disorderly behaviour or a public disturbance.",
  "UNKNOWN TROUBLE": "A request for help where the nature of the problem is unclear.",
  "PERSONAL INJURY COLLISION": "A traffic collision initially reported to involve an injury.",
  "SEE AMBULANCE": "A request for police to attend where ambulance service is involved.",
  "VEHICLE - PERSONAL INJURY": "A vehicle incident initially reported to involve an injury.",
  "VEHICLE - PERSONAL INJURY HIGHWAY": "A highway vehicle incident initially reported to involve an injury.",
  "BREAK & ENTER": "A reported break-in or attempted break-in.",
  "PROPERTY DAMAGE COLLISION": "A traffic collision initially reported as involving property damage.",
  "RESCUE - ELEVATOR": "A request for rescue involving an elevator.",
  "FIRE - GRASS/RUBBISH": "A reported fire involving grass or rubbish."
});

export function glossaryDefinition(description) {
  const key = String(description || "").trim().toUpperCase();
  return Object.hasOwn(DISPATCH_GLOSSARY, key) ? DISPATCH_GLOSSARY[key] : "";
}
