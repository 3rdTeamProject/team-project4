-- SQLite fixture matching the shared orders column layout. Temporary test DB only.
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_no VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'received',
    total_points INTEGER NOT NULL CHECK(total_points >= 0),
    recipient_name VARCHAR(50), recipient_phone VARCHAR(30), zip VARCHAR(10),
    address VARCHAR(200), address_detail VARCHAR(100), request_memo VARCHAR(200),
    courier VARCHAR(50), tracking_no VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    shipped_at TIMESTAMP, delivered_at TIMESTAMP,
    CHECK(status IN ('received','preparing','shipping','delivered','completed'))
);
CREATE INDEX orders_user_id_created_at_idx ON orders(user_id, created_at DESC);
