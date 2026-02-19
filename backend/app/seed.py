from __future__ import annotations

import os
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .db import Base, engine
from .models import (
    BaseModel,
    FieldModel,
    MembershipModel,
    RecordModel,
    RecordValueModel,
    TableModel,
    TablePermissionModel,
    TenantModel,
    TenantRoleModel,
    UserModel,
    ViewPermissionModel,
    ViewModel,
)
from .services import now_utc_naive


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def _ensure_default_roles(db: Session, tenant_id: str) -> None:
    defaults = [
        ("member", "成员", False, False, True, False),
        ("admin", "管理员", True, True, True, True),
        ("project_manager", "项目经理", True, True, True, True),
        ("developer", "开发人员", False, False, True, True),
        ("implementer", "实施人员", False, False, True, True),
    ]
    existing_keys = {
        item.key
        for item in db.scalars(select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant_id)).all()
    }
    changed = False
    for key, name, can_manage_members, can_manage_permissions, can_read, can_write in defaults:
        if key in existing_keys:
            continue
        db.add(
            TenantRoleModel(
                tenant_id=tenant_id,
                key=key,
                name=name,
                can_manage_members=can_manage_members,
                can_manage_permissions=can_manage_permissions,
                default_table_can_read=can_read,
                default_table_can_write=can_write,
                created_at=now_utc_naive(),
            )
        )
        changed = True
    if changed:
        db.commit()


