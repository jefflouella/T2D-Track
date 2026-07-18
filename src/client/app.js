import Chart from 'chart.js/auto';

const state = {
  csrf: null,
  user: null,
  profile: null,
  profiles: [],
  flash: null,
};

const OFFLINE_QUEUE_KEY = 't2d_offline_queue';

function loadOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveOfflineQueue(items) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

async function enqueueOffline(request) {
  const q = loadOfflineQueue();
  q.push({ ...request, queuedAt: new Date().toISOString() });
  saveOfflineQueue(q);
  setFlash('Saved offline. Will sync when back online.', 'warn');
}

async function flushOfflineQueue() {
  if (!navigator.onLine) return;
  const q = loadOfflineQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      await api(item.url, { method: item.method, body: item.body });
    } catch {
      remaining.push(item);
    }
  }
  saveOfflineQueue(remaining);
  if (q.length !== remaining.length) setFlash(`Synced ${q.length - remaining.length} offline action(s)`, 'ok');
}

window.addEventListener('online', () => {
  flushOfflineQueue().then(() => render()).catch(() => {});
});


function $(sel, el = document) {
  return el.querySelector(sel);
}

function path() {
  return window.location.pathname;
}

function navigate(to) {
  window.history.pushState({}, '', to);
  render();
}

async function api(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (needsCsrf || !state.csrf) {
    const csrfRes = await fetch('/api/csrf', { credentials: 'same-origin' });
    const csrfJson = await csrfRes.json();
    state.csrf = csrfJson.csrfToken;
  }
  const headers = {
    Accept: 'application/json',
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(needsCsrf ? { 'X-CSRF-Token': state.csrf } : {}),
    ...(options.headers || {}),
  };
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
      body:
        options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
    });
  } catch (networkErr) {
    if (needsCsrf && options.allowOffline) {
      await enqueueOffline({ url, method, body: options.body });
      return { offline: true };
    }
    throw networkErr;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    if (res.status === 403 && data?.error === 'Invalid CSRF token') {
      state.csrf = null;
    }
    if (!navigator.onLine && needsCsrf && options.allowOffline) {
      await enqueueOffline({ url, method, body: options.body });
      return { offline: true };
    }
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setFlash(message, type = 'ok') {
  state.flash = { message, type };
}

function flashHtml() {
  if (!state.flash) return '';
  const { message, type } = state.flash;
  state.flash = null;
  return `<div class="flash ${type}" role="status">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shell(content, { showNav = true } = {}) {
  const p = path();
  const nav = showNav && state.user
    ? `
    <nav class="nav" aria-label="Primary">
      <a href="/today" class="${p.startsWith('/today') ? 'active' : ''}">Today</a>
      <a href="/medications" class="${p.startsWith('/medications') ? 'active' : ''}">Medications</a>
      <a href="/supplements" class="${p.startsWith('/supplements') ? 'active' : ''}">Supplements</a>
      <a href="/supplies" class="${p.startsWith('/supplies') ? 'active' : ''}">Supplies</a>
      <a href="/notes" class="${p.startsWith('/notes') ? 'active' : ''}">Notes</a>
      <a href="/health" class="${p.startsWith('/health') ? 'active' : ''}">Health</a>
      <a href="/reports" class="${p.startsWith('/reports') ? 'active' : ''}">Reports</a>
      <a href="/household" class="${p.startsWith('/household') ? 'active' : ''}">Household</a>
      <a href="/settings" class="${p.startsWith('/settings') ? 'active' : ''}">Settings</a>
    </nav>`
    : '';
  const bottom =
    showNav && state.user
      ? `<nav class="bottom-nav" aria-label="Mobile">
          <a href="/today" class="${p.startsWith('/today') ? 'active' : ''}">Today</a>
          <a href="/medications" class="${p.startsWith('/medications') ? 'active' : ''}">Meds</a>
          <a href="/notes" class="${p.startsWith('/notes') ? 'active' : ''}">Notes</a>
          <a href="/health" class="${p.startsWith('/health') ? 'active' : ''}">Health</a>
          <a href="/settings" class="${p.startsWith('/settings') ? 'active' : ''}">Settings</a>
        </nav>`
      : '';
  const profileSwitcher =
    showNav && state.profiles?.length > 1
      ? `<label class="muted" style="margin:0;font-size:0.85rem">Profile
          <select id="profile-switch" style="width:auto;padding:0.35rem 0.5rem;border-radius:8px">
            ${state.profiles
              .map(
                (pr) =>
                  `<option value="${pr.id}" ${pr.id === state.profile?.id ? 'selected' : ''}>${escapeHtml(pr.displayName)}</option>`,
              )
              .join('')}
          </select>
        </label>`
      : '';
  return `
    <header class="topbar">
      <a class="brand" href="${state.user ? '/today' : '/'}">
        <img class="brand-mark" src="/icons/icon.svg" width="32" height="32" alt="" />
        <span>T2D Track</span>
      </a>
      ${profileSwitcher}
      ${nav}
    </header>
    <main>${flashHtml()}${content}</main>
    ${bottom}
    <footer class="footer">Know what is due. Record what happened. Trust what remains.</footer>
  `;
}

async function ensureSession() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    const profiles = await api('/api/profiles');
    state.profiles = profiles.profiles || [];
    const saved = localStorage.getItem('t2d_active_profile');
    state.profile =
      state.profiles.find((p) => p.id === saved) || state.profiles[0] || null;
    if (state.profile) localStorage.setItem('t2d_active_profile', state.profile.id);
    await flushOfflineQueue();
    return true;
  } catch {
    state.user = null;
    state.profile = null;
    state.profiles = [];
    return false;
  }
}

function requireProfile() {
  if (!state.profile) throw new Error('No profile available');
  return state.profile;
}

async function renderHome() {
  if (state.user) return navigate('/today');
  const app = $('#app');
  app.innerHTML = shell(
    `
    <section class="panel auth-card">
      <h1 class="hero-brand">T2D Track</h1>
      <p class="lede">A personal medication and health log for desktop and mobile browsers. Optional install. No clinical advice.</p>
      <div class="actions" style="margin-top:1rem">
        <a class="button" href="/login">Log in</a>
        <a class="button secondary" href="/register">Create account</a>
      </div>
    </section>
  `,
    { showNav: false },
  );
}

async function renderLogin() {
  const app = $('#app');
  app.innerHTML = shell(
    `
    <section class="panel auth-card">
      <h1 class="hero-brand">Log in</h1>
      <form id="login-form" class="stack">
        <label>Email<input name="email" type="email" required autocomplete="username" /></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
        <label>Authenticator code (if enabled)<input name="totpCode" inputmode="numeric" autocomplete="one-time-code" /></label>
        <button type="submit">Log in</button>
      </form>
      <p class="muted"><a href="/recovery">Forgot password</a> · <a href="/register">Register</a></p>
    </section>
  `,
    { showNav: false },
  );
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: {
          email: fd.get('email'),
          password: fd.get('password'),
          totpCode: fd.get('totpCode') || undefined,
        },
      });
      state.csrf = null;
      await ensureSession();
      navigate(state.profile?.onboardingCompletedAt ? '/today' : '/onboarding');
    } catch (err) {
      setFlash(err.message, 'error');
      render();
    }
  });
}

async function renderRegister() {
  const status = await api('/api/auth/registration-status');
  const app = $('#app');
  if (!status.open) {
    app.innerHTML = shell(
      `<section class="panel auth-card"><h1 class="hero-brand">Registration closed</h1><p>This deployment is first-user-only or invite-only.</p><a href="/login">Log in</a></section>`,
      { showNav: false },
    );
    return;
  }
  app.innerHTML = shell(
    `
    <section class="panel auth-card">
      <h1 class="hero-brand">Create account</h1>
      <form id="register-form" class="stack">
        <label>Name<input name="name" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Password (min 10)<input name="password" type="password" minlength="10" required /></label>
        <label>Timezone<input name="timezone" value="${Intl.DateTimeFormat().resolvedOptions().timeZone}" required /></label>
        <label>Glucose unit
          <select name="glucoseUnit"><option value="mg_dL">mg/dL</option><option value="mmol_L">mmol/L</option></select>
        </label>
        <label>Weight unit
          <select name="weightUnit"><option value="lb">lb</option><option value="kg">kg</option></select>
        </label>
        <button type="submit">Register</button>
      </form>
    </section>
  `,
    { showNav: false },
  );
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: Object.fromEntries(fd.entries()),
      });
      state.csrf = null;
      await ensureSession();
      navigate('/onboarding');
    } catch (err) {
      setFlash(err.message, 'error');
      render();
    }
  });
}

async function renderOnboarding() {
  const profile = requireProfile();
  const app = $('#app');
  app.innerHTML = shell(`
    <section class="panel">
      <h1 class="hero-brand">Get ready</h1>
      <p class="lede">Confirm your units, add a first medication, then optionally enable reminders on this device.</p>
      <form id="onboard-form" class="stack">
        <label>Display name<input name="displayName" value="${escapeHtml(profile.displayName)}" required /></label>
        <label>Timezone<input name="timezone" value="${escapeHtml(profile.timezone)}" required /></label>
        <label>Glucose unit
          <select name="glucoseUnit">
            <option value="mg_dL" ${profile.glucoseUnit === 'mg_dL' ? 'selected' : ''}>mg/dL</option>
            <option value="mmol_L" ${profile.glucoseUnit === 'mmol_L' ? 'selected' : ''}>mmol/L</option>
          </select>
        </label>
        <label>Weight unit
          <select name="weightUnit">
            <option value="lb" ${profile.weightUnit === 'lb' ? 'selected' : ''}>lb</option>
            <option value="kg" ${profile.weightUnit === 'kg' ? 'selected' : ''}>kg</option>
          </select>
        </label>
        <button type="submit">Save and continue to medications</button>
      </form>
    </section>
  `);
  $('#onboard-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}`, {
      method: 'PUT',
      body: { ...Object.fromEntries(fd.entries()), onboardingCompleted: true },
    });
    await ensureSession();
    navigate('/medications/new');
  });
}

