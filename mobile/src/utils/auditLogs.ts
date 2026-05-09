type AuditLogLike = {
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  action_label?: string | null;
  summary?: string | null;
  ip_address?: string | null;
  user_email?: string | null;
  user_full_name?: string | null;
};

type JsonRecord = Record<string, unknown>;

const HIDDEN_CHANGE_KEYS = new Set([
  'id',
  'password_hash',
  'security_stamp',
  'updated_at',
  'created_at',
  'last_login',
  'failed_login_attempts',
]);

const KEY_LABELS: Record<string, string> = {
  admin_deleted_at: 'admin delete time',
  admin_delete_reason: 'admin delete reason',
  audit_retention_months: 'audit retention',
  blocked_until: 'blocked until',
  current_balance: 'current balance',
  db_size_mb: 'database size',
  default_currency: 'default currency',
  delivery_count: 'delivery count',
  duration_minutes: 'duration',
  email_verified_at: 'email verification',
  expires_in: 'expires in',
  is_active: 'status',
  lockout_attempts: 'lockout attempts',
  lockout_minutes: 'lockout minutes',
  max_accounts_per_user: 'max accounts per user',
  must_change_password: 'must change password',
  password_min_length: 'password minimum length',
  password_requires_special: 'password special character rule',
  related_count: 'related transactions',
  target_balance: 'target balance',
  transaction_action: 'transaction handling',
  webhook_timeout_ms: 'webhook timeout',
};

function parseAuditValue(value?: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function sentence(value: string) {
  return value.endsWith('.') || value.endsWith('?') || value.endsWith('!') ? value : `${value}.`;
}

export function auditActionLabel(action?: string | null) {
  return String(action || 'AUDIT_EVENT')
    .replace(/^ADMIN_/, '')
    .replace(/^USER_/, '')
    .replace(/^SECURITY_/, 'SECURITY ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatKey(key: string) {
  return KEY_LABELS[key] || key.replace(/_/g, ' ');
}

function formatValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') {
    if (key === 'is_active') return value ? 'active' : 'inactive';
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    if (key === 'duration_minutes') return `${value} minute${value === 1 ? '' : 's'}`;
    if (key?.includes('amount') || key?.includes('balance') || key === 'delta' || key === 'total') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }
    return String(value);
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'recorded details';
  return String(value);
}

function actor(log: AuditLogLike) {
  return log.user_email || log.user_full_name || 'An administrator';
}

function targetFrom(oldValue: JsonRecord | null, newValue: JsonRecord | null, log: AuditLogLike) {
  const target = newValue?.target_user_email
    || newValue?.email
    || oldValue?.email
    || newValue?.name
    || oldValue?.name
    || log.entity_id;
  return typeof target === 'string' && target.trim() ? target : 'the selected record';
}

function firstSecurityFinding(newValue: JsonRecord | null) {
  const findings = asArray(newValue?.findings);
  return asRecord(findings?.[0]);
}

export function auditSecurityFinding(log: AuditLogLike) {
  const newValue = asRecord(parseAuditValue(log.new_value));
  const finding = firstSecurityFinding(newValue);
  if (!finding) return null;
  return sentence(`${formatValue(finding.attack_type || 'suspicious input')} in ${formatValue(finding.input_path || 'a request field')}: ${formatValue(finding.input_preview || 'no preview')}`);
}

