const FIXTURE_PARAM = 'mobileAuditFixture';
const FIXTURE_STATES = new Set(['many', 'zero', 'stale', 'unavailable']);
const LOCATION_STATES = new Set(['none', 'current', 'unavailable', 'denied', 'saved', 'manual']);
const FILTER_STATES = new Set(['none', 'one', 'multiple', 'long', 'service', 'event', 'division', 'history', 'search', 'zero']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function mobileAuditFixtureState(locationLike = globalThis.location) {
  if (!LOOPBACK_HOSTS.has(locationLike?.hostname)) return null;
  const state = new URLSearchParams(locationLike?.search || '').get(FIXTURE_PARAM);
  return FIXTURE_STATES.has(state) ? state : null;
}

export function mobileAuditFixtureOptions(locationLike = globalThis.location) {
  const state = mobileAuditFixtureState(locationLike);
  if (!state) return null;
  const params = new URLSearchParams(locationLike.search);
  const sheet = ['collapsed', 'half', 'expanded'].includes(params.get('mobileAuditSheet'))
    ? params.get('mobileAuditSheet') : 'collapsed';
  const view = ['map', 'calls'].includes(params.get('mobileAuditView'))
    ? params.get('mobileAuditView') : 'map';
  const location = LOCATION_STATES.has(params.get('mobileAuditLocation'))
    ? params.get('mobileAuditLocation') : 'none';
  const filters = FILTER_STATES.has(params.get('mobileAuditFilters'))
    ? params.get('mobileAuditFilters') : 'none';
  const radius = ['0.5', '1', '2', '5', 'toronto'].includes(params.get('mobileAuditRadius'))
    ? params.get('mobileAuditRadius') : null;
  return { state, sheet, view, location, filters, radius };
}

export function mobileAuditFixtureFilters(name = 'none') {
  const states = {
    none: {},
    one: { serviceFilter: 'TFS' },
    multiple: { serviceFilter: 'TPS', eventFilter: 'other', division: 'Division 14', hours: 12 },
    long: { division: 'Highway Patrol' },
    service: { serviceFilter: 'TFS' },
    event: { eventFilter: 'fire' },
    division: { division: 'Division 14' },
    history: { hours: 6 },
    search: { search: 'University Avenue between Armoury Street and Dundas Street West' },
    zero: { serviceFilter: 'TPS', eventFilter: 'medical' }
  };
  return { ...(states[name] || states.none) };
}

const minutesAgo = (now, minutes) => new Date(now - minutes * 60_000).toISOString();

function incident(id, source, description, location, minutes, coordinates, extra, now) {
  const timestamp = minutesAgo(now, minutes);
  return {
    id: `mobile-audit-${id}`,
    source,
    description,
    location,
    timestamp,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    eventCategory: extra.eventCategory || 'other',
    isOngoing: extra.isOngoing ?? source === 'TFS',
    geography: { coordinates, division: extra.division || 'Division 52' },
    vehicles: extra.vehicles || []
  };
}

export function mobileAuditFixtureSnapshot(state = 'many', now = Date.now()) {
  const many = [
    incident('selected', 'TFS', 'Residential Fire Alarm — Long deterministic audit label', 'University Avenue between Armoury Street & Dundas Street West', 4, [43.6534, -79.3862], {eventCategory:'fire',vehicles:[{type:'Pumper',numbers:['P312']}]}, now),
    incident('medical', 'TFS', 'MEDICAL', 'Approximate area: Downtown Toronto / Harbourfront / Railway Lands / Bathurst Quay', 9, [43.6414, -79.3902], {eventCategory:'medical'}, now),
    incident('police', 'TPS', 'PERSON WITH A KNIFE', 'QUEEN ST W - SPADINA AVE', 13, [43.6489, -79.3965], {division:'Division 14'}, now),
    incident('collision', 'TPS', 'FAIL TO REMAIN PERSONAL INJURY COLLISION', 'GARDINER W S KINGSWAY RAMP - SOUTH KINGSWAY', 18, [43.6385, -79.4701], {isOngoing:false,division:'Highway Patrol'}, now),
    incident('alarm', 'TFS', 'Alarm Highrise Residential', 'Wellesley Street between Bleecker Street & Ontario Street', 24, [43.6669, -79.3718], {eventCategory:'fire'}, now),
    incident('assault', 'TPS', 'ASSAULT JUST OCCURRED', 'FRONT ST W - CLARENCE SQ', 31, [43.6446, -79.3945], {isOngoing:false}, now),
    incident('hazmat', 'TFS', 'Hazmat Level 1', 'Ellesmere Road between Victoria Park Avenue & Pollard Drive', 38, [43.7583, -79.3111], {}, now),
    incident('noise', 'TPS', 'NOISE COMPLAINT', 'JANE ST - DALLNER RD', 47, [43.7183, -79.5084], {isOngoing:false,division:'Division 31'}, now),
    incident('fire', 'TFS', 'Fire - Grass/Rubbish', 'Fifteenth Street between Lake Shore Boulevard West & Birmingham Street', 58, [43.6017, -79.515], {eventCategory:'fire'}, now),
    incident('robbery', 'TPS', 'ROBBERY', 'YONGE ST - BLOOR ST E', 71, [43.671, -79.3858], {isOngoing:false,division:'Division 53'}, now),
    incident('water', 'TFS', 'Water Problem - Level 1', 'Davisville Avenue between Yonge Street & Pailton Crescent', 96, [43.6981, -79.3978], {}, now),
    incident('unmapped', 'TFS', 'Check Call - Non Emergency', 'An intentionally long unmapped location description used to verify wrapping without a map coordinate', 112, null, {}, now)
  ];
  const calls = state === 'zero' ? [] : many;
  const ok = { status: 'ok', fetchedAt: minutesAgo(now, 2) };
  const feeds = state === 'stale'
    ? { TFS: {status:'stale',fetchedAt:minutesAgo(now, 95)}, TPS: {status:'unavailable',fetchedAt:minutesAgo(now, 180)} }
    : { TFS: ok, TPS: ok };
  const roadStatus = state === 'stale' ? 'stale' : 'ok';
  const transitStatus = state === 'unavailable' ? 'unavailable' : state === 'stale' ? 'stale' : 'ok';
  const transitAge = state === 'stale' ? 15 : 2;
  const transitItems = state === 'zero' ? [] : [{
    id: 'mobile-audit-ttc-nearby', title: 'TEST — Long TTC disruption label for wrapping',
    description: 'Deterministic local visual-audit fixture with deliberately long text that must wrap inside the mobile Calls view without widening the page or overlapping incident cards.', effect: 'DETOUR',
    routes: ['504'], stopIds: ['mobile-audit-stop'], periods: [],
    affectedEntities: [{routeId:'504',stopId:'mobile-audit-stop',name:'King Street West at Spadina Avenue',coordinates:[43.6475,-79.395]}],
    url: 'https://www.ttc.ca/service-advisories/all-service-alerts'
  }, {
    id: 'mobile-audit-ttc-unresolved', title: 'TEST — Citywide TTC alert with unresolved geography',
    description: 'This alert remains distinct in the citywide disclosure because its affected stop has no resolved coordinates.', effect: 'SERVICE CHANGE',
    routes: ['1'], stopIds: ['mobile-audit-unresolved-stop'], periods: [],
    affectedEntities: [{routeId:'1',stopId:'mobile-audit-unresolved-stop'}],
    url: 'https://www.ttc.ca/service-advisories/all-service-alerts'
  }];
  return {
    incidents: calls,
    feeds,
    fetchedAt: minutesAgo(now, 2),
    sourceUpdatedAt: minutesAgo(now, 3),
    disruptions: {
      roads: {
        status: roadStatus,
        fetchedAt: minutesAgo(now, state === 'stale' ? 95 : 2),
        items: state === 'zero' ? [] : [{
          id: 'mobile-audit-road', title: 'King Street West closure with a deliberately long label',
          street: 'King Street West', restrictionType: 'ROAD CLOSED', status: 'Active', impact: 'High', expired: false,
          geometryKind: 'line', coordinates: [43.6474, -79.395],
          line: [[43.6472, -79.398], [43.6476, -79.392]], start: now - 3_600_000, end: now + 3_600_000,
          startLocation: 'Bathurst Street', endLocation: 'Spadina Avenue',
          source: {name:'Local mobile audit fixture',url:'http://127.0.0.1/'}
        }]
      },
      transit: {
        status: transitStatus,
        fetchedAt: minutesAgo(now, transitAge),
        items: transitItems
      }
    }
  };
}