function doseCard(event, group) {
  const med = event.medication || {};
  const variable = event.schedule?.doseEntry === 'variable';
  const when = event.scheduledFor ? new Date(event.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const kindBadge = med.kind === 'supplement' ? 'Supp' : 'Med';
  return `
    <article class="dose-card" data-id="${event.id}">
      <div>
        <strong>${escapeHtml(med.name || 'Medication')}</strong>
        <span class="badge">${escapeHtml(kindBadge)}</span>
        <span class="badge">${escapeHtml(group)}</span>
      </div>
      <div class="meta">${escapeHtml(when)} · ${escapeHtml(event.schedule?.label || '')} · ${escapeHtml(event.schedule?.unitsPerDose || med.defaultUnitsPerDose || '')} ${escapeHtml(med.stockUnit || '')}</div>
      ${
        ['dueNow', 'upcoming', 'overdue'].includes(group)
          ? `<div class="actions">
              ${variable ? `<label>Amount<input class="amount" type="number" step="any" placeholder="units" style="width:7rem" /></label>` : ''}
              ${med.trackInjectionSite ? `<label>Site
                <select class="site">
                  <option value="">Site</option>
                  <option>abdomen left</option><option>abdomen right</option>
                  <option>thigh left</option><option>thigh right</option>
                  <option>arm left</option><option>arm right</option><option>other</option>
                </select></label>` : ''}
              <button data-action="taken">Taken</button>
              <button class="secondary" data-action="snooze">Snooze</button>
              <button class="secondary" data-action="skip">Skip</button>
            </div>`
          : `<div class="actions"><button class="secondary" data-action="undo">Undo</button></div>`
      }
    </article>
  `;
}

const FEELING_TAGS = [
  'sick',
  'constipation',
  'diarrhea',
  'nausea',
  'fatigue',
  'headache',
  'dizziness',
  'thirsty',
  'hungry',
  'anxious',
  'energetic',
  'rested',
  'focused',
  'calm',
  'steady',
  'good',
  'other',
];

function checkInPanelHtml(existing) {
  const mood = existing?.mood || '';
  const tags = new Set(existing?.tags || []);
  return `
    <section class="panel" id="check-in-panel">
      <h2>How do you feel?</h2>
      <p class="muted">Quick daily check-in. You can update this anytime today.</p>
      <form id="check-in-form" class="stack">
        <label>Mood (1 low to 5 great)
          <select name="mood">
            <option value=""></option>
            ${[1, 2, 3, 4, 5]
              .map((n) => `<option value="${n}" ${Number(mood) === n ? 'selected' : ''}>${n}</option>`)
              .join('')}
          </select>
        </label>
        <div class="chip-row" role="group" aria-label="Feelings">
          ${FEELING_TAGS.map(
            (t) =>
              `<label class="chip"><input type="checkbox" name="tag" value="${t}" ${tags.has(t) ? 'checked' : ''} /> ${escapeHtml(t.replace(/_/g, ' '))}</label>`,
          ).join('')}
        </div>
        <label>Note (optional)<input name="note" value="${escapeHtml(existing?.details || '')}" placeholder="Anything else…" /></label>
        <button type="submit">${existing ? 'Update check-in' : 'Save check-in'}</button>
      </form>
    </section>
  `;
}

function bindCheckInForm(profile) {
  const form = $('#check-in-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const tags = [...form.querySelectorAll('input[name="tag"]:checked')].map((el) => el.value);
    const moodRaw = fd.get('mood');
    try {
      await api(`/api/profiles/${profile.id}/check-in`, {
        method: 'POST',
        body: {
          mood: moodRaw ? Number(moodRaw) : null,
          tags,
          note: fd.get('note') || null,
        },
      });
      setFlash('Check-in saved', 'ok');
      render();
    } catch (err) {
      setFlash(err.message, 'error');
    }
  });
}

async function renderToday() {
  const profile = requireProfile();
  const data = await api(`/api/profiles/${profile.id}/today`);
  const summaries = await api(`/api/profiles/${profile.id}/health/summaries`).catch(() => null);
  const checkIn = await api(`/api/profiles/${profile.id}/check-in/today`).catch(() => ({ note: null }));
  const sections = [
    ['dueNow', 'Due now'],
    ['overdue', 'Overdue'],
    ['upcoming', 'Upcoming'],
    ['completed', 'Completed'],
    ['skipped', 'Skipped'],
  ];
  const app = $('#app');
  app.innerHTML = shell(`
    <div class="desktop-split">
      <section>
        <h1 class="hero-brand">Today</h1>
        <p class="lede">${escapeHtml(data.date)} · ${escapeHtml(data.timezone)}</p>
        ${checkInPanelHtml(checkIn.note)}
        ${sections
          .map(([key, label]) => {
            const items = data.groups[key] || [];
            return `<section class="panel"><h2>${label}</h2>${
              items.length
                ? `<div class="stack">${items.map((e) => doseCard(e, key)).join('')}</div>`
                : `<p class="empty">Nothing here.</p>`
            }</section>`;
          })
          .join('')}
      </section>
      <aside class="stack">
        <section class="panel">
          <h2>Quick health</h2>
          <div class="actions">
            <a class="button secondary" href="/health">Log reading</a>
            <a class="button secondary" href="/notes">Notes</a>
            <a class="button secondary" href="/health/trends">Trends</a>
          </div>
          ${
            summaries
              ? `<p class="muted" style="margin-top:0.75rem">7-day dose completion: <strong>${summaries.completion7.percent ?? 'n/a'}%</strong><br/>
                 30-day: <strong>${summaries.completion30.percent ?? 'n/a'}%</strong><br/>
                 Time-in-range: <strong>${summaries.timeInRange?.percent ?? 'n/a'}%</strong>
                 ${summaries.timeInRange ? `<span class="muted">(${summaries.timeInRange.label})</span>` : '<span class="muted">(enter targets in Settings)</span>'}</p>`
              : ''
          }
        </section>
      </aside>
    </div>
  `);

  bindCheckInForm(profile);

  app.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.dose-card');
      const id = card.dataset.id;
      const action = btn.dataset.action;
      try {
        if (action === 'taken') {
          const amount = card.querySelector('.amount')?.value;
          const site = card.querySelector('.site')?.value;
          await api(`/api/dose-events/${id}/taken`, {
            method: 'POST',
            body: {
              amountTaken: amount || undefined,
              injectionSite: site || undefined,
              idempotencyKey: `ui-taken-${id}-${Date.now()}`,
            },
            allowOffline: true,
          });
          setFlash('Dose marked taken', 'ok');
        } else if (action === 'skip') {
          await api(`/api/dose-events/${id}/skipped`, { method: 'POST', body: {} });
          setFlash('Dose skipped (stock unchanged)', 'ok');
        } else if (action === 'snooze') {
          await api(`/api/dose-events/${id}/snooze`, { method: 'POST', body: { minutes: 30 } });
          setFlash('Snoozed 30 minutes', 'ok');
        } else if (action === 'undo') {
          await api(`/api/dose-events/${id}/undo`, { method: 'POST', body: {} });
          setFlash('Undid last action', 'ok');
        }
        render();
      } catch (err) {
        if (err.data?.details?.needsConfirmation) {
          if (confirm('Stock would go negative. Continue and mark for reconciliation?')) {
            await api(`/api/dose-events/${id}/taken`, {
              method: 'POST',
              body: { allowNegativeStock: true, idempotencyKey: `ui-taken-neg-${id}` },
            });
            render();
            return;
          }
        }
        setFlash(err.message, 'error');
        render();
      }
    });
  });
}

async function renderMedications(kind = 'medication') {
  const profile = requireProfile();
  const isSupp = kind === 'supplement';
  const label = isSupp ? 'Supplements' : 'Medications';
  const basePath = isSupp ? '/supplements' : '/medications';
  const { medications } = await api(`/api/profiles/${profile.id}/medications?kind=${kind}`);
  const app = $('#app');
  app.innerHTML = shell(`
    <div class="actions" style="justify-content:space-between;margin-bottom:1rem">
      <h1 class="hero-brand" style="margin:0">${label}</h1>
      <a class="button" href="${basePath}/new">Add ${isSupp ? 'supplement' : 'medication'}</a>
    </div>
    ${
      medications.length === 0
        ? `<section class="panel"><p class="empty">${
            isSupp
              ? 'Add fish oil, B12, fiber, and other supplements. They show up on Today like meds.'
              : 'Add your first medication to start Today reminders.'
          }</p>${
            isSupp
              ? ''
              : '<p class="muted">Insulin pens: track in units. Record priming as waste.</p>'
          }</section>`
        : `<div class="stack">${medications
            .map((m) => {
              const supply = m.supply || {};
              const badge =
                supply.stockState === 'available'
                  ? 'ok'
                  : supply.stockState === 'out' || supply.stockState === 'needs_reconciliation'
                    ? 'danger'
                    : 'warn';
              return `<article class="panel dose-card">
                <div><strong><a href="${basePath}/${m.id}">${escapeHtml(m.name)}</a></strong>
                  <span class="badge">${escapeHtml(m.status)}</span>
                  <span class="badge ${badge}">${escapeHtml(supply.stockState || 'unknown')}</span>
                </div>
                <div class="meta">Stock ${escapeHtml(m.currentStockCache)} ${escapeHtml(m.stockUnit)}
                  · estimated supply ${supply.estimatedDays ?? 'n/a'} days
                  ${supply.basis ? `(${escapeHtml(supply.basis)})` : ''}</div>
              </article>`;
            })
            .join('')}</div>`
    }
  `);
}

