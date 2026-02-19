from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


DB_PATH = Path(__file__).resolve().parents[1] / "data.db"
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_context():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema_upgrades() -> None:
    """Lightweight SQLite upgrades for V1 auth + multi-tenant."""
    with engine.begin() as conn:
        table_names = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            ).fetchall()
        }

        def has_column(table: str, column: str) -> bool:
            rows = conn.execute(text(f"PRAGMA table_info('{table}')")).fetchall()
            return any(str(row[1]) == column for row in rows)

        if "tenants" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE tenants (
                        id VARCHAR(64) PRIMARY KEY,
                        name VARCHAR(255) NOT NULL
                    )
                    """
                )
            )
            table_names.add("tenants")

        if "users" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE users (
                        id VARCHAR(64) PRIMARY KEY,
                        username VARCHAR(128) NOT NULL UNIQUE,
                        account VARCHAR(128) NOT NULL UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        email VARCHAR(255),
                        mobile VARCHAR(64),
                        must_change_password BOOLEAN NOT NULL DEFAULT 0,
                        default_tenant_id VARCHAR(64),
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_account ON users(account)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_default_tenant_id ON users(default_tenant_id)"))
            table_names.add("users")
        else:
            if not has_column("users", "account"):
                conn.execute(text("ALTER TABLE users ADD COLUMN account VARCHAR(128)"))
                conn.execute(text("UPDATE users SET account = username WHERE account IS NULL OR account = ''"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account ON users(account)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_account ON users(account)"))
            if not has_column("users", "email"):
                conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))
            if not has_column("users", "mobile"):
                conn.execute(text("ALTER TABLE users ADD COLUMN mobile VARCHAR(64)"))
            if not has_column("users", "must_change_password"):
                conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0"))

        if "memberships" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE memberships (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR(64) NOT NULL,
                        tenant_id VARCHAR(64) NOT NULL,
                        role VARCHAR(32) NOT NULL,
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_user_tenant ON memberships(user_id, tenant_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_memberships_user_id ON memberships(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_memberships_tenant_id ON memberships(tenant_id)"))
            table_names.add("memberships")
        elif not has_column("memberships", "role_key"):
            conn.execute(text("ALTER TABLE memberships ADD COLUMN role_key VARCHAR(64)"))
            conn.execute(text("UPDATE memberships SET role_key = role WHERE role_key IS NULL"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_memberships_role_key ON memberships(role_key)"))

        if "tenant_roles" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE tenant_roles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id VARCHAR(64) NOT NULL,
                        key VARCHAR(64) NOT NULL,
                        name VARCHAR(128) NOT NULL,
                        can_manage_members BOOLEAN NOT NULL DEFAULT 0,
                        can_manage_permissions BOOLEAN NOT NULL DEFAULT 0,
                        default_table_can_read BOOLEAN NOT NULL DEFAULT 1,
                        default_table_can_write BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_role_tenant_key ON tenant_roles(tenant_id, key)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_roles_tenant_id ON tenant_roles(tenant_id)"))
            table_names.add("tenant_roles")

        if "audit_logs" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE audit_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR(64),
                        tenant_id VARCHAR(64),
                        action VARCHAR(64) NOT NULL,
                        result VARCHAR(32) NOT NULL,
                        resource_type VARCHAR(64),
                        resource_id VARCHAR(128),
                        path VARCHAR(255),
                        detail VARCHAR(512),
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_id ON audit_logs(tenant_id)"))
            table_names.add("audit_logs")

        if "table_permissions" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE table_permissions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id VARCHAR(64) NOT NULL,
                        table_id VARCHAR(64) NOT NULL,
                        user_id VARCHAR(64) NOT NULL,
                        can_read BOOLEAN NOT NULL DEFAULT 1,
                        can_write BOOLEAN NOT NULL DEFAULT 0,
                        can_create_record BOOLEAN NOT NULL DEFAULT 1,
                        can_delete_record BOOLEAN NOT NULL DEFAULT 1,
                        can_import_records BOOLEAN NOT NULL DEFAULT 1,
                        can_export_records BOOLEAN NOT NULL DEFAULT 1,
                        can_manage_filters BOOLEAN NOT NULL DEFAULT 1,
                        can_manage_sorts BOOLEAN NOT NULL DEFAULT 1,
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_table_permission_tenant_table_user "
                    "ON table_permissions(tenant_id, table_id, user_id)"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_table_permissions_tenant_id ON table_permissions(tenant_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_table_permissions_table_id ON table_permissions(table_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_table_permissions_user_id ON table_permissions(user_id)"))
            table_names.add("table_permissions")
        else:
            if not has_column("table_permissions", "can_create_record"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_create_record BOOLEAN NOT NULL DEFAULT 1"))
            if not has_column("table_permissions", "can_delete_record"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_delete_record BOOLEAN NOT NULL DEFAULT 1"))
            if not has_column("table_permissions", "can_import_records"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_import_records BOOLEAN NOT NULL DEFAULT 1"))
            if not has_column("table_permissions", "can_export_records"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_export_records BOOLEAN NOT NULL DEFAULT 1"))
            if not has_column("table_permissions", "can_manage_filters"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_manage_filters BOOLEAN NOT NULL DEFAULT 1"))
            if not has_column("table_permissions", "can_manage_sorts"):
                conn.execute(text("ALTER TABLE table_permissions ADD COLUMN can_manage_sorts BOOLEAN NOT NULL DEFAULT 1"))

        if "view_permissions" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE view_permissions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id VARCHAR(64) NOT NULL,
                        view_id VARCHAR(64) NOT NULL,
                        user_id VARCHAR(64) NOT NULL,
                        can_read BOOLEAN NOT NULL DEFAULT 1,
                        can_write BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_view_permission_tenant_view_user "
                    "ON view_permissions(tenant_id, view_id, user_id)"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_view_permissions_tenant_id ON view_permissions(tenant_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_view_permissions_view_id ON view_permissions(view_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_view_permissions_user_id ON view_permissions(user_id)"))
            table_names.add("view_permissions")

        if "dashboards" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE dashboards (
                        id VARCHAR(64) PRIMARY KEY,
                        tenant_id VARCHAR(64) NOT NULL,
                        name VARCHAR(255) NOT NULL DEFAULT '首页大屏',
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboards_tenant_id ON dashboards(tenant_id)"))
            table_names.add("dashboards")

        if "dashboard_widgets" not in table_names:
            conn.execute(
                text(
                    """
                    CREATE TABLE dashboard_widgets (
                        id VARCHAR(64) PRIMARY KEY,
                        dashboard_id VARCHAR(64) NOT NULL,
                        tenant_id VARCHAR(64) NOT NULL,
                        type VARCHAR(32) NOT NULL,
                        title VARCHAR(255) NOT NULL DEFAULT '未命名组件',
                        table_id VARCHAR(64),
                        field_ids_json JSON NOT NULL DEFAULT '[]',
                        aggregation VARCHAR(32) NOT NULL DEFAULT 'count',
                        group_field_id VARCHAR(64),
                        layout_json JSON NOT NULL DEFAULT '{}',
                        config_json JSON NOT NULL DEFAULT '{}',
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME NOT NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboard_widgets_dashboard_id ON dashboard_widgets(dashboard_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboard_widgets_tenant_id ON dashboard_widgets(tenant_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_dashboard_widgets_table_id ON dashboard_widgets(table_id)"))
            table_names.add("dashboard_widgets")

        for table in ("bases", "tables", "views", "fields", "records"):
            if table in table_names and not has_column(table, "tenant_id"):
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN tenant_id VARCHAR(64)"))
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_tenant_id ON {table}(tenant_id)"))
