'use strict';

const SUPABASE_URL = 'https://jpfnrsxnnbtcadsnjrpc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwZm5yc3hubmJ0Y2Fkc25qcnBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwODk0NTIsImV4cCI6MjA5NDY2NTQ1Mn0.Kord4oX6j6cO9LjomvympIFoPhRLEG04pSW8kASe7DY';
const RESET_URL = 'https://www.anytimeanywork.com/clients/?mode=reset';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const views = ['loadingView', 'loginView', 'forgotView', 'passwordView', 'pendingView', 'dashboardView', 'adminView'];
const $ = (id) => document.getElementById(id);
const state = { session: null, accounts: [], account: null, shifts: [], isAdmin: false, adminRole: null };
let passwordMode = ['reset', 'setup'].includes(new URLSearchParams(location.search).get('mode')) ||
  /(?:^|[&#])type=(?:recovery|invite)(?:&|$)/.test(location.hash);

function showView(id) {
  views.forEach((view) => $(view).classList.toggle('hidden', view !== id));
  $('logoutButton').classList.toggle('hidden', !['dashboardView', 'adminView'].includes(id));
}

function message(id, text, success = false) {
  const element = $(id);
  element.textContent = text || '';
  element.classList.toggle('hidden', !text);
  element.classList.toggle('success', success);
}

function busy(form, enabled) {
  form.querySelectorAll('button, input').forEach((element) => { element.disabled = enabled; });
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(value) { return value ? String(value).slice(0, 5) : '—'; }

function isOpen(shift) {
  const name = String(shift.worker_name || '').trim().toLowerCase();
  return !shift.cancelled && (!name || name === 'available');
}

function shiftStatus(shift) {
  if (shift.cancelled) return ['Cancelled', 'cancelled'];
  if (isOpen(shift)) return ['Open slot', 'open'];
  if (shift.clock_out) return ['Completed', 'completed'];
  if (shift.clock_in) return ['In progress', 'ongoing'];
  return ['Scheduled', 'scheduled'];
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value == null || value === '' ? '—' : String(value);
  row.appendChild(cell);
  return cell;
}

function renderShifts() {
  const query = $('shiftSearch').value.trim().toLowerCase();
  const list = state.shifts.filter((shift) => !query || [shift.worker_name, shift.outlet, shift.role, shift.shift_date]
    .some((value) => String(value || '').toLowerCase().includes(query)));
  const body = $('shiftRows');
  body.replaceChildren();
  list.slice(0, 1000).forEach((shift) => {
    const row = document.createElement('tr');
    addCell(row, fmtDate(shift.shift_date));
    addCell(row, shift.outlet);
    addCell(row, isOpen(shift) ? 'Available' : shift.worker_name);
    addCell(row, shift.role);
    addCell(row, `${fmtTime(shift.scheduled_start)}–${fmtTime(shift.scheduled_end)}`);
    addCell(row, fmtTime(shift.clock_in));
    addCell(row, fmtTime(shift.clock_out));
    const [label, status] = shiftStatus(shift);
    const statusCell = addCell(row, '');
    const badge = document.createElement('span');
    badge.className = `status ${status}`;
    badge.textContent = label;
    statusCell.appendChild(badge);
    body.appendChild(row);
  });
  $('emptyShifts').classList.toggle('hidden', list.length > 0);
}

function renderSummary() {
  const today = new Date().toISOString().slice(0, 10);
  $('upcomingCount').textContent = state.shifts.filter((shift) => !shift.cancelled && !isOpen(shift) && !shift.clock_in && String(shift.shift_date || '').slice(0, 10) >= today).length;
  $('ongoingCount').textContent = state.shifts.filter((shift) => shift.clock_in && !shift.clock_out && !shift.cancelled).length;
  $('completedCount').textContent = state.shifts.filter((shift) => shift.clock_out && !shift.cancelled).length;
  $('openCount').textContent = state.shifts.filter((shift) => isOpen(shift) && String(shift.shift_date || '').slice(0, 10) >= today).length;
}

function renderAdminSummary() {
  $('adminTotalCount').textContent = state.accounts.length;
  $('adminEnabledCount').textContent = state.accounts.filter((account) => account.access_enabled).length;
  $('adminReviewCount').textContent = state.accounts.filter((account) => account.email_status === 'needs_review').length;
  $('adminLinkedCount').textContent = state.accounts.filter((account) => account.auth_user_id).length;
}

function adminAccountSearchText(account) {
  return [account.display_name, account.legacy_contact_email, account.login_email, ...(account.outlets || [])]
    .map((value) => String(value || '').toLowerCase()).join(' ');
}

function renderAdminAccounts() {
  const query = $('adminSearch').value.trim().toLowerCase();
  const accounts = state.accounts.filter((account) => !query || adminAccountSearchText(account).includes(query));
  const body = $('adminAccountRows');
  body.replaceChildren();

  accounts.forEach((account) => {
    const row = document.createElement('tr');
    row.dataset.clientId = account.legacy_client_id;

    const clientCell = document.createElement('td');
    clientCell.className = 'admin-client';
    const name = document.createElement('strong');
    name.textContent = account.display_name;
    const outlets = document.createElement('small');
    outlets.textContent = (account.outlets || []).join(' · ') || 'No outlets assigned';
    clientCell.append(name, outlets);
    row.appendChild(clientCell);

    addCell(row, account.legacy_contact_email || '—');

    const emailCell = document.createElement('td');
    const email = document.createElement('input');
    email.type = 'email';
    email.autocomplete = 'off';
    email.className = 'admin-login-email';
    email.value = account.login_email || '';
    email.placeholder = 'real-inbox@example.com';
    email.setAttribute('aria-label', `Login email for ${account.display_name}`);
    emailCell.appendChild(email);
    row.appendChild(emailCell);

    const accessCell = document.createElement('td');
    const accessLabel = document.createElement('label');
    accessLabel.className = 'access-toggle';
    const access = document.createElement('input');
    access.type = 'checkbox';
    access.className = 'admin-access-enabled';
    access.checked = Boolean(account.access_enabled);
    const accessText = document.createElement('span');
    accessText.textContent = account.access_enabled ? 'Enabled' : 'Disabled';
    access.addEventListener('change', () => { accessText.textContent = access.checked ? 'Enabled' : 'Disabled'; });
    accessLabel.append(access, accessText);
    accessCell.appendChild(accessLabel);
    row.appendChild(accessCell);

    const authCell = document.createElement('td');
    const authState = document.createElement('span');
    authState.className = `link-state ${account.auth_user_id ? 'linked' : (account.access_enabled ? 'review' : '')}`;
    authState.textContent = account.auth_user_id ? 'Linked' : (account.access_enabled ? 'Awaiting invite' : 'Not linked');
    authCell.appendChild(authState);
    row.appendChild(authCell);

    const actionCell = document.createElement('td');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'button secondary admin-save-access';
    save.textContent = 'Save access';
    save.addEventListener('click', () => saveAdminAccess(account, row, save));
    actionCell.appendChild(save);
    row.appendChild(actionCell);

    body.appendChild(row);
  });

  $('emptyAdminAccounts').classList.toggle('hidden', accounts.length > 0);
}

async function saveAdminAccess(account, row, button) {
  const email = row.querySelector('.admin-login-email').value.trim();
  const enabled = row.querySelector('.admin-access-enabled').checked;

  if (enabled && !email) {
    return message('adminMessage', `Enter and verify a real inbox for ${account.display_name} before enabling access.`);
  }
  if (enabled && !window.confirm(`Confirm that ${email} is a real inbox controlled by ${account.display_name}. This authorises it as the portal login identity.`)) {
    return;
  }

  button.disabled = true;
  message('adminMessage', 'Saving access settings…', true);
  const { data, error } = await sb.rpc('admin_update_client_portal_access', {
    p_legacy_client_id: account.legacy_client_id,
    p_login_email: email || null,
    p_access_enabled: enabled
  });
  button.disabled = false;

  if (error) return message('adminMessage', error.message || 'The access settings could not be saved.');

  Object.assign(account, data || {});
  renderAdminSummary();
  renderAdminAccounts();
  message('adminMessage', enabled
    ? `Access identity saved for ${account.display_name}. If Auth is not linked, send an invitation from Supabase Auth next.`
    : `Access remains disabled for ${account.display_name}.`, true);
}

async function loadAdminDashboard(adminRecord) {
  const { data, error } = await sb.from('client_portal_accounts')
    .select('legacy_client_id,display_name,legacy_contact_email,login_email,email_status,access_enabled,auth_user_id,outlets')
    .order('display_name');
  if (error) {
    showView('pendingView');
    return;
  }

  state.isAdmin = true;
  state.adminRole = adminRecord.role;
  state.accounts = data || [];
  $('adminRoleBadge').textContent = adminRecord.role === 'owner' ? 'Owner' : 'Administrator';
  showView('adminView');
  renderAdminSummary();
  renderAdminAccounts();
}

async function selectAccount(legacyClientId) {
  state.account = state.accounts.find((account) => account.legacy_client_id === legacyClientId) || state.accounts[0];
  if (!state.account) return;
  $('companyName').textContent = state.account.display_name;
  $('companyMeta').textContent = (state.account.outlets || []).join(' · ') || 'No outlets assigned';
  message('dashboardMessage', 'Loading your shifts…', true);
  const { data, error } = await sb.rpc('get_my_client_shifts', { p_legacy_client_id: state.account.legacy_client_id });
  if (error) {
    state.shifts = [];
    message('dashboardMessage', 'We could not load your shifts. Please contact your account manager.');
  } else {
    state.shifts = Array.isArray(data) ? data : [];
    message('dashboardMessage', '');
  }
  renderSummary();
  renderShifts();
}

async function loadDashboard(session) {
  showView('loadingView');
  const { data: adminRecord } = await sb.from('client_portal_admins')
    .select('role')
    .eq('auth_user_id', session.user.id)
    .eq('active', true)
    .maybeSingle();
  if (adminRecord) return loadAdminDashboard(adminRecord);

  const { data, error } = await sb.from('client_portal_accounts')
    .select('legacy_client_id,display_name,outlets,roster_enabled,pays_by_card')
    .eq('auth_user_id', session.user.id)
    .eq('access_enabled', true)
    .eq('email_status', 'verified')
    .order('display_name');
  if (error || !data || !data.length) {
    showView('pendingView');
    return;
  }
  state.accounts = data;
  const picker = $('accountPicker');
  picker.replaceChildren();
  data.forEach((account) => {
    const option = document.createElement('option');
    option.value = account.legacy_client_id;
    option.textContent = account.display_name;
    picker.appendChild(option);
  });
  $('accountPickerWrap').classList.toggle('hidden', data.length < 2);
  showView('dashboardView');
  await selectAccount(data[0].legacy_client_id);
}

async function route(session) {
  state.session = session;
  if (passwordMode) {
    showView('passwordView');
    if (!session) message('passwordMessage', 'This link is invalid or has expired. Request a new reset link.');
    return;
  }
  if (!session) return showView('loginView');
  await loadDashboard(session);
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('loginMessage', '');
  busy(event.currentTarget, true);
  const { error } = await sb.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
  busy(event.currentTarget, false);
  if (error) message('loginMessage', 'Incorrect email or password. Use “Forgot your password?” if needed.');
});

$('forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('forgotMessage', '');
  busy(event.currentTarget, true);
  const { error } = await sb.auth.resetPasswordForEmail($('forgotEmail').value.trim(), { redirectTo: RESET_URL });
  busy(event.currentTarget, false);
  if (error) message('forgotMessage', 'The reset email could not be sent. Please contact your account manager.');
  else message('forgotMessage', 'If this email is registered, a reset link has been sent.', true);
});

$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('newPassword').value;
  if (password.length < 12) return message('passwordMessage', 'Use at least 12 characters.');
  if (password !== $('confirmPassword').value) return message('passwordMessage', 'The passwords do not match.');
  message('passwordMessage', '');
  busy(event.currentTarget, true);
  const { error } = await sb.auth.updateUser({ password });
  busy(event.currentTarget, false);
  if (error) return message('passwordMessage', error.message || 'The password could not be updated.');
  passwordMode = false;
  history.replaceState({}, document.title, '/clients/');
  message('passwordMessage', 'Password saved. Opening your dashboard…', true);
  const { data } = await sb.auth.getSession();
  setTimeout(() => route(data.session), 500);
});

$('showForgotButton').addEventListener('click', () => { $('forgotEmail').value = $('loginEmail').value; showView('forgotView'); });
$('backToLoginButton').addEventListener('click', () => showView('loginView'));
$('shiftSearch').addEventListener('input', renderShifts);
$('adminSearch').addEventListener('input', renderAdminAccounts);
$('accountPicker').addEventListener('change', (event) => selectAccount(event.target.value));

async function logout() {
  await sb.auth.signOut();
  state.accounts = [];
  state.account = null;
  state.shifts = [];
  state.isAdmin = false;
  state.adminRole = null;
  showView('loginView');
}
$('logoutButton').addEventListener('click', logout);
$('pendingLogoutButton').addEventListener('click', logout);

try {
  localStorage.removeItem('cp_accounts_backup_v1');
  localStorage.removeItem('cp_session_v1');
  sessionStorage.removeItem('cp_accounts_backup_v1');
  sessionStorage.removeItem('cp_session_v1');
} catch (_) {}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') passwordMode = true;
  setTimeout(() => route(session), 0);
});
sb.auth.getSession().then(({ data }) => route(data.session));