async function renderMedicationNew(kind = 'medication') {
  const profile = requireProfile();
  const isSupp = kind === 'supplement';
  const basePath = isSupp ? '/supplements' : '/medications';
  const app = $('#app');
  app.innerHTML = shell(`
    <section class="panel">
      <h1 class="hero-brand">Add ${isSupp ? 'supplement' : 'medication'}</h1>
      <p class="muted">${
        isSupp
          ? 'Schedules and stock work the same as medications. No pharmacy or prescription fields.'
          : 'Enter multiple times (e.g. 08:00 and 20:00) to create one schedule per time. Free-text entry is fully supported.'
      }</p>
      <form id="med-form" class="stack">
        <label>Name${isSupp ? '' : ' (catalog search)'}
          <input name="name" id="med-name" required placeholder="${
            isSupp ? 'Fish oil, B12, Fiber…' : 'Start typing Metformin…'
          }" autocomplete="off" />
        </label>
        ${isSupp ? '' : '<div id="catalog-results" class="stack"></div><input type="hidden" name="rxcui" id="med-rxcui" />'}
        <div class="grid-2">
          <label>Strength value<input name="strengthValue" id="med-strength" placeholder="${isSupp ? '1000' : '500'}" /></label>
          <label>Strength unit<input name="strengthUnit" id="med-strength-unit" placeholder="${isSupp ? 'mg' : 'mg'}" /></label>
        </div>
        <label>Form<input name="form" id="med-form-field" placeholder="${isSupp ? 'softgel / capsule' : 'tablet'}" /></label>
        <label>Stock unit (what you count: tablets, capsules, units…)<input name="stockUnit" required placeholder="tablets" /></label>
        <label>Opening balance (how many you have now)<input name="openingBalance" type="number" step="any" value="30" /></label>
        <label>Default units per dose<input name="defaultUnitsPerDose" type="number" step="any" value="1" /></label>
        <label>Schedule type
          <select name="scheduleType">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="interval">Every N hours</option>
            <option value="as_needed">As needed</option>
          </select>
        </label>
        <label>Interval hours (for interval schedules)<input name="intervalHours" type="number" placeholder="12" /></label>
        <label>Times of day (comma-separated HH:MM)<input name="times" value="08:00" /></label>
        <label>Days of week for weekly (comma-separated)<input name="daysOfWeek" placeholder="mon,wed,fri" /></label>
        <label>Dose entry
          <select name="doseEntry"><option value="fixed">Fixed</option><option value="variable">Variable</option></select>
        </label>
        ${isSupp ? '' : '<label><input type="checkbox" name="trackInjectionSite" /> Track injection site (pens/syringes only; leave off for tablets)</label>'}
        <label>Instructions<textarea name="instructions"></textarea></label>
        ${isSupp ? '' : '<label>Refill threshold days<input name="refillThresholdDays" type="number" value="7" /></label>'}
        <button type="submit">Save ${isSupp ? 'supplement' : 'medication'}</button>
      </form>
    </section>
  `);
  $('#med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const times = String(fd.get('times') || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const days = String(fd.get('daysOfWeek') || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    try {
      await api(`/api/profiles/${profile.id}/medications`, {
        method: 'POST',
        body: {
          kind,
          name: fd.get('name'),
          rxcui: isSupp ? null : fd.get('rxcui') || null,
          strengthValue: fd.get('strengthValue') || null,
          strengthUnit: fd.get('strengthUnit') || null,
          form: fd.get('form') || null,
          stockUnit: fd.get('stockUnit'),
          openingBalance: fd.get('openingBalance'),
          defaultUnitsPerDose: fd.get('defaultUnitsPerDose'),
          scheduleType: fd.get('scheduleType'),
          timesOfDay: times,
          daysOfWeek: days,
          intervalHours: fd.get('intervalHours') ? Number(fd.get('intervalHours')) : null,
          doseEntry: fd.get('doseEntry'),
          trackInjectionSite: isSupp ? false : fd.get('trackInjectionSite') === 'on',
          instructions: fd.get('instructions') || null,
          refillThresholdDays: isSupp ? 7 : Number(fd.get('refillThresholdDays') || 7),
        },
      });
      setFlash(`${isSupp ? 'Supplement' : 'Medication'} saved`, 'ok');
      navigate(basePath);
    } catch (err) {
      setFlash(err.message, 'error');
      render();
    }
  });

  if (!isSupp) {
    let catalogTimer;
    $('#med-name')?.addEventListener('input', (e) => {
      clearTimeout(catalogTimer);
      const q = e.target.value.trim();
      catalogTimer = setTimeout(async () => {
        const box = $('#catalog-results');
        if (q.length < 2) {
          box.innerHTML = '';
          return;
        }
        const { results } = await api(`/api/drug-catalog/search?q=${encodeURIComponent(q)}&limit=8`);
        if (!results.length) {
          box.innerHTML = `<p class="muted">No catalog matches. Free-text entry is fine.</p>`;
          return;
        }
        box.innerHTML = results
          .map(
            (r, i) =>
              `<button type="button" class="secondary catalog-pick" data-idx="${i}">${escapeHtml(r.displayName)}</button>`,
          )
          .join('');
        box._results = results;
        box.querySelectorAll('.catalog-pick').forEach((btn) => {
          btn.addEventListener('click', () => {
            const r = box._results[Number(btn.dataset.idx)];
            $('#med-name').value = r.displayName.replace(/\s*\(.*\)\s*$/, '');
            const first = (r.strengthsAndForms || [])[0];
            if (first) {
              const parts = String(first.strength || '').split(/\s+/);
              $('#med-strength').value = parts[0] || '';
              $('#med-strength-unit').value = parts.slice(1).join(' ') || '';
              $('#med-form-field').value = first.form || '';
              $('#med-rxcui').value = first.rxcui || '';
            }
            box.innerHTML = `<p class="muted">Prefill from catalog. Edit any field as needed.</p>`;
          });
        });
      }, 250);
    });
  }
}

