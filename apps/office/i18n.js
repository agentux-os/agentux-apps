// Office's words, in English and Brazilian Portuguese. `setLocale` picks one
// (app.js does, from the browser); everything else asks `t(key, vars)`.
// Elements with `data-i18n="key"` get their text from `translatePage`.

const messages = {
  en: {
    'state.loading': 'Loading the organization from Command…',
    'state.empty': 'Nothing here yet: publish a definition or connect a node.',
    'state.stale': 'Stale: none of the organization’s nodes is reporting. What you see may be out of date.',
    'state.degraded': 'Degraded: some of the organization’s nodes are not reporting.',
    'state.denied': 'You may not see this organization.',
    'state.unavailable': 'Command is unavailable; retrying.',
    'state.error': 'Something went wrong loading the organization.',
    'decision.recorded': 'Decision recorded: {decision}',
    'decision.denied': 'Not allowed: {message}',
    'decision.already': 'Someone already decided this approval.',
    'decision.gone': 'This approval no longer exists.',
    'decision.failed': '{code}: {message}',
    'decision.pending': 'Sending your decision…',
    'decision.approveTitle': 'Approve this?',
    'decision.rejectTitle': 'Reject this?',
    'decision.reason': 'Reason (optional, recorded with the decision)',
    'decision.confirmApprove': 'Approve',
    'decision.confirmReject': 'Reject',
    'decision.cancel': 'Cancel',
    'detail.close': 'Close',
    'signIn': 'Sign in',
    'connection.demo': 'demo data',
    'connection.connecting': 'connecting',
    'connection.live': 'live · {freshness}',
    'connection.reconnecting': 'reconnecting…',
    'connection.logUnavailable': 'event log unavailable',
    'connection.retrying': 'Command unavailable · retrying in {seconds} s',
    'connection.signedOut': 'not signed in',
    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'meta': '{source} · {definition} · updated {ago}',
    'meta.demo': 'Demo data',
    'meta.command': 'From AgentUX Command',
    'floor.none': 'No nodes, agents or runs yet.',
    'floor.filtered': 'Nothing matches these filters.',
    'floor.more': 'Showing {shown} of {total}. Filter by area, mission or status to see the rest.',
    'events.none': 'No events match these filters.',
    'approvals.none': 'No pending approvals.',
    'approvals.expired': 'expired',
    'approvals.expires': 'expires {when}',
    'approvals.unspecified': 'not specified',
    'approve': 'Approve',
    'reject': 'Reject',
    'label.active': 'Active work', 'label.activeHint': 'runs in motion',
    'label.blocked': 'Blocked', 'label.blockedHint': 'failed runs and offline nodes',
    'label.approvals': 'Approvals', 'label.approvalsHint': 'human decisions',
    'label.nodes': 'Healthy nodes', 'label.nodesHint': 'reporting now',
    'label.area': 'Area', 'label.mission': 'Mission', 'label.status': 'Status',
    'label.allAreas': 'All areas', 'label.allMissions': 'All missions', 'label.allStatuses': 'All statuses',
    'label.clear': 'Clear filters', 'label.queue': 'Pending approvals', 'label.floor': 'Nodes, agents and runs',
    'label.events': 'What is happening', 'label.edit': 'edit the organization',
    'status.active': 'Active', 'status.waiting': 'Waiting', 'status.blocked': 'Blocked', 'status.complete': 'Complete', 'status.idle': 'Idle'
  },
  'pt-BR': {
    'state.loading': 'Carregando a organização do Command…',
    'state.empty': 'Nada aqui ainda: publique uma definição ou conecte um nó.',
    'state.stale': 'Desatualizado: nenhum nó da organização está reportando. O que você vê pode estar defasado.',
    'state.degraded': 'Degradado: alguns nós da organização não estão reportando.',
    'state.denied': 'Você não pode ver esta organização.',
    'state.unavailable': 'O Command está indisponível; tentando de novo.',
    'state.error': 'Algo deu errado ao carregar a organização.',
    'decision.recorded': 'Decisão registrada: {decision}',
    'decision.denied': 'Não permitido: {message}',
    'decision.already': 'Alguém já decidiu esta aprovação.',
    'decision.gone': 'Esta aprovação não existe mais.',
    'decision.failed': '{code}: {message}',
    'decision.pending': 'Enviando sua decisão…',
    'decision.approveTitle': 'Aprovar isto?',
    'decision.rejectTitle': 'Rejeitar isto?',
    'decision.reason': 'Motivo (opcional, registrado com a decisão)',
    'decision.confirmApprove': 'Aprovar',
    'decision.confirmReject': 'Rejeitar',
    'decision.cancel': 'Cancelar',
    'detail.close': 'Fechar',
    'signIn': 'Entrar',
    'connection.demo': 'dados de demonstração',
    'connection.connecting': 'conectando',
    'connection.live': 'ao vivo · {freshness}',
    'connection.reconnecting': 'reconectando…',
    'connection.logUnavailable': 'log de eventos indisponível',
    'connection.retrying': 'Command indisponível · nova tentativa em {seconds} s',
    'connection.signedOut': 'não autenticado',
    'time.now': 'agora há pouco',
    'time.minutes': 'há {n} min',
    'time.hours': 'há {n} h',
    'meta': '{source} · {definition} · atualizado {ago}',
    'meta.demo': 'Dados de demonstração',
    'meta.command': 'Do AgentUX Command',
    'floor.none': 'Ainda não há nós, agentes ou execuções.',
    'floor.filtered': 'Nada corresponde a estes filtros.',
    'floor.more': 'Mostrando {shown} de {total}. Filtre por área, missão ou status para ver o resto.',
    'events.none': 'Nenhum evento corresponde a estes filtros.',
    'approvals.none': 'Nenhuma aprovação pendente.',
    'approvals.expired': 'expirada',
    'approvals.expires': 'expira {when}',
    'approvals.unspecified': 'sem prazo',
    'approve': 'Aprovar',
    'reject': 'Rejeitar',
    'label.active': 'Trabalho ativo', 'label.activeHint': 'execuções em andamento',
    'label.blocked': 'Bloqueado', 'label.blockedHint': 'execuções com falha e nós offline',
    'label.approvals': 'Aprovações', 'label.approvalsHint': 'decisões humanas',
    'label.nodes': 'Nós saudáveis', 'label.nodesHint': 'reportando agora',
    'label.area': 'Área', 'label.mission': 'Missão', 'label.status': 'Status',
    'label.allAreas': 'Todas as áreas', 'label.allMissions': 'Todas as missões', 'label.allStatuses': 'Todos os status',
    'label.clear': 'Limpar filtros', 'label.queue': 'Aprovações pendentes', 'label.floor': 'Nós, agentes e execuções',
    'label.events': 'O que está acontecendo', 'label.edit': 'editar a organização',
    'status.active': 'Ativo', 'status.waiting': 'Aguardando', 'status.blocked': 'Bloqueado', 'status.complete': 'Concluído', 'status.idle': 'Ocioso'
  }
};

let current = 'en';

/** The locale Office speaks for `wanted` (`pt-BR`, `pt`, `en-US`, ...). */
export function pickLocale(wanted) {
  const tag = String(wanted || '').toLowerCase();
  return tag.startsWith('pt') ? 'pt-BR' : 'en';
}

export function setLocale(wanted) { current = pickLocale(wanted); return current; }
export function locale() { return current; }

/** The message `key` in the current locale, with `{name}` filled from `vars`. */
export function t(key, vars = {}) {
  const text = messages[current][key] ?? messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
}

/** Every key, per locale: what the tests compare. */
export const keys = (lang) => Object.keys(messages[lang] || {});

/** Gives `[data-i18n]` elements under `root` their text. */
export function translatePage(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  root.documentElement && (root.documentElement.lang = current);
}