export function auditEnglishSummary(log: AuditLogLike) {
  if (log.summary?.trim()) return sentence(log.summary.trim());

  const oldValue = asRecord(parseAuditValue(log.old_value));
  const newValue = asRecord(parseAuditValue(log.new_value));
  const who = actor(log);
  const target = targetFrom(oldValue, newValue, log);

  switch (log.action) {
    case 'ADMIN_UPDATED_USER_STATUS':
      return `${who} ${newValue?.is_active ? 'activated' : 'deactivated'} ${target}.`;
    case 'ADMIN_UPDATED_USER_ROLE':
      return `${who} changed ${target} to ${formatValue(newValue?.role || 'a new role')}.`;
    case 'ADMIN_RESET_USER_PASSWORD':
      return `${who} reset the password for ${target}; the user must choose a new password at next login.`;
    case 'ADMIN_SOFT_DELETED_TRANSACTION':
      return `${who} soft-deleted ${formatValue(newValue?.related_count || 1)} transaction${Number(newValue?.related_count || 1) === 1 ? '' : 's'}${newValue?.reason ? ` because: ${formatValue(newValue.reason)}` : '.'}`;
    case 'ADMIN_DELETED_USER_ACCOUNT':
      return `${who} deleted account "${formatValue(oldValue?.name || log.entity_id)}"${newValue?.reason ? ` because: ${formatValue(newValue.reason)}` : '.'}`;
    case 'ADMIN_UPDATED_USER_ACCOUNT_STATUS':
      return `${who} ${newValue?.is_active ? 'reactivated' : 'closed'} account "${formatValue(oldValue?.name || log.entity_id)}"${newValue?.reason ? ` because: ${formatValue(newValue.reason)}` : '.'}`;
    case 'ADMIN_CREATED_BALANCE_CORRECTION':
      return `${who} created a balance correction${newValue?.reason ? ` because: ${formatValue(newValue.reason)}` : '.'}`;
    case 'ADMIN_UPDATED_SYSTEM_CONFIG':
      return `${who} updated system configuration.`;
    case 'ADMIN_CREATED_ANNOUNCEMENT':
      return `${who} created announcement "${formatValue(newValue?.title || log.entity_id)}".`;
    case 'ADMIN_UPDATED_ANNOUNCEMENT':
      return `${who} updated announcement "${formatValue(newValue?.title || oldValue?.title || log.entity_id)}".`;
    case 'ADMIN_DELETED_ANNOUNCEMENT':
      return `${who} deleted announcement "${formatValue(oldValue?.title || log.entity_id)}".`;
    case 'ADMIN_CREATED_API_TOKEN':
      return `${who} created API token "${formatValue(newValue?.name || log.entity_id)}".`;
    case 'ADMIN_REVOKED_API_TOKEN':
      return `${who} revoked API token "${formatValue(oldValue?.name || log.entity_id)}".`;
    case 'ADMIN_CREATED_WEBHOOK':
      return `${who} created webhook "${formatValue(newValue?.name || log.entity_id)}".`;
    case 'ADMIN_UPDATED_WEBHOOK':
      return `${who} updated webhook "${formatValue(newValue?.name || oldValue?.name || log.entity_id)}".`;
    case 'ADMIN_BLOCKED_SECURITY_IP':
      return `${who} blocked IP ${formatValue(log.entity_id || newValue?.ip)}.`;
    case 'ADMIN_CLEARED_SECURITY_IP':
      return `${who} cleared security block for ${formatValue(log.entity_id || newValue?.ip)}.`;
    case 'ADMIN_STARTED_IMPERSONATION':
      return `${who} started support mode for ${target}.`;
    case 'SECURITY_ATTACK_ATTEMPT':
      return auditSecurityFinding(log) || `Security monitor detected suspicious input from ${formatValue(log.ip_address || 'unknown source')}.`;
    case 'USER_LOGIN':
      return `${target} signed in.`;
    case 'USER_LOGOUT':
      return `${target} signed out.`;
    case 'PASSWORD_CHANGED':
      return `${target} changed their password.`;
    default:
      return `${who} performed ${auditActionLabel(log.action)} on ${log.entity_type || 'the system'}${log.entity_id ? ` ${log.entity_id}` : ''}.`;
  }
}

function changedKeys(oldValue: JsonRecord, newValue: JsonRecord) {
  const keys = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])];
  return keys.filter((key) => !HIDDEN_CHANGE_KEYS.has(key) && JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]));
}

export function auditEnglishDetails(log: AuditLogLike) {
  const oldParsed = parseAuditValue(log.old_value);
  const newParsed = parseAuditValue(log.new_value);
  const oldValue = asRecord(oldParsed);
  const newValue = asRecord(newParsed);
  const details: string[] = [];

  if (log.action.startsWith('SECURITY_')) {
    const finding = auditSecurityFinding(log);
    if (finding) details.push(finding);
  }

  if (log.action === 'ADMIN_SOFT_DELETED_TRANSACTION' && newValue) {
    if (newValue.reason) details.push(`Reason: ${formatValue(newValue.reason)}`);
    if (newValue.related_count) details.push(`Affected transactions: ${formatValue(newValue.related_count)}`);
  }

  if (log.action === 'ADMIN_DELETED_USER_ACCOUNT' && newValue) {
    if (newValue.reason) details.push(`Reason: ${formatValue(newValue.reason)}`);
    if (newValue.transaction_action) details.push(`Transaction handling: ${formatValue(newValue.transaction_action)}`);
  }

  if (log.action === 'ADMIN_RESET_USER_PASSWORD' && newValue) {
    const delivery = asRecord(newValue.delivery);
    details.push(`Temporary password ${delivery?.sent ? 'was emailed to the user' : 'requires manual handoff'}.`);
    details.push('The user is forced to choose a new password after signing in.');
  }

  if (oldValue && newValue) {
    changedKeys(oldValue, newValue).slice(0, 8).forEach((key) => {
      details.push(`${formatKey(key)} changed from ${formatValue(oldValue[key], key)} to ${formatValue(newValue[key], key)}.`);
    });
  } else if (newValue) {
    Object.entries(newValue)
      .filter(([key]) => !HIDDEN_CHANGE_KEYS.has(key))
      .slice(0, 8)
      .forEach(([key, value]) => {
        details.push(`${formatKey(key)}: ${formatValue(value, key)}.`);
      });
  } else if (Array.isArray(oldParsed)) {
    details.push(`Previous state included ${oldParsed.length} related record${oldParsed.length === 1 ? '' : 's'}.`);
  }

  return [...new Set(details.map(sentence))];
}

export function formatAuditJson(value?: string | null) {
  if (!value) return 'None';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