async function renderMedicationDetail(id, kindHint = 'medication') {
  const { medication } = await api(`/api/medications/${id}`);
  const { transactions } = await api(`/api/medications/${id}/inventory-transactions`);
  const isSupp = medication.kind === 'supplement' || kindHint === 'supplement';
  const basePath = isSupp ? '/supplements' : '/medications';
  const app = $('#app');
  app.innerHTML = shell(`
      <p class="muted"><a href="${basePath}">Back to ${isSupp ? 'supplements' : 'medications'}</a></p>
    <section class="panel">
      <h1 class="hero-brand">${escapeHtml(medication.name)}</h1>
      <p class="meta"><span class="badge">${isSupp ? 'Supplement' : 'Medication'}</span>
        ${medication.form ? `<span class="badge">${escapeHtml(medication.form)}</span>` : ''}
        Stock ${escapeHtml(medication.currentStockCache)} ${escapeHtml(medication.stockUnit)}
        · ${escapeHtml(medication.supply?.stockState)} · est. ${medication.supply?.estimatedDays ?? 'n/a'} days</p>
      <div class="actions">
        <button id="btn-refill">Refill</button>
        <button class="secondary" id="btn-count">Manual count</button>
        <button class="secondary" id="btn-waste">Waste / prime</button>
        ${medication.status === 'active' ? `<button class="secondary" id="btn-pause">Pause</button>` : ''}
        ${medication.status === 'paused' ? `<button class="secondary" id="btn-resume">Resume</button>` : ''}
        ${medication.schedules?.some((s) => s.scheduleType === 'as_needed') ? `<button class="secondary" id="btn-prn">Log as-needed</button>` : ''}
      </div>
    </section>
    <section class="panel">
      <h2>Details</h2>
      <p class="muted">Update form, instructions, and whether this is an injectable that needs a site each dose.</p>
      <form id="med-edit-form" class="stack">
        <div class="grid-2">
          <label>Strength value<input name="strengthValue" value="${escapeHtml(medication.strengthValue ?? '')}" /></label>
          <label>Strength unit<input name="strengthUnit" value="${escapeHtml(medication.strengthUnit || '')}" placeholder="mg" /></label>
        </div>
        <label>Form<input name="form" value="${escapeHtml(medication.form || '')}" placeholder="tablet, capsule, pen…" /></label>
        <label>Stock unit<input name="stockUnit" value="${escapeHtml(medication.stockUnit || '')}" required placeholder="tablets or units" /></label>
        <label>Default units per dose<input name="defaultUnitsPerDose" type="number" step="any" value="${escapeHtml(medication.defaultUnitsPerDose ?? '1')}" /></label>
        <label>Instructions<textarea name="instructions">${escapeHtml(medication.instructions || '')}</textarea></label>
        ${
          isSupp
            ? ''
            : `<label><input type="checkbox" name="trackInjectionSite" ${medication.trackInjectionSite ? 'checked' : ''} /> Track injection site (pens/syringes only)</label>
               <p class="muted" style="margin:0">Leave unchecked for tablets and capsules. When on, Today asks for a site each dose.</p>`
        }
        <button type="submit">Save details</button>
      </form>
    </section>
    <section class="panel">
      <h2>Schedules</h2>
      <ul>${(medication.schedules || [])
        .filter((s) => s.active)
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.scheduleType)}</strong> ${escapeHtml(s.timeOfDay || '')} ${escapeHtml((s.daysOfWeek || []).join(','))} · ${escapeHtml(s.doseEntry)} · ${escapeHtml(s.unitsPerDose ?? '')} ${escapeHtml(medication.stockUnit)}
            <span class="muted">from ${escapeHtml(String(s.startDate).slice(0, 10))}${s.endDate ? ` to ${escapeHtml(String(s.endDate).slice(0, 10))}` : ''}</span></li>`,
        )
        .join('') || '<li class="muted">No active schedules</li>'}</ul>
      ${(medication.schedules || []).some((s) => !s.active)
        ? `<details style="margin-top:0.75rem"><summary class="muted">Past schedules</summary><ul>${(medication.schedules || [])
            .filter((s) => !s.active)
            .map(
              (s) =>
                `<li class="muted">${escapeHtml(s.scheduleType)} ${escapeHtml(s.timeOfDay || '')} · ${escapeHtml(s.unitsPerDose ?? '')} (ended)</li>`,
            )
            .join('')}</ul></details>`
        : ''}
      <h3 style="margin-top:1.25rem">Change schedule</h3>
      <p class="muted">For example: take 2 tablets starting in two weeks. Current schedule ends the day before the effective date.</p>
      <form id="schedule-replace-form" class="stack">
        <label>Effective start date<input name="startDate" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
        <label>Times of day (comma-separated HH:MM)<input name="times" value="${escapeHtml(
          (medication.schedules || [])
            .filter((s) => s.active && s.timeOfDay)
            .map((s) => s.timeOfDay)
            .join(',') || '08:00',
        )}" placeholder="08:00 or 08:00,20:00" /></label>
        <label>Units per dose<input name="unitsPerDose" type="number" step="any" min="0" value="${escapeHtml(
          (medication.schedules || []).find((s) => s.active)?.unitsPerDose ?? medication.defaultUnitsPerDose ?? '1',
        )}" /></label>
        <label>Schedule type
          <select name="scheduleType">
            <option value="daily" selected>Daily</option>
            <option value="weekly">Weekly</option>
            <option value="as_needed">As needed</option>
          </select>
        </label>
        <button type="submit">Save new schedule</button>
      </form>
    </section>
    <section class="panel">
      <h2>Inventory ledger</h2>
      <div class="table-wrap desktop-only">
        <table>
          <thead><tr><th>When</th><th>Kind</th><th>Delta</th><th>Balance</th><th>Notes</th></tr></thead>
          <tbody>
            ${transactions
              .map(
                (t) => `<tr>
                <td>${escapeHtml(new Date(t.occurredAt).toLocaleString())}</td>
                <td>${escapeHtml(t.kind)}</td>
                <td>${escapeHtml(t.quantityDelta)}</td>
                <td>${escapeHtml(t.balanceAfter)}</td>
                <td>${escapeHtml(t.notes || '')}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="mobile-cards mobile-only">
        ${transactions
          .map(
            (t) => `<article class="dose-card"><strong>${escapeHtml(t.kind)}</strong>
            <div class="meta">${escapeHtml(new Date(t.occurredAt).toLocaleString())}</div>
            <div>${escapeHtml(t.quantityDelta)} → ${escapeHtml(t.balanceAfter)}</div></article>`,
          )
          .join('')}
      </div>
    </section>
  `);

  $('#med-edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const body = {
        form: fd.get('form') || null,
        strengthValue: fd.get('strengthValue') || null,
        strengthUnit: fd.get('strengthUnit') || null,
        stockUnit: fd.get('stockUnit'),
        defaultUnitsPerDose: fd.get('defaultUnitsPerDose'),
        instructions: fd.get('instructions') || null,
        trackInjectionSite: isSupp ? false : fd.get('trackInjectionSite') === 'on',
      };
      const result = await api(`/api/medications/${id}`, { method: 'PUT', body });
      // Identity changes (strength/form/stock unit) replace the medication with a new id.
      const nextId = result.medication?.id || id;
      setFlash('Details saved', 'ok');
      navigate(`${basePath}/${nextId}`);
    } catch (err) {
      setFlash(err.message, 'error');
    }
  });

  $('#schedule-replace-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const times = String(fd.get('times') || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await api(`/api/medications/${id}/schedules/replace`, {
        method: 'POST',
        body: {
          startDate: fd.get('startDate'),
          timesOfDay: times,
          unitsPerDose: fd.get('unitsPerDose'),
          scheduleType: fd.get('scheduleType'),
        },
      });
      setFlash('Schedule updated', 'ok');
      render();
    } catch (err) {
      setFlash(err.message, 'error');
    }
  });

  $('#btn-refill')?.addEventListener('click', async () => {
    const quantity = prompt('Refill quantity');
    if (!quantity) return;
    await api(`/api/medications/${id}/refills`, { method: 'POST', body: { quantity } });
    setFlash('Refill recorded', 'ok');
    render();
  });
  $('#btn-count')?.addEventListener('click', async () => {
    const observedQuantity = prompt('Observed count');
    if (observedQuantity == null) return;
    await api(`/api/medications/${id}/manual-counts`, { method: 'POST', body: { observedQuantity } });
    setFlash('Manual count recorded', 'ok');
    render();
  });
  $('#btn-waste')?.addEventListener('click', async () => {
    const quantity = prompt('Waste / priming quantity');
    if (!quantity) return;
    await api(`/api/medications/${id}/waste`, { method: 'POST', body: { quantity } });
    setFlash('Waste recorded', 'ok');
    render();
  });
  $('#btn-pause')?.addEventListener('click', async () => {
    await api(`/api/medications/${id}/pause`, { method: 'POST', body: {} });
    render();
  });
  $('#btn-resume')?.addEventListener('click', async () => {
    await api(`/api/medications/${id}/resume`, { method: 'POST', body: {} });
    render();
  });
  $('#btn-prn')?.addEventListener('click', async () => {
    const amountTaken = prompt('Amount taken');
    if (!amountTaken) return;
    await api(`/api/medications/${id}/as-needed-dose`, { method: 'POST', body: { amountTaken } });
    setFlash('As-needed dose logged', 'ok');
    render();
  });
}

