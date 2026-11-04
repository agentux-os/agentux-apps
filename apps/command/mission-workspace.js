import { createMissionApi, orderedActivity, activityForEvent, runConnectionState, replayRunActivity, canDecideApproval, canCancelRun } from './mission.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = (value) => value ? new Date(value).toLocaleString() : 'Time not reported';
const label = (value) => String(value || 'unknown').replace(/[_-]+/g, ' ');
const rowsOf = (value) => Object.values(value || {});
const detailRunId = (entry) => entry?.event?.runId || entry?.event?.data?.runId || '';

/** Attach the organization scoped mission workspace to the Command console. */
export function mountMissionWorkspace({ api = createMissionApi(), config = {}, getNodes = () => [], getGrants = () => ({}), onOpenNode = () => {} } = {}) {
  let organizations = [];
  let runs = [];
  let selected = null;
  let projection = null;
  let activity = [];
  let closeStream = null;
  let cursor = 0;
  let streamState = 'loading';
  let loading = false;
  let queuedRefresh = false;
  let queuedRefreshOptions = {};
  let detailGeneration = 0;
  let approvalKeys = new Map();
  let runFilter = '';
  let shownLimit = 100;

  const orgId = () => $('mission-org').value;
  const capabilities = (org, capability) => (getGrants()[org] || getGrants()['*'] || []).includes(capability);
  const setStream = (state) => {
    streamState = state;
    const text = { live: 'Live', reconnecting: 'Reconnecting', stale: 'Stale data', unavailable: 'Unavailable', offline: 'Offline', loading: 'Loading' }[state] || label(state);
    $('mission-stream').textContent = text;
    $('mission-stream').className = `stream-state stream-${state}`;
  };
  const setState = (message, kind = 'info') => {
    $('mission-state').textContent = message;
    $('mission-state').className = `mission-state state-${kind}`;
  };

  function discoverOrganizations() {
    const fromNodes = getNodes().map((node) => node.organizationId).filter(Boolean);
    const fromConfig = [config.organizationId, ...(config.organizationIds || [])].filter(Boolean);
    const fromGrants = Object.keys(getGrants()).filter((id) => id !== '*');
    organizations = [...new Set([...fromConfig, ...fromGrants, ...fromNodes])]
      .filter((id) => capabilities(id, 'organization.read'))
      .sort((a, b) => a.localeCompare(b));
    const previous = orgId();
    $('mission-org').innerHTML = organizations.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
    if (organizations.includes(previous)) $('mission-org').value = previous;
    else if (organizations.length) $('mission-org').value = organizations[0];
    $('mission-org').disabled = organizations.length < 2;
    if (!organizations.length) {
      closeStream?.(); closeStream = null;
      setStream('unavailable');
      setState('No organization with run read access is available to this operator. Ask an organization administrator for organization.read.', 'error');
      $('mission-runs').replaceChildren();
      $('runs-empty').hidden = true;
      clearDetail('Run access is not available.');
      return false;
    }
    return true;
  }

  function clearDetail(message = 'Choose a run to inspect its steps, approvals, artifacts and activity.') {
    $('run-title').textContent = 'Run details';
    $('run-description').textContent = message;
    $('run-steps').replaceChildren();
    $('run-cancel').hidden = true;
    $('mission-activity').replaceChildren();
    $('activity-count').textContent = '';
    $('activity-empty').hidden = false;
    $('activity-empty').textContent = message;
    $('mission-approvals').innerHTML = '<p class="subtle">Select a run to see its approvals.</p>';
    $('mission-artifacts').innerHTML = '<p class="subtle">Select a run to see its results.</p>';
    $('mission-node').innerHTML = '<p class="subtle">Node information appears with a selected run.</p>';
  }

  function visibleRuns() {
    const needle = runFilter.trim().toLocaleLowerCase();
    return runs.filter((run) => {
      if (!needle) return true;
      const steps = rowsOf(run.steps).map((step) => `${step.nodeId} ${step.error}`).join(' ');
      return [run.runId, run.missionId, run.workflowId, run.status, run.step, run.input?.title, steps].join(' ').toLocaleLowerCase().includes(needle);
    });
  }

  function renderRuns() {
    const filtered = visibleRuns();
    $('run-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'run' : 'runs'}`;
    const subset = filtered.slice(0, shownLimit);
    $('mission-runs').innerHTML = subset.map((run) => {
      const currentStep = run.steps?.[run.step];
      const nodeId = currentStep?.nodeId || '';
      const title = run.input?.title || run.missionId || run.runId;
      return `<button type="button" class="run-card ${selected?.runId === run.runId ? 'run-selected' : ''}" data-run-select="${esc(run.runId)}" aria-pressed="${selected?.runId === run.runId}">
        <span class="run-card-heading"><strong>${esc(title)}</strong><span class="run-status status-${esc(run.status)}">${esc(label(run.status))}</span></span>
        <span class="run-card-meta">${esc(run.missionId)} · ${esc(run.runId)}</span>
        <span class="run-card-meta">${currentStep ? `Step ${esc(run.step)} · attempt ${esc(currentStep.attempt || 1)}` : esc(run.step || 'No active step')}${nodeId ? ` · ${esc(nodeId)}` : ''}</span>
      </button>`;
    }).join('');
    $('runs-empty').hidden = filtered.length !== 0;
    $('runs-more').hidden = filtered.length <= subset.length;
    $('runs-more').textContent = filtered.length > subset.length ? `Showing ${subset.length} of ${filtered.length} returned runs. Command's current list API returns at most 200 newest runs.` : '';
    $('run-load-more').hidden = filtered.length <= subset.length;
  }

  function renderActivity() {
    const entries = orderedActivity(activity).filter((entry) => detailRunId(entry) === selected?.runId);
    $('activity-count').textContent = `${entries.length} ${entries.length === 1 ? 'event' : 'events'}`;
    $('activity-empty').hidden = entries.length > 0;
    $('activity-empty').textContent = entries.length ? '' : 'No recorded activity for this run in the available event log.';
    $('mission-activity').innerHTML = entries.map((entry) => {
      const item = activityForEvent(entry.event);
      return `<li class="activity-entry tone-${esc(item.tone)}"><span class="activity-marker" aria-hidden="true"></span><div class="activity-body"><div class="activity-title"><strong>${esc(item.title)}</strong><time datetime="${esc(item.time)}">${esc(date(item.time))}</time></div><p>${esc(item.detail || entry.event?.eventType || 'Command event')}</p><small>${esc(entry.event?.nodeId || 'Command')} · cursor ${esc(entry.cursor)}</small></div></li>`;
    }).join('');
  }

  function activeStepNode(run) {
    const steps = rowsOf(run?.steps);
    const current = run?.steps?.[run.step];
    return current?.nodeId ? getNodes().find((node) => node.nodeId === current.nodeId) || projection?.nodes?.find((node) => node.id === current.nodeId) : null;
  }

  function renderNode(run) {
    const step = run?.steps?.[run.step];
    const nodeId = step?.nodeId;
    if (!nodeId) {
      $('mission-node').innerHTML = '<p class="subtle">Command has not assigned a node to this step yet.</p>';
      return;
    }
    const node = activeStepNode(run);
    const isOffline = !node || node.connected === false || ['offline', 'unknown'].includes(node.presence);
    const connection = runConnectionState({ connected: !isOffline, freshness: projection?.freshness });
    const lastSeen = node?.lastHeartbeatAt || node?.lastSeenAt;
    $('mission-node').innerHTML = `<dl class="context-list"><div><dt>Node</dt><dd>${esc(nodeId)}</dd></div><div><dt>Connectivity</dt><dd><span class="node-state state-${connection}">${esc(label(connection))}</span></dd></div><div><dt>Presence</dt><dd>${esc(node?.presence || node?.status || 'not present in current node list')}</dd></div><div><dt>Last report</dt><dd>${esc(date(lastSeen))}</dd></div><div><dt>Node run</dt><dd>${esc(step?.nodeRunId || 'Not reported')}</dd></div></dl>
      ${isOffline ? '<p class="inline-warning" role="status">This node is disconnected. A successful Command response does not confirm that the node received a command.</p>' : ''}
      <button type="button" data-node-drill="${esc(nodeId)}">Open this node in Fleet</button>`;
  }

  function renderApprovals(run) {
    const approvals = (projection?.approvals || []).filter((approval) => approval.runId === run?.runId && approval.status === 'pending');
    if (!approvals.length) {
      $('mission-approvals').innerHTML = '<p class="subtle">No pending approvals for this run.</p>';
      return;
    }
    const allowed = capabilities(run.organizationId, 'approval.decide');
    const actionsAllowed = canDecideApproval(getGrants(), run.organizationId, projection?.freshness);
    $('mission-approvals').innerHTML = approvals.map((approval) => {
      const target = approval.nodeId && !String(approval.nodeId).startsWith('command') ? approval.nodeId : `run ${approval.runId}`;
      const scope = [approval.missionId && `mission ${approval.missionId}`, approval.gateId && `gate ${approval.gateId}`, approval.policy, approval.requiredPermissions && `requires ${[].concat(approval.requiredPermissions).join(', ')}`].filter(Boolean).join(' · ') || 'Scope not supplied by Command';
      const consequence = approval.action === 'approval' ? 'Approve continues the workflow; deny records a rejected gate.' : `Approve authorizes ${approval.action}; deny records a refusal.`;
      return `<article class="approval-card"><h3>${esc(approval.title || approval.action || 'Decision required')}</h3><dl class="context-list"><div><dt>Proposed operation</dt><dd>${esc(approval.action || 'Not supplied')}</dd></div><div><dt>Target</dt><dd>${esc(target)}</dd></div><div><dt>Scope</dt><dd>${esc(scope)}</dd></div></dl><p>${esc(consequence)}</p>
        ${actionsAllowed ? `<label class="reason-label">Decision reason (optional)<input type="text" maxlength="500" data-approval-reason="${esc(approval.id)}" /></label><div class="approval-actions"><button type="button" data-approval="${esc(approval.id)}" data-decision="approved">Approve</button><button type="button" class="secondary-button" data-approval="${esc(approval.id)}" data-decision="denied">Deny</button></div>` : `<p class="inline-warning">${allowed ? 'This organization projection is stale. Refresh before deciding.' : 'You can view this approval but do not have approval.decide permission in this organization.'}</p>`}</article>`;
    }).join('');
  }

  function renderArtifacts(run) {
    const artifacts = (projection?.artifacts || []).filter((artifact) => artifact.runId === run?.runId);
    if (!artifacts.length) {
      $('mission-artifacts').innerHTML = '<p class="subtle">No artifacts have been reported for this run.</p>';
      return;
    }
    $('mission-artifacts').innerHTML = `<ul class="artifact-list">${artifacts.map((artifact) => {
      const uri = artifact.uri || artifact.url || '';
      let safeLink = '';
      try { const parsed = new URL(uri, location.href); if (['http:', 'https:'].includes(parsed.protocol)) safeLink = parsed.href; } catch { /* Keep unsupported URI schemes as text. */ }
      const name = artifact.name || artifact.kind || artifact.id || 'Artifact';
      return `<li>${safeLink ? `<a href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>` : `<strong>${esc(name)}</strong>`}<small>${esc(artifact.kind || 'result')}${artifact.nodeId ? ` · ${esc(artifact.nodeId)}` : ''}</small></li>`;
    }).join('')}</ul>`;
  }

  function renderRun(run) {
    if (!run) { clearDetail(); return; }
    selected = run;
    const title = run.input?.title || run.missionId || run.runId;
    const current = run.steps?.[run.step];
    $('run-title').textContent = title;
    $('run-description').textContent = `${label(run.status)} · ${run.runId} · mission ${run.missionId} · workflow ${run.workflowId} · updated ${date(run.updatedAt)}`;
    const steps = Object.entries(run.steps || {});
    $('run-steps').innerHTML = steps.length ? `<h3>Steps and attempts</h3><ol class="step-list">${steps.map(([stepId, step]) => `<li><strong>${esc(stepId)}</strong><span>${esc(label(step.status))}</span><small>Attempt ${esc(step.attempt || 1)}${step.nodeId ? ` · ${esc(step.nodeId)}` : ''}${step.approvalId ? ` · approval ${esc(step.approvalId)}` : ''}${step.error ? ` · ${esc(step.error)}` : ''}</small></li>`).join('')}</ol>` : '<p class="subtle">No step attempts recorded yet.</p>';
    const canCancel = canCancelRun(getGrants(), run.organizationId, run.status, projection?.freshness);
    $('run-cancel').hidden = !canCancel;
    $('run-cancel').disabled = loading;
    $('run-cancel').textContent = current?.nodeId ? 'Cancel run in Command' : 'Cancel run';
    renderActivity(); renderApprovals(run); renderArtifacts(run); renderNode(run);
  }

  async function fetchRunDetail(run) {
    const generation = ++detailGeneration;
    const organization = orgId();
    closeStream?.(); closeStream = null;
    selected = run;
    activity = [];
    cursor = 0;
    projection = null;
    renderRun(run);
    $('activity-empty').textContent = 'Loading durable activity…';
    $('activity-notice').hidden = true;
    try {
      const [detail, currentProjection, replayed] = await Promise.all([
        api.run(organization, run.runId), api.projection(organization), replayRunActivity(api, organization, run)
      ]);
      if (generation !== detailGeneration) return;
      selected = detail;
      projection = currentProjection;
      cursor = replayed.cursor;
      activity = replayed.events;
      $('activity-notice').hidden = !replayed.truncated;
      if (replayed.truncated) $('activity-notice').textContent = 'This run has more than 50,000 organization events since it started. The timeline shows the replayed portion and continues with live events.';
      renderRun(detail);
      if (projection.freshness === 'stale') setStream('stale');
      else if (streamState !== 'offline') setStream('reconnecting');
      closeStream = await api.follow(organization, cursor, {
        onState: (state) => {
          if (generation !== detailGeneration) return;
          if (navigator.onLine === false) setStream('offline');
          else if (state !== 'live' || projection?.freshness !== 'stale') setStream(state);
        },
        onEvent: (entry) => {
          if (generation !== detailGeneration) return;
          cursor = Math.max(cursor, entry.cursor || 0);
          if (detailRunId(entry) === selected?.runId) {
            activity = orderedActivity([...activity, entry]);
            renderActivity();
          }
          if (entry.event?.eventType?.startsWith('mission.run.') || entry.event?.eventType?.startsWith('approval.')) {
            void refresh({ keepSelection: true, quiet: true });
          }
        }
      });
    } catch (error) {
      if (generation !== detailGeneration) return;
      const denied = error.status === 401 || error.status === 403;
      setStream(navigator.onLine === false ? 'offline' : 'unavailable');
      setState(denied ? 'You do not have permission to inspect this run and its event history.' : `Could not load run details: ${error.message}`, 'error');
      $('activity-empty').textContent = denied ? 'Access to this run was denied by Command.' : `Activity unavailable: ${error.message}`;
      $('activity-empty').hidden = false;
    }
  }

  async function refresh(options = {}) {
    const { keepSelection = true, quiet = false } = options;
    if (!discoverOrganizations()) return;
    if (loading) { queuedRefresh = true; queuedRefreshOptions = options; return; }
    loading = true;
    const oldRunId = keepSelection ? selected?.runId : null;
    if (!quiet) { setState('Loading runs and node context…'); setStream('loading'); }
    try {
      const organization = orgId();
      const [listed, currentProjection] = await Promise.all([api.runs(organization), api.projection(organization)]);
      if (organization !== orgId()) { queuedRefresh = true; queuedRefreshOptions = options; return; }
      runs = listed;
      projection = currentProjection;
      if (!quiet) setState(currentProjection.freshness === 'stale' ? 'Command reports a stale organization projection. Actions are disabled until it refreshes.' : `${runs.length} runs loaded for ${organization}.`, currentProjection.freshness === 'stale' ? 'warning' : 'info');
      renderRuns();
      const choice = runs.find((run) => run.runId === oldRunId) || runs.find((run) => run.runId === selected?.runId) || runs[0];
      const detailChanged = Number(choice?.revision) !== Number(selected?.revision);
      if (choice && (!selected || choice.runId !== selected.runId || !quiet || detailChanged)) await fetchRunDetail(choice);
      else if (!choice) { closeStream?.(); closeStream = null; selected = null; clearDetail('No run is selected.'); setStream(currentProjection.freshness === 'stale' ? 'stale' : 'live'); }
      if (!runs.length) setState('No runs have been recorded for this organization yet.', 'info');
    } catch (error) {
      detailGeneration += 1;
      closeStream?.(); closeStream = null;
      if (error.status === 401) setState('Sign in to Command to inspect mission runs.', 'error');
      else if (error.status === 403) setState('Your operator account does not have organization.read for this organization.', 'error');
      else setState(`Command could not load runs: ${error.message}`, 'error');
      setStream(navigator.onLine === false ? 'offline' : 'unavailable');
      $('mission-runs').replaceChildren(); $('runs-empty').hidden = false; $('runs-empty').textContent = 'Runs could not be loaded. Retry when Command is available.';
      clearDetail('Run data is unavailable.');
    } finally {
      loading = false;
      $('run-cancel').disabled = false;
      if (queuedRefresh) {
        const nextOptions = queuedRefreshOptions;
        queuedRefresh = false;
        queuedRefreshOptions = {};
        void refresh(nextOptions);
      }
    }
  }

  async function decide(button) {
    const approvalId = button.dataset.approval;
    const decision = button.dataset.decision;
    if (!selected || !canDecideApproval(getGrants(), selected.organizationId, projection?.freshness)) return;
    const title = decision === 'approved' ? 'Approve this operation?' : 'Deny this operation?';
    const consequence = decision === 'approved' ? 'Approval is recorded and the mission workflow may continue.' : 'Denial is recorded and the mission gate will fail.';
    if (!window.confirm(`${title}\n\n${consequence}`)) return;
    const keyId = `${selected.organizationId}:${approvalId}:${decision}`;
    if (!approvalKeys.has(keyId)) approvalKeys.set(keyId, crypto.randomUUID());
    const reason = document.querySelector(`[data-approval-reason="${CSS.escape(approvalId)}"]`)?.value || '';
    button.disabled = true;
    try {
      await api.resolveApproval(selected.organizationId, approvalId, decision, reason, approvalKeys.get(keyId));
      setState(`Command recorded the ${decision} decision for ${approvalId}.`, 'info');
      approvalKeys.delete(keyId);
      await refresh({ keepSelection: true, quiet: true });
    } catch (error) {
      const message = error.status === 403 ? 'Command denied this decision. Check approval.decide access for this organization.' : error.status === 409 ? 'This approval has already changed. Refreshing its current state.' : `Command did not confirm the decision: ${error.message}`;
      setState(message, 'error');
      if (error.status === 409) { approvalKeys.delete(keyId); await refresh({ keepSelection: true, quiet: true }); }
      else button.disabled = false;
    }
  }

  async function cancelRun() {
    if (!selected || !capabilities(selected.organizationId, 'node.command') || projection?.freshness === 'stale') return;
    if (!window.confirm(`Cancel ${selected.runId} in Command? The remote node may be disconnected; this records the Command run state and cannot confirm a remote process stopped.`)) return;
    $('run-cancel').disabled = true;
    try {
      const result = await api.cancel(selected.organizationId, selected.runId);
      setState(`Command recorded cancellation for ${result.runId || selected.runId}. A disconnected node may not have received the request.`, 'warning');
      await refresh({ keepSelection: true, quiet: true });
    } catch (error) {
      setState(`Command did not confirm cancellation: ${error.message}`, 'error');
      $('run-cancel').disabled = false;
    }
  }

  $('mission-org').addEventListener('change', () => { selected = null; void refresh({ keepSelection: false }); });
  $('mission-search').addEventListener('input', (event) => { runFilter = event.target.value; shownLimit = 100; renderRuns(); });
  $('run-load-more').addEventListener('click', () => { shownLimit += 100; renderRuns(); });
  $('mission-refresh').addEventListener('click', () => void refresh({ keepSelection: true }));
  $('mission-runs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-run-select]');
    if (!button) return;
    const run = runs.find((candidate) => candidate.runId === button.dataset.runSelect);
    if (run) void fetchRunDetail(run);
    renderRuns();
  });
  $('mission-approvals').addEventListener('click', (event) => {
    const button = event.target.closest('[data-approval]');
    if (button) void decide(button);
  });
  $('mission-node').addEventListener('click', (event) => {
    const button = event.target.closest('[data-node-drill]');
    if (button) onOpenNode(button.dataset.nodeDrill);
  });
  $('run-cancel').addEventListener('click', () => void cancelRun());
  window.addEventListener('online', () => { if (orgId()) void refresh({ keepSelection: true, quiet: true }); });
  window.addEventListener('offline', () => setStream('offline'));

  return {
    refresh,
    updateAccess() { discoverOrganizations(); },
    get selectedRun() { return selected; }
  };
}
