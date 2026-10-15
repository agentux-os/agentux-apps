const fakeEvents = [
  { id: 'evt-107', type: 'approval', at: '09:42', area: 'Engineering', mission: 'Ship release', status: 'waiting', actor: 'Maya · CTO', message: 'Release candidate is waiting for approval' },
  { id: 'evt-106', type: 'blocked', at: '09:39', area: 'Operations', mission: 'Improve fulfillment', status: 'blocked', actor: 'Node SP-02', message: 'Warehouse API gate timed out' },
  { id: 'evt-105', type: 'complete', at: '09:34', area: 'Engineering', mission: 'Ship release', status: 'complete', actor: 'Atlas · reviewer', message: 'Security review completed' },
  { id: 'evt-104', type: 'active', at: '09:28', area: 'Finance', mission: 'Close month', status: 'active', actor: 'Nova · analyst', message: 'Reconciliation workflow started' },
  { id: 'evt-103', type: 'active', at: '09:17', area: 'Operations', mission: 'Improve fulfillment', status: 'active', actor: 'Node SP-01', message: 'Picking optimization is running' }
];

const floor = [
  { name: 'Maya', kind: 'Human · CTO', area: 'Engineering', mission: 'Ship release', status: 'waiting', icon: 'M' },
  { name: 'Atlas', kind: 'Agent · reviewer', area: 'Engineering', mission: 'Ship release', status: 'active', icon: 'A' },
  { name: 'Nova', kind: 'Agent · analyst', area: 'Finance', mission: 'Close month', status: 'active', icon: 'N' },
  { name: 'SP-01', kind: 'Node · workstation', area: 'Operations', mission: 'Improve fulfillment', status: 'active', icon: '01' },
  { name: 'SP-02', kind: 'Node · workstation', area: 'Operations', mission: 'Improve fulfillment', status: 'blocked', icon: '02' },
  { name: 'Lumen', kind: 'Agent · planner', area: 'Finance', mission: 'Close month', status: 'complete', icon: 'L' }
];

const $ = (id) => document.getElementById(id);
const filters = { area: 'all', mission: 'all', status: 'all' };

function setupFilters() {
  for (const area of [...new Set(floor.map((item) => item.area))]) $('area-filter').insertAdjacentHTML('beforeend', `<option>${area}</option>`);
  for (const mission of [...new Set(floor.map((item) => item.mission))]) $('mission-filter').insertAdjacentHTML('beforeend', `<option>${mission}</option>`);
  for (const [key, id] of Object.entries({ area: 'area-filter', mission: 'mission-filter', status: 'status-filter' })) {
    $(id).addEventListener('change', (event) => { filters[key] = event.target.value; renderOffice(); });
  }
  $('clear-filters').addEventListener('click', () => { for (const key of Object.keys(filters)) filters[key] = 'all'; for (const id of ['area-filter', 'mission-filter', 'status-filter']) $(id).value = 'all'; renderOffice(); });
}

function matches(item) {
  return (filters.area === 'all' || item.area === filters.area) && (filters.mission === 'all' || item.mission === filters.mission) && (filters.status === 'all' || item.status === filters.status);
}

function renderOffice() {
  const visible = floor.filter(matches);
  $('office-grid').innerHTML = visible.length ? visible.map((item) => `<article class="desk ${item.status}"><div class="desk-icon">${item.icon}</div><div><strong>${item.name}</strong><span>${item.kind}</span><small>${item.area} · ${item.mission}</small></div><b>${item.status}</b></article>`).join('') : '<p class="empty">No people, agents or nodes match these filters.</p>';
  const active = floor.filter((item) => item.status === 'active').length;
  const blocked = floor.filter((item) => item.status === 'blocked').length;
  const approvals = floor.filter((item) => item.status === 'waiting').length;
  $('metric-active').textContent = active;
  $('metric-blocked').textContent = blocked;
  $('metric-approvals').textContent = approvals;
  $('metric-nodes').textContent = '2/2';
  $('event-list').innerHTML = fakeEvents.filter(matches).map((event) => `<li class="event-item ${event.type}"><span class="event-time">${event.at}</span><div><strong>${event.message}</strong><small>${event.actor} · ${event.area}</small></div></li>`).join('') || '<li class="empty">No events match these filters.</li>';
}

setupFilters();
renderOffice();