async function renderHealth() {
  const profile = requireProfile();
  const [bs, ketones, summaries] = await Promise.all([
    api(`/api/profiles/${profile.id}/health/blood-sugar`),
    api(`/api/profiles/${profile.id}/health/ketones`),
    api(`/api/profiles/${profile.id}/health/summaries`),
  ]);
  const app = $('#app');
  app.innerHTML = shell(`
    <h1 class="hero-brand">Health</h1>
    <p class="lede">Log readings with your own timestamps and context. The app does not interpret clinical meaning.</p>
    <div class="grid-2">
      <section class="panel">
        <h2>Blood sugar</h2>
        <form id="bs-form" class="stack">
          <label>Value<input name="value" type="number" step="any" required /></label>
          <label>Context
            <select name="context">
              <option value="fasting">Fasting</option>
              <option value="before_meal">Before meal</option>
              <option value="after_meal">After meal</option>
              <option value="bedtime">Bedtime</option>
              <option value="exercise">Exercise</option>
              <option value="illness">Illness</option>
              <option value="random">Random</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>When<input name="takenAt" type="datetime-local" /></label>
          <button type="submit">Save</button>
        </form>
        <h2 style="margin-top:1rem">Ketones</h2>
        <form id="ketone-form" class="stack">
          <label>Value<input name="value" type="number" step="any" required /></label>
          <label>Unit
            <select name="unit">
              <option value="mmol_L">mmol/L</option>
              <option value="mg_dL">mg/dL</option>
            </select>
          </label>
          <label>Context
            <select name="context">
              <option value="fasting">Fasting</option>
              <option value="random" selected>Random</option>
              <option value="illness">Illness</option>
              <option value="exercise">Exercise</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>When<input name="takenAt" type="datetime-local" /></label>
          <button type="submit">Save</button>
        </form>
      </section>
      <section class="panel">
        <h2>Weight</h2>
        <form id="wt-form" class="stack">
          <label>Value<input name="value" type="number" step="any" required /></label>
          <button type="submit">Save</button>
        </form>
        <h2 style="margin-top:1rem">Blood pressure</h2>
        <form id="bp-form" class="stack">
          <label>Systolic<input name="systolic" type="number" required /></label>
          <label>Diastolic<input name="diastolic" type="number" required /></label>
          <label>Pulse<input name="pulse" type="number" /></label>
          <button type="submit">Save</button>
        </form>
        <h2 style="margin-top:1rem">A1C</h2>
        <form id="a1c-form" class="stack">
          <label>Percent<input name="valuePercent" type="number" step="any" required /></label>
          <label>Date<input name="takenAt" type="date" /></label>
          <button type="submit">Save</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <h2>Summaries</h2>
      <p>Time-in-range: <strong>${summaries.timeInRange?.percent ?? 'n/a'}%</strong> ${summaries.timeInRange ? `(${escapeHtml(summaries.timeInRange.label)})` : '(set personal targets in Settings)'}</p>
      <p>Dose completion 7d / 30d: <strong>${summaries.completion7.percent ?? 'n/a'}%</strong> / <strong>${summaries.completion30.percent ?? 'n/a'}%</strong></p>
      <a href="/health/trends">Open trends</a>
      · <a href="/health/labs">Lab results</a>
    </section>
    <section class="panel">
      <h2>Import blood sugar CSV</h2>
      <p class="muted">Columns: taken_at, value, unit?, context?, notes?</p>
      <form id="bs-import" class="stack">
        <label>CSV<textarea name="csv" placeholder="2026-01-01T08:00:00,110,mg_dL,fasting"></textarea></label>
        <button type="submit">Import</button>
      </form>
    </section>
    <section class="panel">
      <h2>Recent blood sugar</h2>
      ${
        bs.readings.length
          ? `<ul>${bs.readings
              .slice(0, 12)
              .map(
                (r) =>
                  `<li>${escapeHtml(new Date(r.takenAt).toLocaleString())}: ${escapeHtml(r.value)} ${escapeHtml(r.unit)} (${escapeHtml(r.context)})</li>`,
              )
              .join('')}</ul>`
          : `<p class="empty">No readings yet.</p>`
      }
    </section>
    <section class="panel">
      <h2>Recent ketones</h2>
      ${
        ketones.readings.length
          ? `<ul>${ketones.readings
              .slice(0, 12)
              .map(
                (r) =>
                  `<li>${escapeHtml(new Date(r.takenAt).toLocaleString())}: ${escapeHtml(r.value)} ${escapeHtml(r.unit)} (${escapeHtml(r.context)})</li>`,
              )
              .join('')}</ul>`
          : `<p class="empty">No ketone readings yet.</p>`
      }
    </section>
  `);

  $('#bs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      value: fd.get('value'),
      context: fd.get('context'),
      takenAt: fd.get('takenAt') ? new Date(fd.get('takenAt')).toISOString() : undefined,
    };
    try {
      await api(`/api/profiles/${profile.id}/health/blood-sugar`, { method: 'POST', body });
      setFlash('Blood sugar saved', 'ok');
      render();
    } catch (err) {
      if (err.data?.needsConfirmation) {
        if (confirm(`${err.message}`)) {
          await api(`/api/profiles/${profile.id}/health/blood-sugar`, {
            method: 'POST',
            body: { ...body, confirmUnusual: true },
          });
          render();
        }
        return;
      }
      setFlash(err.message, 'error');
      render();
    }
  });
  $('#ketone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      value: fd.get('value'),
      unit: fd.get('unit'),
      context: fd.get('context'),
      takenAt: fd.get('takenAt') ? new Date(fd.get('takenAt')).toISOString() : undefined,
    };
    try {
      await api(`/api/profiles/${profile.id}/health/ketones`, { method: 'POST', body });
      setFlash('Ketone reading saved', 'ok');
      render();
    } catch (err) {
      if (err.data?.needsConfirmation) {
        if (confirm(`${err.message}`)) {
          await api(`/api/profiles/${profile.id}/health/ketones`, {
            method: 'POST',
            body: { ...body, confirmUnusual: true },
          });
          setFlash('Ketone reading saved', 'ok');
          render();
        }
        return;
      }
      setFlash(err.message, 'error');
      render();
    }
  });
  $('#wt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}/health/weight`, {
      method: 'POST',
      body: { value: fd.get('value') },
    });
    setFlash('Weight saved', 'ok');
    render();
  });
  $('#bp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      systolic: Number(fd.get('systolic')),
      diastolic: Number(fd.get('diastolic')),
      pulse: fd.get('pulse') ? Number(fd.get('pulse')) : null,
    };
    try {
      await api(`/api/profiles/${profile.id}/health/blood-pressure`, { method: 'POST', body });
      setFlash('Blood pressure saved', 'ok');
      render();
    } catch (err) {
      if (err.data?.needsConfirmation && confirm(err.message)) {
        await api(`/api/profiles/${profile.id}/health/blood-pressure`, {
          method: 'POST',
          body: { ...body, confirmUnusual: true },
        });
        render();
      } else {
        setFlash(err.message, 'error');
        render();
      }
    }
  });
  $('#a1c-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}/health/a1c`, {
      method: 'POST',
      body: {
        valuePercent: fd.get('valuePercent'),
        takenAt: fd.get('takenAt') || undefined,
      },
    });
    setFlash('A1C saved', 'ok');
    render();
  });
  $('#bs-import')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = await api(`/api/profiles/${profile.id}/health/blood-sugar/import`, {
      method: 'POST',
      body: { csv: fd.get('csv') },
    });
    setFlash(`Imported ${result.imported} readings`, result.errors?.length ? 'warn' : 'ok');
    render();
  });
}

async function renderTrends() {
  const profile = requireProfile();
  const from = new Date(Date.now() - 90 * 86400000).toISOString();
  const [bsRes, weightRes, bpRes, ketoneRes] = await Promise.all([
    api(`/api/profiles/${profile.id}/health/blood-sugar?from=${from}&take=500`),
    api(`/api/profiles/${profile.id}/health/weight?from=${from}&take=500`),
    api(`/api/profiles/${profile.id}/health/blood-pressure?from=${from}&take=500`),
    api(`/api/profiles/${profile.id}/health/ketones?from=${from}&take=500`),
  ]);

  const byTimeAsc = (a, b) => new Date(a.takenAt) - new Date(b.takenAt);
  const bloodSugar = [...(bsRes.readings || [])].sort(byTimeAsc);
  const weight = [...(weightRes.readings || [])].sort(byTimeAsc);
  const bloodPressure = [...(bpRes.readings || [])].sort(byTimeAsc);
  const ketones = [...(ketoneRes.readings || [])].sort(byTimeAsc);

  const app = $('#app');
  app.innerHTML = shell(`
    <h1 class="hero-brand">Trends</h1>
    <p class="lede">Last 90 days. Sparse data is labeled, not interpreted.</p>
    <section class="panel">
      <h2>Blood sugar</h2>
      ${
        bloodSugar.length
          ? `<div class="chart-box"><canvas id="bs-chart"></canvas></div>
             <p class="muted">${bloodSugar.length} readings</p>`
          : `<p class="empty">No blood sugar readings in this range.</p>`
      }
    </section>
    <section class="panel">
      <h2>Weight</h2>
      ${
        weight.length
          ? `<div class="chart-box"><canvas id="weight-chart"></canvas></div>
             <p class="muted">${weight.length} readings</p>`
          : `<p class="empty">No weight readings in this range.</p>`
      }
    </section>
    <section class="panel">
      <h2>Blood pressure</h2>
      ${
        bloodPressure.length
          ? `<div class="chart-box"><canvas id="bp-chart"></canvas></div>
             <p class="muted">${bloodPressure.length} readings</p>`
          : `<p class="empty">No blood pressure readings in this range.</p>`
      }
    </section>
    <section class="panel">
      <h2>Ketones</h2>
      ${
        ketones.length
          ? `<div class="chart-box"><canvas id="ketone-chart"></canvas></div>
             <p class="muted">${ketones.length} readings</p>`
          : `<p class="empty">No ketone readings in this range.</p>`
      }
    </section>
  `);

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true } },
    scales: {
      x: {
        ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 8 },
      },
    },
  };

  if (bloodSugar.length && $('#bs-chart')) {
    new Chart($('#bs-chart'), {
      type: 'line',
      data: {
        labels: bloodSugar.map((r) => new Date(r.takenAt).toLocaleDateString()),
        datasets: [
          {
            label: `Blood sugar (${profile.glucoseUnit || 'mg/dL'})`,
            data: bloodSugar.map((r) => Number(r.value)),
            borderColor: '#0f6b5c',
            backgroundColor: 'rgba(15, 107, 92, 0.12)',
            tension: 0.25,
            pointRadius: bloodSugar.length < 20 ? 4 : 2,
          },
        ],
      },
      options: chartDefaults,
    });
  }

  if (weight.length && $('#weight-chart')) {
    new Chart($('#weight-chart'), {
      type: 'line',
      data: {
        labels: weight.map((r) => new Date(r.takenAt).toLocaleDateString()),
        datasets: [
          {
            label: `Weight (${profile.weightUnit || 'lb'})`,
            data: weight.map((r) => Number(r.value)),
            borderColor: '#a35b12',
            backgroundColor: 'rgba(163, 91, 18, 0.12)',
            tension: 0.25,
            pointRadius: weight.length < 20 ? 4 : 2,
          },
        ],
      },
      options: chartDefaults,
    });
  }

  if (bloodPressure.length && $('#bp-chart')) {
    new Chart($('#bp-chart'), {
      type: 'line',
      data: {
        labels: bloodPressure.map((r) => new Date(r.takenAt).toLocaleDateString()),
        datasets: [
          {
            label: 'Systolic',
            data: bloodPressure.map((r) => Number(r.systolic)),
            borderColor: '#9b2c2c',
            tension: 0.25,
            pointRadius: bloodPressure.length < 20 ? 4 : 2,
          },
          {
            label: 'Diastolic',
            data: bloodPressure.map((r) => Number(r.diastolic)),
            borderColor: '#3b5bdb',
            tension: 0.25,
            pointRadius: bloodPressure.length < 20 ? 4 : 2,
          },
        ],
      },
      options: chartDefaults,
    });
  }

  if (ketones.length && $('#ketone-chart')) {
    new Chart($('#ketone-chart'), {
      type: 'line',
      data: {
        labels: ketones.map((r) => new Date(r.takenAt).toLocaleDateString()),
        datasets: [
          {
            label: 'Ketones (mmol/L or as logged)',
            data: ketones.map((r) => Number(r.value)),
            borderColor: '#0b6e99',
            backgroundColor: 'rgba(11, 110, 153, 0.12)',
            tension: 0.25,
            pointRadius: ketones.length < 20 ? 4 : 2,
          },
        ],
      },
      options: chartDefaults,
    });
  }
}