def ensure_seed_data(db: Session) -> None:
    tenant = db.scalar(select(TenantModel).where(TenantModel.id == "tenant_default"))
    if not tenant:
        tenant = TenantModel(id="tenant_default", name="默认租户")
        db.add(tenant)
        db.commit()
        db.refresh(tenant)

    _ensure_default_roles(db, tenant.id)

    owner = db.scalar(select(UserModel).where(UserModel.username == "owner"))
    if not owner:
        seed_owner_password = (os.getenv("SEED_OWNER_PASSWORD") or "").strip()
        generated_password = False
        if not seed_owner_password:
            seed_owner_password = secrets.token_urlsafe(18)
            generated_password = True
            print(
                "[seed] 初始化 owner 账号随机密码（仅首次输出）："
                f" {seed_owner_password}"
            )
        owner = UserModel(
            id="usr_owner",
            username="owner",
            account="owner",
            password_hash=hash_password(seed_owner_password),
            email=None,
            mobile=None,
            must_change_password=generated_password,
            default_tenant_id=tenant.id,
            created_at=now_utc_naive(),
        )
        db.add(owner)
        db.commit()
        db.refresh(owner)
    elif owner.default_tenant_id != tenant.id:
        owner.default_tenant_id = tenant.id
        db.commit()
    if not owner.account:
        owner.account = owner.username
        db.commit()

    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == owner.id,
            MembershipModel.tenant_id == tenant.id,
        )
    )
    if not membership:
        db.add(
            MembershipModel(
                user_id=owner.id,
                tenant_id=tenant.id,
                role="owner",
                role_key="owner",
                created_at=now_utc_naive(),
            )
        )
        db.commit()
    else:
        next_role_key = "owner" if membership.role == "owner" else (membership.role_key or "member")
        if membership.role_key != next_role_key:
            membership.role_key = next_role_key
            db.commit()

    db.query(BaseModel).filter(BaseModel.tenant_id.is_(None)).update({"tenant_id": tenant.id})
    db.query(TableModel).filter(TableModel.tenant_id.is_(None)).update({"tenant_id": tenant.id})
    db.query(ViewModel).filter(ViewModel.tenant_id.is_(None)).update({"tenant_id": tenant.id})
    db.query(FieldModel).filter(FieldModel.tenant_id.is_(None)).update({"tenant_id": tenant.id})
    db.query(RecordModel).filter(RecordModel.tenant_id.is_(None)).update({"tenant_id": tenant.id})
    db.commit()

    table_ids = [item.id for item in db.scalars(select(TableModel).where(TableModel.tenant_id == tenant.id)).all()]
    for table_id in table_ids:
        perm = db.scalar(
            select(TablePermissionModel).where(
                TablePermissionModel.tenant_id == tenant.id,
                TablePermissionModel.table_id == table_id,
                TablePermissionModel.user_id == owner.id,
            )
        )
        if not perm:
            db.add(
                TablePermissionModel(
                    tenant_id=tenant.id,
                    table_id=table_id,
                    user_id=owner.id,
                    can_read=True,
                    can_write=True,
                    created_at=now_utc_naive(),
                )
            )
    db.commit()

    view_ids = [item.id for item in db.scalars(select(ViewModel).where(ViewModel.tenant_id == tenant.id)).all()]
    for view_id in view_ids:
        perm = db.scalar(
            select(ViewPermissionModel).where(
                ViewPermissionModel.tenant_id == tenant.id,
                ViewPermissionModel.view_id == view_id,
                ViewPermissionModel.user_id == owner.id,
            )
        )
        if not perm:
            db.add(
                ViewPermissionModel(
                    tenant_id=tenant.id,
                    view_id=view_id,
                    user_id=owner.id,
                    can_read=True,
                    can_write=True,
                    created_at=now_utc_naive(),
                )
            )
    db.commit()

    existing_base = db.scalar(select(BaseModel).where(BaseModel.id == "base_1"))
    if existing_base:
        return

    base = BaseModel(id="base_1", tenant_id=tenant.id, name="我的多维表格")
    table = TableModel(id="tbl_1", tenant_id=tenant.id, base_id=base.id, name="项目任务")
    view = ViewModel(
        id="viw_1",
        tenant_id=tenant.id,
        table_id=table.id,
        name="表格",
        type="grid",
        config_json={
            "hiddenFieldIds": [],
            "columnWidths": {
                "fld_name": 260,
                "fld_owner": 180,
                "fld_score": 120,
                "fld_due": 170,
                "fld_status": 180,
            },
            "sorts": [],
            "filters": [],
        },
    )

    fields = [
        FieldModel(id="fld_name", tenant_id=tenant.id, table_id=table.id, name="名称", type="text", width=260, sort_order=0),
        FieldModel(id="fld_owner", tenant_id=tenant.id, table_id=table.id, name="负责人", type="text", width=180, sort_order=1),
        FieldModel(id="fld_score", tenant_id=tenant.id, table_id=table.id, name="分数", type="number", width=120, sort_order=2),
        FieldModel(id="fld_due", tenant_id=tenant.id, table_id=table.id, name="截止日期", type="date", width=170, sort_order=3),
        FieldModel(
            id="fld_status",
            tenant_id=tenant.id,
            table_id=table.id,
            name="状态",
            type="singleSelect",
            width=180,
            sort_order=4,
            options_json=[
                {"id": "待处理", "name": "待处理", "color": "#9ca3af"},
                {"id": "进行中", "name": "进行中", "color": "#3b82f6"},
                {"id": "已完成", "name": "已完成", "color": "#10b981"},
            ],
        ),
    ]

    db.add(base)
    db.add(table)
    db.add(view)
    db.add_all(fields)

    owners = ["张明", "王芳", "李浩", "陈雪", "周杰", "林娜", "赵宇"]
    statuses = ["待处理", "进行中", "已完成"]

    records: list[RecordModel] = []
    values: list[RecordValueModel] = []

    for i in range(2000):
        idx = i + 1
        record_id = f"rec_{idx}"
        record = RecordModel(
            id=record_id,
            tenant_id=tenant.id,
            table_id=table.id,
            created_at=now_utc_naive(),
            updated_at=now_utc_naive(),
        )
        records.append(record)
        values.extend(
            [
                RecordValueModel(record_id=record_id, field_id="fld_name", value_json=f"任务 {idx}"),
                RecordValueModel(record_id=record_id, field_id="fld_owner", value_json=owners[i % len(owners)]),
                RecordValueModel(record_id=record_id, field_id="fld_score", value_json=((i * 7) % 100) + 1),
                RecordValueModel(
                    record_id=record_id,
                    field_id="fld_due",
                    value_json=f"2026-03-{str((i % 28) + 1).zfill(2)}",
                ),
                RecordValueModel(record_id=record_id, field_id="fld_status", value_json=statuses[i % len(statuses)]),
            ]
        )

    db.add_all(records)
    db.add_all(values)
    db.add(
        TablePermissionModel(
            tenant_id=tenant.id,
            table_id=table.id,
            user_id=owner.id,
            can_read=True,
            can_write=True,
            created_at=now_utc_naive(),
        )
    )
    db.add(
        ViewPermissionModel(
            tenant_id=tenant.id,
            view_id=view.id,
            user_id=owner.id,
            can_read=True,
            can_write=True,
            created_at=now_utc_naive(),
        )
    )
    db.commit()
