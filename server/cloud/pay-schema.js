// The payment tables. No imports, so db.js can create them with everything else and the clean-up paths can always name them.
// Every row carries livemode: a test purchase must never open anything once the building is on live keys, and a test account can't take real money.
export const PAY_SCHEMA = `
CREATE TABLE IF NOT EXISTS pay_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pay_accounts (
  floor_id INTEGER NOT NULL, livemode INTEGER NOT NULL, account TEXT NOT NULL, charges_enabled INTEGER NOT NULL DEFAULT 0, payouts_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0, missing TEXT NOT NULL DEFAULT '[]', disabled_reason TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
  portal_config TEXT NOT NULL DEFAULT '', disconnected_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, livemode)
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_accounts_account ON pay_accounts(account);
CREATE TABLE IF NOT EXISTS pay_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, livemode INTEGER NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, interval TEXT NOT NULL DEFAULT '', gates TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, agent_name TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '',
  stripe_product TEXT NOT NULL DEFAULT '', stripe_price TEXT NOT NULL DEFAULT '', decided_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_products_live ON pay_products(floor_id, project, livemode, key) WHERE status='live';
CREATE INDEX IF NOT EXISTS pay_products_floor ON pay_products(floor_id, status);
CREATE TABLE IF NOT EXISTS pay_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, floor_id INTEGER NOT NULL, project TEXT NOT NULL, livemode INTEGER NOT NULL, account TEXT NOT NULL, product_id INTEGER NOT NULL, product_key TEXT NOT NULL,
  owner TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '', session_url TEXT NOT NULL DEFAULT '', customer TEXT NOT NULL DEFAULT '',
  subscription TEXT NOT NULL DEFAULT '', sub_status TEXT NOT NULL DEFAULT '', payment_intent TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, paid_at INTEGER, ended_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pay_orders_owner ON pay_orders(floor_id, project, livemode, owner, product_key, status);
CREATE INDEX IF NOT EXISTS pay_orders_session ON pay_orders(account, session_id);
CREATE INDEX IF NOT EXISTS pay_orders_sub ON pay_orders(account, subscription);
CREATE INDEX IF NOT EXISTS pay_orders_floor ON pay_orders(floor_id, livemode, status, created_at);
CREATE TABLE IF NOT EXISTS pay_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, floor_id INTEGER NOT NULL, livemode INTEGER NOT NULL, ref TEXT NOT NULL UNIQUE, payment_intent TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pay_sales_floor ON pay_sales(floor_id, livemode, day);
CREATE INDEX IF NOT EXISTS pay_sales_pi ON pay_sales(payment_intent);
CREATE TABLE IF NOT EXISTS pay_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
`;
export const PAY_FLOOR_TABLES = ['pay_accounts', 'pay_products', 'pay_orders', 'pay_sales'];