async function renderReports() {
  const profile = requireProfile();
  const app = $('#app');
  app.innerHTML = shell(`
    <section class="panel">
      <h1 class="hero-brand">Reports</h1>
      <p class="lede">On-demand doctor PDF and CSV/JSON exports. Date ranges use ${escapeHtml(profile.timezone)}.</p>
      <form id="report-form" class="stack">
        <label>Range
          <select name="range">
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 3 months</option>
            <option value="180d">Last 6 months</option>
            <option value="1y">Last 1 year</option>
            <option value="all">All time</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <div class="grid-2">
          <label>From<input name="from" type="date" /></label>
          <label>To<input name="to" type="date" /></label>
        </div>
        <label>Detail
          <select name="detail"><option value="summary">Summary</option><option value="complete">Complete</option></select>
        </label>
        <label>Recipient (optional)<input name="recipient" placeholder="Dr. Name" /></label>
        <div class="actions">
          <button type="button" id="btn-preview">Preview</button>
          <button type="button" id="btn-pdf">Download PDF</button>
          <button type="button" class="secondary" id="btn-wallet">Wallet card PDF</button>
          <a class="button secondary" id="csv-link" href="#">CSV</a>
          <a class="button secondary" id="json-link" href="#">JSON</a>
        </div>
      </form>
      <div id="preview" class="muted" style="margin-top:1rem"></div>
    </section>
  `);

  const form = $('#report-form');
  const syncLinks = () => {
    const fd = new FormData(form);
    const q = new URLSearchParams({
      range: fd.get('range'),
      from: fd.get('from') || '',
      to: fd.get('to') || '',
    });
    $('#csv-link').href = `/api/profiles/${profile.id}/export.csv?${q}`;
    $('#json-link').href = `/api/profiles/${profile.id}/export.json?${q}`;
  };
  form.addEventListener('change', syncLinks);
  syncLinks();

  $('#btn-preview').addEventListener('click', async () => {
    const fd = new FormData(form);
    const preview = await api(`/api/profiles/${profile.id}/reports/preview`, {
      method: 'POST',
      body: Object.fromEntries(fd.entries()),
    });
    if (preview.bloodSugarCount + preview.doseEventCount === 0) {
      $('#preview').innerHTML = `<div class="flash warn">No readings or dose events for the selected range.</div>`;
    } else {
      $('#preview').innerHTML = `<div class="flash ok">
        Range ${escapeHtml(preview.rangeLabel)} · meds ${preview.medicationCount} · doses ${preview.doseEventCount} ·
        BS ${preview.bloodSugarCount} · TIR ${preview.tir?.percent ?? 'n/a'}%
      </div>`;
    }
  });

  $('#btn-pdf').addEventListener('click', async () => {
    const fd = new FormData(form);
    if (!state.csrf) {
      const csrfRes = await fetch('/api/csrf');
      state.csrf = (await csrfRes.json()).csrfToken;
    }
    const res = await fetch(`/api/profiles/${profile.id}/reports/doctor.pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': state.csrf,
      },
      credentials: 'same-origin',
      body: JSON.stringify(Object.fromEntries(fd.entries())),
    });
    if (!res.ok) {
      setFlash('PDF generation failed', 'error');
      render();
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'report.pdf';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-wallet').addEventListener('click', async () => {
    const csrfRes = await fetch('/api/csrf', { credentials: 'same-origin' });
    state.csrf = (await csrfRes.json()).csrfToken;
    const res = await fetch(`/api/profiles/${profile.id}/reports/wallet-card.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      credentials: 'same-origin',
      body: '{}',
    });
    if (!res.ok) {
      setFlash('Wallet card failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wallet-card.pdf';
    a.click();
  });
}

async function renderSettings() {
  const profile = requireProfile();
  const [prefs, subs, scheduler, targets] = await Promise.all([
    api('/api/push/notification-preferences'),
    api('/api/push/subscriptions'),
    api('/api/push/scheduler-health'),
    api(`/api/profiles/${profile.id}/health-targets`),
  ]);
  const app = $('#app');
  const stale =
    subs.subscriptions.some(
      (s) => s.active && (!s.lastSuccessAt || Date.now() - new Date(s.lastSuccessAt).getTime() > 7 * 86400000),
    ) || false;
  const schedWarn =
    !scheduler.lastSuccessfulAt ||
    Date.now() - new Date(scheduler.lastSuccessfulAt).getTime() > 15 * 60 * 1000;

  app.innerHTML = shell(`
    <h1 class="hero-brand">Settings</h1>
    ${stale ? `<div class="flash warn">A push device looks stale. Send a test reminder.</div>` : ''}
    ${schedWarn ? `<div class="flash warn">Scheduler has not succeeded recently.</div>` : ''}
    <section class="panel">
      <h2>Profile</h2>
      <form id="profile-form" class="stack">
        <label>Display name<input name="displayName" value="${escapeHtml(profile.displayName)}" /></label>
        <label>Timezone<input name="timezone" value="${escapeHtml(profile.timezone)}" /></label>
        <label>Glucose unit
          <select name="glucoseUnit">
            <option value="mg_dL" ${profile.glucoseUnit === 'mg_dL' ? 'selected' : ''}>mg/dL</option>
            <option value="mmol_L" ${profile.glucoseUnit === 'mmol_L' ? 'selected' : ''}>mmol/L</option>
          </select>
        </label>
        <label>Weight unit
          <select name="weightUnit">
            <option value="lb" ${profile.weightUnit === 'lb' ? 'selected' : ''}>lb</option>
            <option value="kg" ${profile.weightUnit === 'kg' ? 'selected' : ''}>kg</option>
          </select>
        </label>
        <button type="submit">Save profile</button>
      </form>
    </section>
    <section class="panel">
      <h2>Personal blood-sugar targets</h2>
      <p class="muted">Optional. Used only for descriptive time-in-range; not clinical advice.</p>
      <form id="target-form" class="stack">
        <label>Low<input name="lowValue" type="number" step="any" value="${escapeHtml(targets.targets.find((t) => t.metricType === 'blood_sugar')?.lowValue || '')}" /></label>
        <label>High<input name="highValue" type="number" step="any" value="${escapeHtml(targets.targets.find((t) => t.metricType === 'blood_sugar')?.highValue || '')}" /></label>
        <button type="submit">Save targets</button>
      </form>
    </section>
    <section class="panel">
      <h2>Notifications</h2>
      <form id="prefs-form" class="stack">
        <label><input type="checkbox" name="dosePushEnabled" ${prefs.preferences?.dosePushEnabled ? 'checked' : ''}/> Dose push reminders</label>
        <label><input type="checkbox" name="lowStockEmailEnabled" ${prefs.preferences?.lowStockEmailEnabled ? 'checked' : ''}/> Low-stock email digest</label>
        <label><input type="checkbox" name="privatePreview" ${prefs.preferences?.privatePreview ? 'checked' : ''}/> Private lock-screen preview</label>
        <label>Quiet hours start<input name="quietHoursStart" placeholder="22:00" value="${escapeHtml(prefs.preferences?.quietHoursStart || '')}" /></label>
        <label>Quiet hours end<input name="quietHoursEnd" placeholder="07:00" value="${escapeHtml(prefs.preferences?.quietHoursEnd || '')}" /></label>
        <button type="submit">Save notification prefs</button>
      </form>
      <div class="actions" style="margin-top:0.75rem">
        <button type="button" id="btn-enable-push">Enable push on this device</button>
        <button type="button" class="secondary" id="btn-test-push">Send test push</button>
      </div>
      <p class="muted">Devices: ${subs.subscriptions.length}. Scheduler last success: ${escapeHtml(scheduler.lastSuccessfulAt || 'never')}</p>
    </section>
    <section class="panel">
      <h2>Two-factor authentication (TOTP)</h2>
      <p class="muted" id="totp-status">Checking…</p>
      <div class="actions">
        <button type="button" id="btn-totp-setup">Set up authenticator</button>
        <button type="button" class="secondary" id="btn-totp-enable">Enable with code</button>
        <button type="button" class="danger" id="btn-totp-disable">Disable</button>
      </div>
      <pre id="totp-secret" class="muted"></pre>
    </section>
    <section class="panel">
      <h2>Account</h2>
      <div class="actions">
        <a class="button secondary" href="/api/account/export" id="export-link">Export JSON</a>
        <button class="danger" id="btn-delete">Request account deletion</button>
        <button class="secondary" id="btn-logout">Log out</button>
      </div>
    </section>
  `);

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('timezone') !== profile.timezone) {
      if (!confirm('Changing timezone keeps the same local schedule times. Continue?')) return;
    }
    await api(`/api/profiles/${profile.id}`, { method: 'PUT', body: Object.fromEntries(fd.entries()) });
    await ensureSession();
    setFlash('Profile saved', 'ok');
    render();
  });
  $('#target-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}/health-targets`, {
      method: 'PUT',
      body: {
        targets: [
          {
            metricType: 'blood_sugar',
            context: 'any',
            lowValue: fd.get('lowValue') || null,
            highValue: fd.get('highValue') || null,
            unit: profile.glucoseUnit,
          },
        ],
      },
    });
    setFlash('Targets saved', 'ok');
    render();
  });
  $('#prefs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/user/notification-preferences', {
      method: 'PUT',
      body: {
        dosePushEnabled: fd.get('dosePushEnabled') === 'on',
        lowStockEmailEnabled: fd.get('lowStockEmailEnabled') === 'on',
        privatePreview: fd.get('privatePreview') === 'on',
        quietHoursStart: fd.get('quietHoursStart') || null,
        quietHoursEnd: fd.get('quietHoursEnd') || null,
      },
    });
    setFlash('Notification preferences saved', 'ok');
    render();
  });
  $('#btn-enable-push').addEventListener('click', async () => {
    try {
      await enablePush();
      setFlash('Push subscription saved', 'ok');
    } catch (err) {
      setFlash(err.message, 'error');
    }
    render();
  });
  api('/api/security/totp/status')
    .then((s) => {
      $('#totp-status').textContent = s.enabled ? 'Authenticator is enabled.' : 'Authenticator is not enabled.';
    })
    .catch(() => {});
  $('#btn-totp-setup')?.addEventListener('click', async () => {
    const result = await api('/api/security/totp/setup', { method: 'POST', body: {} });
    $('#totp-secret').textContent = `Secret: ${result.secret}\nAdd to your app: ${result.otpauth}`;
  });
  $('#btn-totp-enable')?.addEventListener('click', async () => {
    const code = prompt('Enter 6-digit authenticator code');
    if (!code) return;
    await api('/api/security/totp/enable', { method: 'POST', body: { code } });
    setFlash('TOTP enabled', 'ok');
    render();
  });
  $('#btn-totp-disable')?.addEventListener('click', async () => {
    const password = prompt('Confirm password to disable TOTP');
    if (!password) return;
    await api('/api/security/totp/disable', { method: 'POST', body: { password } });
    setFlash('TOTP disabled', 'ok');
    render();
  });
  $('#btn-test-push').addEventListener('click', async () => {
    const result = await api('/api/push/test', { method: 'POST', body: {} });
    setFlash(result.message || `Test push sent to ${result.sent} device(s)`, 'ok');
    render();
  });
  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    state.user = null;
    navigate('/login');
  });
  $('#btn-delete').addEventListener('click', async () => {
    if (!confirm('Request account deletion?')) return;
    await api('/api/account/delete-request', { method: 'POST', body: {} });
    setFlash('Deletion requested', 'warn');
    render();
  });
  $('#export-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const data = await api('/api/account/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 't2d-track-export.json';
    a.click();
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push unsupported on this device');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission denied');
  const reg = await navigator.serviceWorker.register('/sw.js');
  const { publicKey } = await api('/api/push/vapid-public-key');
  if (!publicKey) throw new Error('VAPID public key not configured on server');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  await api('/api/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
      deviceLabel: navigator.userAgent.slice(0, 80),
    },
  });
}

async function renderRecovery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const app = $('#app');
  if (!token) {
    app.innerHTML = shell(
      `<section class="panel auth-card">
        <h1 class="hero-brand">Account recovery</h1>
        <form id="recover-request" class="stack">
          <label>Email<input name="email" type="email" required /></label>
          <button type="submit">Send reset link</button>
        </form>
      </section>`,
      { showNav: false },
    );
    $('#recover-request').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/api/auth/recovery/request', { method: 'POST', body: { email: fd.get('email') } });
      setFlash('If that email exists, a reset link was sent', 'ok');
      render();
    });
    return;
  }
  app.innerHTML = shell(
    `<section class="panel auth-card">
      <h1 class="hero-brand">Choose a new password</h1>
      <form id="recover-complete" class="stack">
        <label>New password<input name="password" type="password" minlength="10" required /></label>
        <button type="submit">Update password</button>
      </form>
    </section>`,
    { showNav: false },
  );
  $('#recover-complete').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/auth/recovery/complete', {
      method: 'POST',
      body: { token, password: fd.get('password') },
    });
    setFlash('Password updated. Log in.', 'ok');
    navigate('/login');
  });
}

async function renderVerifyEmail() {
  const token = new URLSearchParams(window.location.search).get('token');
  const app = $('#app');
  if (!token) {
    app.innerHTML = shell(`<section class="panel"><p>Missing token.</p></section>`, { showNav: false });
    return;
  }
  try {
    await api('/api/auth/verify-email', { method: 'POST', body: { token } });
    app.innerHTML = shell(
      `<section class="panel auth-card"><h1 class="hero-brand">Email verified</h1><a href="/login">Continue</a></section>`,
      { showNav: false },
    );
  } catch (err) {
    app.innerHTML = shell(
      `<section class="panel auth-card"><h1 class="hero-brand">Verification failed</h1><p>${escapeHtml(err.message)}</p></section>`,
      { showNav: false },
    );
  }
}

async function renderHousehold() {
  const households = await api('/api/households');
  const householdId = households.households[0]?.id;
  if (!householdId) {
    $('#app').innerHTML = shell(`<section class="panel"><p>No household found.</p></section>`);
    return;
  }
  const { household } = await api(`/api/households/${householdId}`);
  const app = $('#app');
  app.innerHTML = shell(`
    <h1 class="hero-brand">Household</h1>
    <section class="panel">
      <h2>${escapeHtml(household.name)}</h2>
      <p class="muted">Members and profile access. Caregivers can be invited with view or manage permission.</p>
      <h3>Members</h3>
      <ul>${household.memberships
        .map(
          (m) =>
            `<li>${escapeHtml(m.user.name)} (${escapeHtml(m.user.email)}) · ${escapeHtml(m.role)}
            ${m.user.id !== state.user.id && households.households[0].role === 'owner' ? `<button class="secondary btn-remove" data-uid="${m.user.id}">Remove</button>` : ''}</li>`,
        )
        .join('')}</ul>
      <h3>Profiles</h3>
      <ul>${household.profiles
        .map(
          (p) =>
            `<li><strong>${escapeHtml(p.displayName)}</strong> · access: ${p.access
              .map((a) => `${escapeHtml(a.user.name)}=${a.permission}`)
              .join(', ')}</li>`,
        )
        .join('')}</ul>
    </section>
    <section class="panel">
      <h2>Invite someone</h2>
      <form id="invite-form" class="stack">
        <label>Role
          <select name="role"><option value="member">Member</option><option value="caregiver">Caregiver</option></select>
        </label>
        <label>Profile
          <select name="personProfileId">
            ${household.profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.displayName)}</option>`).join('')}
          </select>
        </label>
        <label>Permission
          <select name="permission"><option value="manage">Manage</option><option value="view">View</option></select>
        </label>
        <label>Email (optional send)<input name="email" type="email" /></label>
        <button type="submit">Create invitation link</button>
      </form>
      <pre id="invite-link" class="muted"></pre>
    </section>
    <section class="panel">
      <h2>Add person profile</h2>
      <form id="new-profile-form" class="stack">
        <label>Display name<input name="displayName" required /></label>
        <button type="submit">Create profile</button>
      </form>
    </section>
  `);
  $('#invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = await api(`/api/households/${householdId}/invitations`, {
      method: 'POST',
      body: Object.fromEntries(fd.entries()),
    });
    $('#invite-link').textContent = result.link;
    setFlash('Invitation created', 'ok');
  });
  $('#new-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/profiles', {
      method: 'POST',
      body: { householdId, displayName: fd.get('displayName') },
    });
    setFlash('Profile created', 'ok');
    render();
  });
  app.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this member?')) return;
      await api(`/api/households/${householdId}/members/${btn.dataset.uid}`, { method: 'DELETE' });
      render();
    });
  });
}

async function renderSupplies() {
  const profile = requireProfile();
  const { supplies } = await api(`/api/profiles/${profile.id}/supplies`);
  const app = $('#app');
  app.innerHTML = shell(`
    <div class="actions" style="justify-content:space-between;margin-bottom:1rem">
      <h1 class="hero-brand" style="margin:0">Supplies</h1>
    </div>
    <section class="panel">
      <h2>Add supply</h2>
      <form id="supply-form" class="stack">
        <label>Name<input name="name" required placeholder="Test strips" /></label>
        <label>Stock unit<input name="stockUnit" required placeholder="strips" /></label>
        <label>Opening balance<input name="openingBalance" type="number" value="100" /></label>
        <label>Expected daily use<input name="expectedDailyUse" type="number" step="any" /></label>
        <button type="submit">Save</button>
      </form>
    </section>
    <div class="stack">${supplies
      .map(
        (s) => `<article class="panel dose-card">
          <strong>${escapeHtml(s.name)}</strong>
          <div class="meta">${escapeHtml(s.currentStockCache)} ${escapeHtml(s.stockUnit)}</div>
          <div class="actions">
            <button data-id="${s.id}" class="btn-supply-refill">Refill</button>
            <button class="secondary btn-supply-count" data-id="${s.id}">Count</button>
          </div>
        </article>`,
      )
      .join('') || '<p class="empty">No supplies yet.</p>'}</div>
  `);
  $('#supply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}/supplies`, {
      method: 'POST',
      body: Object.fromEntries(fd.entries()),
    });
    render();
  });
  app.querySelectorAll('.btn-supply-refill').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const quantity = prompt('Refill quantity');
      if (!quantity) return;
      await api(`/api/supplies/${btn.dataset.id}/refills`, { method: 'POST', body: { quantity } });
      render();
    });
  });
  app.querySelectorAll('.btn-supply-count').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const observedQuantity = prompt('Observed count');
      if (observedQuantity == null) return;
      await api(`/api/supplies/${btn.dataset.id}/manual-counts`, {
        method: 'POST',
        body: { observedQuantity },
      });
      render();
    });
  });
}

async function renderLabs() {
  const profile = requireProfile();
  const { labs } = await api(`/api/profiles/${profile.id}/health/labs`);
  const app = $('#app');
  app.innerHTML = shell(`
    <h1 class="hero-brand">Lab results</h1>
    <section class="panel">
      <form id="lab-form" class="stack">
        <label>Test
          <input name="testName" list="lab-suggestions" required placeholder="eGFR" />
          <datalist id="lab-suggestions">
            <option value="eGFR"></option><option value="Creatinine"></option>
            <option value="LDL"></option><option value="HDL"></option>
            <option value="Triglycerides"></option><option value="Urine microalbumin"></option>
          </datalist>
        </label>
        <label>Value<input name="value" type="number" step="any" required /></label>
        <label>Unit<input name="unit" required placeholder="mg/dL" /></label>
        <label>Date<input name="takenAt" type="date" /></label>
        <button type="submit">Save</button>
      </form>
    </section>
    <section class="panel">
      <ul>${labs.map((l) => `<li>${escapeHtml(l.testName)}: ${escapeHtml(l.value)} ${escapeHtml(l.unit)} (${escapeHtml(String(l.takenAt).slice(0, 10))})</li>`).join('') || '<li class="empty">No labs yet</li>'}</ul>
      <a href="/health">Back to health</a>
    </section>
  `);
  $('#lab-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/api/profiles/${profile.id}/health/labs`, {
      method: 'POST',
      body: Object.fromEntries(fd.entries()),
    });
    render();
  });
}

async function renderInvite() {
  const token = new URLSearchParams(window.location.search).get('token');
  const app = $('#app');
  if (!token) {
    app.innerHTML = shell(`<section class="panel"><p>Missing invitation token.</p></section>`, {
      showNav: false,
    });
    return;
  }
  if (!state.user) {
    app.innerHTML = shell(
      `<section class="panel auth-card"><h1 class="hero-brand">Invitation</h1><p>Log in or register, then reopen this link.</p><a class="button" href="/login">Log in</a></section>`,
      { showNav: false },
    );
    return;
  }
  try {
    await api(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} });
    setFlash('Invitation accepted', 'ok');
    navigate('/household');
  } catch (err) {
    app.innerHTML = shell(
      `<section class="panel"><div class="flash error">${escapeHtml(err.message)}</div></section>`,
    );
  }
}

function bindShellEvents() {
  const sel = $('#profile-switch');
  if (sel) {
    sel.addEventListener('change', () => {
      localStorage.setItem('t2d_active_profile', sel.value);
      state.profile = state.profiles.find((p) => p.id === sel.value) || state.profile;
      render();
    });
  }
}

async function renderNotes() {
  const profile = requireProfile();
  const params = new URLSearchParams(location.search);
  const filterKind = params.get('kind') || '';
  const qs = filterKind ? `?kind=${encodeURIComponent(filterKind)}` : '';
  const [{ note: todayNote }, { notes }] = await Promise.all([
    api(`/api/profiles/${profile.id}/check-in/today`),
    api(`/api/profiles/${profile.id}/symptoms${qs}`),
  ]);
  const app = $('#app');
  app.innerHTML = shell(`
    <h1 class="hero-brand">Notes</h1>
    <p class="lede">How you feel, illness notes, and a short journal. Not clinical advice.</p>
    ${checkInPanelHtml(todayNote)}
    <section class="panel">
      <h2>Journal entry</h2>
      <form id="journal-form" class="stack">
        <label>Summary<input name="summary" required placeholder="Felt tired after lunch…" /></label>
        <label>Details<textarea name="details" rows="4" placeholder="Optional longer note"></textarea></label>
        <div class="chip-row" role="group" aria-label="Tags">
          ${FEELING_TAGS.map(
            (t) =>
              `<label class="chip"><input type="checkbox" name="jtag" value="${t}" /> ${escapeHtml(t.replace(/_/g, ' '))}</label>`,
          ).join('')}
        </div>
        <button type="submit">Save journal note</button>
      </form>
    </section>
    <section class="panel">
      <div class="actions" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">History</h2>
        <label class="muted" style="margin:0">Filter
          <select id="notes-filter" style="width:auto">
            <option value="" ${!filterKind ? 'selected' : ''}>All</option>
            <option value="check_in" ${filterKind === 'check_in' ? 'selected' : ''}>Check-ins</option>
            <option value="journal" ${filterKind === 'journal' ? 'selected' : ''}>Journal</option>
            <option value="illness" ${filterKind === 'illness' ? 'selected' : ''}>Illness</option>
            <option value="symptom" ${filterKind === 'symptom' ? 'selected' : ''}>Symptom</option>
            <option value="exercise" ${filterKind === 'exercise' ? 'selected' : ''}>Exercise</option>
            <option value="other" ${filterKind === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </label>
      </div>
      ${
        notes.length === 0
          ? `<p class="empty">No notes yet.</p>`
          : `<div class="stack" style="margin-top:1rem">${notes
              .map(
                (n) => `<article class="dose-card">
                <div><strong>${escapeHtml(n.summary)}</strong>
                  <span class="badge">${escapeHtml(n.kind)}</span>
                  ${n.mood != null ? `<span class="badge">mood ${n.mood}/5</span>` : ''}
                </div>
                <div class="meta">${escapeHtml(new Date(n.startedAt).toLocaleString())}
                  ${(n.tags || []).length ? ` · ${escapeHtml(n.tags.join(', '))}` : ''}</div>
                ${n.details ? `<p>${escapeHtml(n.details)}</p>` : ''}
              </article>`,
              )
              .join('')}</div>`
      }
    </section>
  `);

  bindCheckInForm(profile);

  $('#journal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const tags = [...e.target.querySelectorAll('input[name="jtag"]:checked')].map((el) => el.value);
    try {
      await api(`/api/profiles/${profile.id}/symptoms`, {
        method: 'POST',
        body: {
          kind: 'journal',
          summary: fd.get('summary'),
          details: fd.get('details') || null,
          tags,
        },
      });
      setFlash('Journal note saved', 'ok');
      navigate('/notes');
    } catch (err) {
      setFlash(err.message, 'error');
    }
  });

  $('#notes-filter')?.addEventListener('change', (e) => {
    const v = e.target.value;
    navigate(v ? `/notes?kind=${encodeURIComponent(v)}` : '/notes');
  });
}

async function render() {
  const app = $('#app');
  const p = path();
  try {
    if (!['/login', '/register', '/recovery', '/verify-email', '/', '/invite'].includes(p)) {
      const ok = await ensureSession();
      if (!ok) return navigate('/login');
    } else if (p === '/' || p === '/invite') {
      await ensureSession();
    }

    if (p === '/' || p === '') await renderHome();
    else if (p === '/login') await renderLogin();
    else if (p === '/register') await renderRegister();
    else if (p === '/onboarding') await renderOnboarding();
    else if (p === '/today') await renderToday();
    else if (p === '/medications') await renderMedications('medication');
    else if (p === '/medications/new') await renderMedicationNew('medication');
    else if (p.startsWith('/medications/')) await renderMedicationDetail(p.split('/')[2], 'medication');
    else if (p === '/supplements') await renderMedications('supplement');
    else if (p === '/supplements/new') await renderMedicationNew('supplement');
    else if (p.startsWith('/supplements/')) await renderMedicationDetail(p.split('/')[2], 'supplement');
    else if (p === '/notes') await renderNotes();
    else if (p === '/health') await renderHealth();
    else if (p === '/health/trends') await renderTrends();
    else if (p === '/health/labs') await renderLabs();
    else if (p === '/reports') await renderReports();
    else if (p === '/settings') await renderSettings();
    else if (p === '/household') await renderHousehold();
    else if (p === '/supplies') await renderSupplies();
    else if (p === '/invite') await renderInvite();
    else if (p === '/recovery') await renderRecovery();
    else if (p === '/verify-email') await renderVerifyEmail();
    else app.innerHTML = shell(`<section class="panel"><h1>Not found</h1></section>`);
    bindShellEvents();
  } catch (err) {
    app.innerHTML = shell(`<section class="panel"><div class="flash error">${escapeHtml(err.message)}</div></section>`);
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('/api/') || a.target === '_blank') return;
  if (href.startsWith('#')) return;
  e.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', () => render());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
