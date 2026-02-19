from __future__ import annotations

import json
import os
import secrets
from typing import Any
from uuid import uuid4

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from .auth import (
    ACCESS_TOKEN_MINUTES,
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_tenant,
    get_current_user,
    hash_password,
    require_owner_role,
    set_refresh_cookie,
    verify_password,
    write_audit_log,
)
from .db import ensure_schema_upgrades, get_db
from .models import (
    DashboardModel,
    DashboardWidgetModel,
    FieldModel,
    MembershipModel,
    RecordModel,
    TablePermissionModel,
    TableModel,
    TenantModel,
    TenantRoleModel,
    UserModel,
    ViewPermissionModel,
    ViewModel,
)
from .schemas import (
    AuthTokenOut,
    CreateMemberIn,
    CreateRecordIn,
    DashboardOut,
    DashboardWidgetCreateIn,
    DashboardWidgetOut,
    DashboardWidgetPatchIn,
    ErrorOut,
    FirstLoginChangePasswordIn,
    FieldCreateIn,
    FieldOut,
    HealthOut,
    ImportViewBundleLegacyIn,
    LoginIn,
    MeOut,
    RecordOut,
    RecordPageOut,
    RecordQueryIn,
    ReferenceMemberOut,
    RemoveMemberIn,
    ImportViewBundleIn,
    ImportViewBundleOut,
    SwitchTenantIn,
    TenantCreateIn,
    TenantMemberOut,
    TenantRoleCreateIn,
    TenantRoleOut,
    TenantRolePatchIn,
    TenantOut,
    TableButtonPermissionItemOut,
    TableButtonPermissionPatchIn,
    TableButtonPermissionSet,
    TablePermissionItemOut,
    TablePermissionPatchIn,
    UpdateMemberRoleIn,
    UserProfileOut,
    ViewPermissionItemOut,
    ViewPermissionPatchIn,
    ViewCreateIn,
    ViewOut,
    ViewPatchIn,
    WidgetDataRequest,
)
from .seed import ensure_seed_data, init_db
from .services import (
    aggregate_widget_data,
    apply_filters_and_sorts,
    now_utc_naive,
    serialize_record,
    to_field_out,
    to_view_out,
    upsert_record_values,
)


DEFAULT_VIEW_CONFIG = {
    "hiddenFieldIds": [],
    "fieldOrderIds": [],
    "columnWidths": {},
    "sorts": [],
    "filters": [],
    "isEnabled": True,
    "order": 0,
    "filterLogic": "and",
    "filterPresets": [],
    "components": {},
}

DEFAULT_BUTTON_PERMISSIONS = {
    "can_create_record": True,
    "can_delete_record": True,
    "can_import_records": True,
    "can_export_records": True,
    "can_manage_filters": True,
    "can_manage_sorts": True,
}

app = FastAPI(
    title="Multidimensional Table API",
    version="0.2.0",
    responses={400: {"model": ErrorOut}, 401: {"model": ErrorOut}, 403: {"model": ErrorOut}, 404: {"model": ErrorOut}},
)

allowed_origins = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.211:5173",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in allowed_origins.split(",") if item.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()
    ensure_schema_upgrades()
    for db in get_db():
        ensure_seed_data(db)


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(status="ok")


@app.post("/auth/login", response_model=AuthTokenOut)
def login(payload: LoginIn, response: Response, request: Request, db: Session = Depends(get_db)) -> AuthTokenOut:
    username = payload.username.strip()
    password = payload.password
    user = db.scalar(select(UserModel).where(or_(UserModel.username == username, UserModel.account == username)))
    if not user or not verify_password(password, user.password_hash):
        write_audit_log(
            db,
            action="login",
            result="failed",
            request=request,
            user_id=user.id if user else None,
            detail="invalid_credentials",
        )
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if user.must_change_password:
        write_audit_log(
            db,
            action="login",
            result="forbidden",
            request=request,
            user_id=user.id,
            detail="first_password_change_required",
        )
        raise HTTPException(status_code=403, detail="首次登录请先修改密码")

    memberships = db.scalars(select(MembershipModel).where(MembershipModel.user_id == user.id)).all()
    if not memberships:
        raise HTTPException(status_code=403, detail="用户未加入任何租户")
    tenant_ids = {item.tenant_id for item in memberships}
    tenant_id = user.default_tenant_id if user.default_tenant_id in tenant_ids else memberships[0].tenant_id
    tenant = db.scalar(select(TenantModel).where(TenantModel.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=403, detail="默认租户不存在")

    access_token = create_access_token(user.id, tenant.id)
    refresh_token = create_refresh_token(user.id)
    set_refresh_cookie(response, refresh_token)
    write_audit_log(db, action="login", result="success", request=request, user_id=user.id, tenant_id=tenant.id)
    return AuthTokenOut(
        accessToken=access_token,
        tokenType="bearer",
        expiresIn=ACCESS_TOKEN_MINUTES * 60,
        currentTenant=TenantOut(id=tenant.id, name=tenant.name),
    )


@app.post("/auth/first-login/change-password")
def first_login_change_password(payload: FirstLoginChangePasswordIn, db: Session = Depends(get_db)) -> dict[str, str]:
    account = payload.account.strip()
    new_password = payload.newPassword
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少 8 位")
    user = db.scalar(select(UserModel).where(or_(UserModel.account == account, UserModel.username == account)))
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="原密码错误")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    db.commit()
    return {"detail": "密码修改成功"}


@app.post("/auth/logout")
def logout(response: Response) -> dict[str, str]:
    clear_refresh_cookie(response)
    return {"detail": "已退出登录"}


@app.post("/auth/refresh", response_model=AuthTokenOut)
def refresh_token(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> AuthTokenOut:
    if not refresh_token:
        raise HTTPException(status_code=401, detail="刷新凭证缺失")
    payload = decode_token(refresh_token, "refresh")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="刷新凭证无效")
    user = db.scalar(select(UserModel).where(UserModel.id == user_id))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.user_id == user.id)).all()
    if not memberships:
        raise HTTPException(status_code=403, detail="用户未加入任何租户")
    tenant_ids = {item.tenant_id for item in memberships}
    tenant_id = user.default_tenant_id if user.default_tenant_id in tenant_ids else memberships[0].tenant_id
    tenant = db.scalar(select(TenantModel).where(TenantModel.id == tenant_id))
    if not tenant:
        raise HTTPException(status_code=403, detail="租户不存在")
    access_token = create_access_token(user.id, tenant.id)
    new_refresh_token = create_refresh_token(user.id)
    set_refresh_cookie(response, new_refresh_token)
    return AuthTokenOut(
        accessToken=access_token,
        tokenType="bearer",
        expiresIn=ACCESS_TOKEN_MINUTES * 60,
        currentTenant=TenantOut(id=tenant.id, name=tenant.name),
    )


@app.get("/auth/me", response_model=MeOut)
def me(
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> MeOut:
    memberships = db.scalars(
        select(MembershipModel).where(MembershipModel.user_id == user.id).order_by(MembershipModel.tenant_id.asc())
    ).all()
    tenant_map = {
        item.id: item
        for item in db.scalars(select(TenantModel).where(TenantModel.id.in_([m.tenant_id for m in memberships]))).all()
    }
    current_membership = next((item for item in memberships if item.tenant_id == tenant.id), None)
    role = current_membership.role if current_membership else "member"
    role_key = current_membership.role_key if current_membership and current_membership.role != "owner" else role
    return MeOut(
        user=UserProfileOut(
            id=user.id,
            username=user.username,
            account=user.account,
            email=user.email,
            mobile=user.mobile,
            defaultTenantId=user.default_tenant_id,
        ),
        currentTenant=TenantOut(id=tenant.id, name=tenant.name),
        role=role,
        roleKey=role_key,
        tenants=[TenantOut(id=item.id, name=item.name) for item in tenant_map.values()],
    )


@app.get("/tenants", response_model=list[TenantOut])
def get_tenants(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TenantOut]:
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.user_id == user.id)).all()
    tenant_ids = [item.tenant_id for item in memberships]
    if not tenant_ids:
        return []
    tenants = db.scalars(select(TenantModel).where(TenantModel.id.in_(tenant_ids))).all()
    return [TenantOut(id=item.id, name=item.name) for item in tenants]


@app.post("/tenants", response_model=TenantOut)
def create_tenant(
    payload: TenantCreateIn,
    request: Request,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="租户名称不能为空")
    tenant = TenantModel(id=_next_id("tenant"), name=name)
    db.add(tenant)
    db.flush()
    _ensure_builtin_roles(db, tenant.id)
    db.add(
        MembershipModel(
            user_id=user.id,
            tenant_id=tenant.id,
            role="owner",
            role_key="owner",
            created_at=now_utc_naive(),
        )
    )
    if not user.default_tenant_id:
        user.default_tenant_id = tenant.id
    db.commit()
    write_audit_log(
        db,
        action="create_tenant",
        result="success",
        request=request,
        user_id=user.id,
        tenant_id=tenant.id,
        resource_type="tenant",
        resource_id=tenant.id,
    )
    return TenantOut(id=tenant.id, name=tenant.name)


@app.post("/tenants/switch", response_model=AuthTokenOut)
def switch_tenant(
    payload: SwitchTenantIn,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthTokenOut:
    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == user.id,
            MembershipModel.tenant_id == payload.tenantId,
        )
    )
    if not membership:
        raise HTTPException(status_code=403, detail="无目标租户访问权限")
    tenant = db.scalar(select(TenantModel).where(TenantModel.id == payload.tenantId))
    if not tenant:
        raise HTTPException(status_code=404, detail="租户不存在")
    user.default_tenant_id = tenant.id
    db.commit()
    access_token = create_access_token(user.id, tenant.id)
    return AuthTokenOut(
        accessToken=access_token,
        tokenType="bearer",
        expiresIn=ACCESS_TOKEN_MINUTES * 60,
        currentTenant=TenantOut(id=tenant.id, name=tenant.name),
    )


@app.get("/tenants/current/members", response_model=list[TenantMemberOut])
def list_current_tenant_members(
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TenantMemberOut]:
    _ensure_manage_members_allowed(db, user.id, tenant.id)
    _ensure_builtin_roles(db, tenant.id)
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    users = {
        item.id: item
        for item in db.scalars(select(UserModel).where(UserModel.id.in_([m.user_id for m in memberships]))).all()
    }
    role_map = {
        item.key: item
        for item in db.scalars(select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id)).all()
    }
    result: list[TenantMemberOut] = []
    for item in memberships:
        user = users.get(item.user_id)
        if not user:
            continue
        role_key = (item.role_key or "member") if item.role != "owner" else "owner"
        role_name = "Owner" if item.role == "owner" else (role_map.get(role_key).name if role_map.get(role_key) else role_key)
        result.append(
            TenantMemberOut(
                userId=user.id,
                username=user.username,
                role=item.role,
                roleKey=role_key,
                roleName=role_name,
            )
        )
    return result


@app.post("/tenants/current/members", response_model=TenantMemberOut)
def create_member(
    payload: CreateMemberIn,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantMemberOut:
    _ensure_manage_members_allowed(db, operator.id, tenant.id)
    _ensure_builtin_roles(db, tenant.id)
    username = payload.username.strip()
    account = (payload.account or payload.username).strip()
    password = (payload.password or "").strip() or None
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if not account:
        raise HTTPException(status_code=400, detail="账号不能为空")
    if password and len(password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    role_key = (payload.roleKey or "member").strip() or "member"
    role = db.scalar(
        select(TenantRoleModel).where(
            TenantRoleModel.tenant_id == tenant.id,
            TenantRoleModel.key == role_key,
        )
    )
    if not role:
        raise HTTPException(status_code=400, detail=f"职级不存在: {role_key}")

    existing_by_account = db.scalar(select(UserModel).where(UserModel.account == account))
    existing_by_username = db.scalar(select(UserModel).where(UserModel.username == username))
    if existing_by_account and existing_by_username and existing_by_account.id != existing_by_username.id:
        raise HTTPException(status_code=400, detail="账号或用户名已存在")
    user = existing_by_account or existing_by_username
    temporary_password: str | None = None
    if not user:
        initial_password = password
        must_change_password = False
        if not initial_password:
            initial_password = _generate_temporary_password()
            must_change_password = True
            temporary_password = initial_password
        user = UserModel(
            id=_next_id("usr"),
            username=username,
            account=account,
            password_hash=hash_password(initial_password),
            email=(payload.email or "").strip() or None,
            mobile=(payload.mobile or "").strip() or None,
            must_change_password=must_change_password,
            default_tenant_id=tenant.id,
            created_at=now_utc_naive(),
        )
        db.add(user)
        db.flush()
    else:
        if user.account != account and existing_by_account and existing_by_account.id != user.id:
            raise HTTPException(status_code=400, detail="账号已存在")
        if user.username != username and existing_by_username and existing_by_username.id != user.id:
            raise HTTPException(status_code=400, detail="用户名已存在")
        if payload.email is not None:
            user.email = (payload.email or "").strip() or None
        if payload.mobile is not None:
            user.mobile = (payload.mobile or "").strip() or None
    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == user.id,
            MembershipModel.tenant_id == tenant.id,
        )
    )
    if membership:
        raise HTTPException(status_code=400, detail="该用户已在当前租户内")
    db.add(
        MembershipModel(
            user_id=user.id,
            tenant_id=tenant.id,
            role="member",
            role_key=role.key,
            created_at=now_utc_naive(),
        )
    )
    if not user.default_tenant_id:
        user.default_tenant_id = tenant.id
    _grant_permissions_by_role_defaults(db, tenant.id, user.id, role)
    db.commit()
    write_audit_log(
        db,
        action="create_member",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="user",
        resource_id=user.id,
    )
    return TenantMemberOut(
        userId=user.id,
        username=user.username,
        role="member",
        roleKey=role.key,
        roleName=role.name,
        temporaryPassword=temporary_password,
    )


@app.patch("/tenants/current/members/{member_user_id}/role", response_model=TenantMemberOut)
def update_member_role(
    member_user_id: str,
    payload: UpdateMemberRoleIn,
    request: Request,
    current: tuple[UserModel, TenantModel] = Depends(require_owner_role),
    db: Session = Depends(get_db),
) -> TenantMemberOut:
    operator, tenant = current
    _ensure_builtin_roles(db, tenant.id)
    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == member_user_id,
            MembershipModel.tenant_id == tenant.id,
        )
    )
    if not membership:
        raise HTTPException(status_code=404, detail="成员不存在")
    if membership.role == "owner":
        raise HTTPException(status_code=400, detail="Owner 不支持切换职级")
    role = db.scalar(
        select(TenantRoleModel).where(
            TenantRoleModel.tenant_id == tenant.id,
            TenantRoleModel.key == payload.roleKey,
        )
    )
    if not role:
        raise HTTPException(status_code=400, detail=f"职级不存在: {payload.roleKey}")
    membership.role_key = role.key
    _grant_permissions_by_role_defaults(db, tenant.id, member_user_id, role)
    db.commit()
    user = db.scalar(select(UserModel).where(UserModel.id == member_user_id))
    username = user.username if user else member_user_id
    write_audit_log(
        db,
        action="update_member_role",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="user",
        resource_id=member_user_id,
        detail=f"role_key={role.key}",
    )
    return TenantMemberOut(
        userId=member_user_id,
        username=username,
        role="member",
        roleKey=role.key,
        roleName=role.name,
    )


@app.delete("/tenants/current/members/{member_user_id}")
def remove_member(
    member_user_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    _ensure_manage_members_allowed(db, operator.id, tenant.id)
    if operator.id == member_user_id:
        raise HTTPException(status_code=400, detail="不能移除自己")
    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == member_user_id,
            MembershipModel.tenant_id == tenant.id,
        )
    )
    if not membership:
        raise HTTPException(status_code=404, detail="成员不存在")
    if membership.role == "owner":
        operator_membership = _get_membership(db, operator.id, tenant.id)
        if not operator_membership or operator_membership.role != "owner":
            raise HTTPException(status_code=403, detail="仅 Owner 可移除 Owner")
        owner_count = db.scalar(
            select(func.count())
            .select_from(MembershipModel)
            .where(MembershipModel.tenant_id == tenant.id, MembershipModel.role == "owner")
        ) or 0
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="不能移除最后一个 Owner")
    db.delete(membership)
    db.commit()
    write_audit_log(
        db,
        action="remove_member",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="user",
        resource_id=member_user_id,
    )
    return {"detail": "已移除成员"}


@app.post("/tenants/current/members/remove")
def remove_member_compat(
    payload: RemoveMemberIn,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    return remove_member(payload.userId, request, operator, tenant, db)


@app.get("/tenants/current/roles", response_model=list[TenantRoleOut])
def list_tenant_roles(
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TenantRoleOut]:
    _ensure_manage_members_allowed(db, user.id, tenant.id)
    _ensure_builtin_roles(db, tenant.id)
    roles = db.scalars(
        select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id).order_by(TenantRoleModel.key.asc())
    ).all()
    return [_to_tenant_role_out(item) for item in roles]


@app.post("/tenants/current/roles", response_model=TenantRoleOut)
def create_tenant_role(
    payload: TenantRoleCreateIn,
    request: Request,
    current: tuple[UserModel, TenantModel] = Depends(require_owner_role),
    db: Session = Depends(get_db),
) -> TenantRoleOut:
    operator, tenant = current
    key = payload.key.strip().lower()
    name = payload.name.strip()
    if not key or not name:
        raise HTTPException(status_code=400, detail="职级 key / 名称不能为空")
    if key == "owner":
        raise HTTPException(status_code=400, detail="owner 为保留职级 key")
    exists = db.scalar(
        select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id, TenantRoleModel.key == key)
    )
    if exists:
        raise HTTPException(status_code=400, detail="职级 key 已存在")
    role = TenantRoleModel(
        tenant_id=tenant.id,
        key=key,
        name=name,
        can_manage_members=payload.canManageMembers,
        can_manage_permissions=payload.canManagePermissions,
        default_table_can_read=payload.defaultTableCanRead,
        default_table_can_write=payload.defaultTableCanWrite,
        created_at=now_utc_naive(),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    write_audit_log(
        db,
        action="create_tenant_role",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="role",
        resource_id=role.key,
    )
    return _to_tenant_role_out(role)


@app.patch("/tenants/current/roles/{role_key}", response_model=TenantRoleOut)
def patch_tenant_role(
    role_key: str,
    payload: TenantRolePatchIn,
    request: Request,
    current: tuple[UserModel, TenantModel] = Depends(require_owner_role),
    db: Session = Depends(get_db),
) -> TenantRoleOut:
    operator, tenant = current
    if role_key in {"owner", "member"}:
        raise HTTPException(status_code=400, detail="内置职级不支持修改 key")
    role = db.scalar(
        select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id, TenantRoleModel.key == role_key)
    )
    if not role:
        raise HTTPException(status_code=404, detail="职级不存在")
    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="职级名称不能为空")
        role.name = next_name
    if payload.canManageMembers is not None:
        role.can_manage_members = payload.canManageMembers
    if payload.canManagePermissions is not None:
        role.can_manage_permissions = payload.canManagePermissions
    if payload.defaultTableCanRead is not None:
        role.default_table_can_read = payload.defaultTableCanRead or bool(role.default_table_can_write)
    if payload.defaultTableCanWrite is not None:
        role.default_table_can_write = payload.defaultTableCanWrite
        if role.default_table_can_write:
            role.default_table_can_read = True
    db.commit()
    db.refresh(role)
    write_audit_log(
        db,
        action="update_tenant_role",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="role",
        resource_id=role.key,
    )
    return _to_tenant_role_out(role)


@app.delete("/tenants/current/roles/{role_key}")
def delete_tenant_role(
    role_key: str,
    request: Request,
    current: tuple[UserModel, TenantModel] = Depends(require_owner_role),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    operator, tenant = current
    if role_key in {"owner", "member"}:
        raise HTTPException(status_code=400, detail="内置职级不能删除")
    role = db.scalar(
        select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id, TenantRoleModel.key == role_key)
    )
    if not role:
        raise HTTPException(status_code=404, detail="职级不存在")
    in_use = db.scalar(
        select(func.count())
        .select_from(MembershipModel)
        .where(
            MembershipModel.tenant_id == tenant.id,
            MembershipModel.role_key == role_key,
        )
    ) or 0
    if int(in_use) > 0:
        raise HTTPException(status_code=400, detail="职级仍被成员使用，不能删除")
    db.delete(role)
    db.commit()
    write_audit_log(
        db,
        action="delete_tenant_role",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="role",
        resource_id=role_key,
    )
    return {"detail": "已删除职级"}


@app.get("/tables/{table_id}/permissions", response_model=list[TablePermissionItemOut])
def get_table_permissions(
    table_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TablePermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_table_exists(db, table_id, tenant.id, request, operator.id)
    items = db.scalars(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant.id,
            TablePermissionModel.table_id == table_id,
        )
    ).all()
    users = {
        item.id: item
        for item in db.scalars(select(UserModel).where(UserModel.id.in_([p.user_id for p in items]))).all()
    }
    return [
        TablePermissionItemOut(
            userId=item.user_id,
            username=users[item.user_id].username if item.user_id in users else item.user_id,
            canRead=item.can_read,
            canWrite=item.can_write,
        )
        for item in items
    ]


@app.put("/tables/{table_id}/permissions", response_model=list[TablePermissionItemOut])
def update_table_permissions(
    table_id: str,
    payload: TablePermissionPatchIn,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TablePermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_table_exists(db, table_id, tenant.id, request, operator.id)
    membership_map = {
        item.user_id: item.role
        for item in db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    }
    target_user_ids = {item.userId for item in payload.items}
    unknown_users = [user_id for user_id in target_user_ids if user_id not in membership_map]
    if unknown_users:
        raise HTTPException(status_code=400, detail=f"存在不属于当前租户的成员: {', '.join(unknown_users)}")

    existing = db.scalars(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant.id,
            TablePermissionModel.table_id == table_id,
        )
    ).all()
    existing_map = {(item.user_id): item for item in existing}

    keep_ids: set[str] = set()
    for item in payload.items:
        # Owner 至少保留读权限，避免权限误删导致“无可引用负责人”
        if membership_map.get(item.userId) == "owner":
            can_read = True
            can_write = True if item.canWrite else False
        else:
            can_read = item.canRead or item.canWrite
            can_write = item.canWrite
        keep_ids.add(item.userId)
        if item.userId in existing_map:
            existing_map[item.userId].can_read = can_read
            existing_map[item.userId].can_write = can_write
        else:
            db.add(
                TablePermissionModel(
                    tenant_id=tenant.id,
                    table_id=table_id,
                    user_id=item.userId,
                    can_read=can_read,
                    can_write=can_write,
                    created_at=now_utc_naive(),
                )
            )

    for user_id, row in existing_map.items():
        if user_id in keep_ids:
            continue
        if membership_map.get(user_id) == "owner":
            row.can_read = True
            row.can_write = True
            continue
        db.delete(row)

    db.commit()
    write_audit_log(
        db,
        action="update_table_permissions",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="table",
        resource_id=table_id,
    )
    return get_table_permissions(table_id, request, operator, tenant, db)


@app.post("/tables/{table_id}/permissions/apply-role-defaults", response_model=list[TablePermissionItemOut])
def apply_table_permissions_by_role_defaults(
    table_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TablePermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_table_exists(db, table_id, tenant.id, request, operator.id)
    _ensure_builtin_roles(db, tenant.id)
    role_map = {
        item.key: item
        for item in db.scalars(select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id)).all()
    }
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    existing = {
        item.user_id: item
        for item in db.scalars(
            select(TablePermissionModel).where(
                TablePermissionModel.tenant_id == tenant.id,
                TablePermissionModel.table_id == table_id,
            )
        ).all()
    }
    for membership in memberships:
        if membership.role == "owner":
            can_read = True
            can_write = True
        else:
            role = role_map.get(membership.role_key or "member")
            can_read = role.default_table_can_read if role else True
            can_write = role.default_table_can_write if role else False
            if can_write:
                can_read = True
        current = existing.get(membership.user_id)
        if current:
            current.can_read = can_read
            current.can_write = can_write
        else:
            db.add(
                TablePermissionModel(
                    tenant_id=tenant.id,
                    table_id=table_id,
                    user_id=membership.user_id,
                    can_read=can_read,
                    can_write=can_write,
                    created_at=now_utc_naive(),
                )
            )
    db.commit()
    write_audit_log(
        db,
        action="apply_table_permissions_role_defaults",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="table",
        resource_id=table_id,
    )
    return get_table_permissions(table_id, request, operator, tenant, db)


def _to_table_button_permission_set(permission: TablePermissionModel | None) -> TableButtonPermissionSet:
    if not permission:
        return TableButtonPermissionSet(
            canCreateRecord=True,
            canDeleteRecord=True,
            canImportRecords=True,
            canExportRecords=True,
            canManageFilters=True,
            canManageSorts=True,
        )
    return TableButtonPermissionSet(
        canCreateRecord=permission.can_create_record,
        canDeleteRecord=permission.can_delete_record,
        canImportRecords=permission.can_import_records,
        canExportRecords=permission.can_export_records,
        canManageFilters=permission.can_manage_filters,
        canManageSorts=permission.can_manage_sorts,
    )


@app.get("/tables/{table_id}/button-permissions", response_model=list[TableButtonPermissionItemOut])
def get_table_button_permissions(
    table_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TableButtonPermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_table_exists(db, table_id, tenant.id, request, operator.id)
    membership_map = {
        item.user_id: item.role
        for item in db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    }
    items = db.scalars(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant.id,
            TablePermissionModel.table_id == table_id,
        )
    ).all()
    users = {
        item.id: item
        for item in db.scalars(select(UserModel).where(UserModel.id.in_([p.user_id for p in items]))).all()
    }
    return [
        TableButtonPermissionItemOut(
            userId=item.user_id,
            username=users[item.user_id].username if item.user_id in users else item.user_id,
            buttons=(
                TableButtonPermissionSet(
                    canCreateRecord=True,
                    canDeleteRecord=True,
                    canImportRecords=True,
                    canExportRecords=True,
                    canManageFilters=True,
                    canManageSorts=True,
                )
                if membership_map.get(item.user_id) == "owner"
                else _to_table_button_permission_set(item)
            ),
        )
        for item in items
    ]


@app.put("/tables/{table_id}/button-permissions", response_model=list[TableButtonPermissionItemOut])
def update_table_button_permissions(
    table_id: str,
    payload: TableButtonPermissionPatchIn,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[TableButtonPermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_table_exists(db, table_id, tenant.id, request, operator.id)
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    membership_map = {item.user_id: item.role for item in memberships}
    target_user_ids = {item.userId for item in payload.items}
    unknown_users = [user_id for user_id in target_user_ids if user_id not in membership_map]
    if unknown_users:
        raise HTTPException(status_code=400, detail=f"存在不属于当前租户的成员: {', '.join(unknown_users)}")

    existing = db.scalars(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant.id,
            TablePermissionModel.table_id == table_id,
        )
    ).all()
    existing_map = {item.user_id: item for item in existing}
    missing_base_permission = [
        user_id
        for user_id in target_user_ids
        if user_id not in existing_map and membership_map.get(user_id) != "owner"
    ]
    if missing_base_permission:
        raise HTTPException(status_code=400, detail=f"成员缺少该表基础权限: {', '.join(missing_base_permission)}")

    for item in payload.items:
        row = existing_map.get(item.userId)
        if not row:
            row = TablePermissionModel(
                tenant_id=tenant.id,
                table_id=table_id,
                user_id=item.userId,
                can_read=True,
                can_write=True,
                created_at=now_utc_naive(),
            )
            db.add(row)
            existing_map[item.userId] = row
        if membership_map.get(item.userId) == "owner":
            row.can_create_record = True
            row.can_delete_record = True
            row.can_import_records = True
            row.can_export_records = True
            row.can_manage_filters = True
            row.can_manage_sorts = True
            continue
        row.can_create_record = item.buttons.canCreateRecord
        row.can_delete_record = item.buttons.canDeleteRecord
        row.can_import_records = item.buttons.canImportRecords
        row.can_export_records = item.buttons.canExportRecords
        row.can_manage_filters = item.buttons.canManageFilters
        row.can_manage_sorts = item.buttons.canManageSorts

    db.commit()
    write_audit_log(
        db,
        action="update_table_button_permissions",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="table",
        resource_id=table_id,
    )
    return get_table_button_permissions(table_id, request, operator, tenant, db)


@app.get("/tables/{table_id}/button-permissions/me", response_model=TableButtonPermissionSet)
def get_my_table_button_permissions(
    table_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> TableButtonPermissionSet:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="read",
    )
    if _get_membership_role(db, user.id, tenant.id) == "owner":
        return TableButtonPermissionSet(
            canCreateRecord=True,
            canDeleteRecord=True,
            canImportRecords=True,
            canExportRecords=True,
            canManageFilters=True,
            canManageSorts=True,
        )
    permission = db.scalar(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant.id,
            TablePermissionModel.table_id == table_id,
            TablePermissionModel.user_id == user.id,
        )
    )
    return _to_table_button_permission_set(permission)


@app.get("/views/{view_id}/permissions", response_model=list[ViewPermissionItemOut])
def get_view_permissions(
    view_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[ViewPermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_view_exists(db, view_id, tenant.id, request, operator.id)
    items = db.scalars(
        select(ViewPermissionModel).where(
            ViewPermissionModel.tenant_id == tenant.id,
            ViewPermissionModel.view_id == view_id,
        )
    ).all()
    users = {
        item.id: item
        for item in db.scalars(select(UserModel).where(UserModel.id.in_([p.user_id for p in items]))).all()
    }
    return [
        ViewPermissionItemOut(
            userId=item.user_id,
            username=users[item.user_id].username if item.user_id in users else item.user_id,
            canRead=item.can_read,
            canWrite=item.can_write,
        )
        for item in items
    ]


@app.put("/views/{view_id}/permissions", response_model=list[ViewPermissionItemOut])
def update_view_permissions(
    view_id: str,
    payload: ViewPermissionPatchIn,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[ViewPermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_view_exists(db, view_id, tenant.id, request, operator.id)
    membership_map = {
        item.user_id: item.role
        for item in db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    }
    target_user_ids = {item.userId for item in payload.items}
    unknown_users = [user_id for user_id in target_user_ids if user_id not in membership_map]
    if unknown_users:
        raise HTTPException(status_code=400, detail=f"存在不属于当前租户的成员: {', '.join(unknown_users)}")

    existing = db.scalars(
        select(ViewPermissionModel).where(
            ViewPermissionModel.tenant_id == tenant.id,
            ViewPermissionModel.view_id == view_id,
        )
    ).all()
    existing_map = {(item.user_id): item for item in existing}

    keep_ids: set[str] = set()
    for item in payload.items:
        if membership_map.get(item.userId) == "owner":
            can_read = True
            can_write = True if item.canWrite else False
        else:
            can_read = item.canRead or item.canWrite
            can_write = item.canWrite
        keep_ids.add(item.userId)
        if item.userId in existing_map:
            existing_map[item.userId].can_read = can_read
            existing_map[item.userId].can_write = can_write
        else:
            db.add(
                ViewPermissionModel(
                    tenant_id=tenant.id,
                    view_id=view_id,
                    user_id=item.userId,
                    can_read=can_read,
                    can_write=can_write,
                    created_at=now_utc_naive(),
                )
            )

    for user_id, row in existing_map.items():
        if user_id in keep_ids:
            continue
        if membership_map.get(user_id) == "owner":
            row.can_read = True
            row.can_write = True
            continue
        db.delete(row)

    db.commit()
    write_audit_log(
        db,
        action="update_view_permissions",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="view",
        resource_id=view_id,
    )
    return get_view_permissions(view_id, request, operator, tenant, db)


@app.post("/views/{view_id}/permissions/apply-role-defaults", response_model=list[ViewPermissionItemOut])
def apply_view_permissions_by_role_defaults(
    view_id: str,
    request: Request,
    operator: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[ViewPermissionItemOut]:
    _ensure_manage_table_permissions_allowed(db, operator.id, tenant.id)
    _ensure_view_exists(db, view_id, tenant.id, request, operator.id)
    _ensure_builtin_roles(db, tenant.id)
    role_map = {
        item.key: item
        for item in db.scalars(select(TenantRoleModel).where(TenantRoleModel.tenant_id == tenant.id)).all()
    }
    memberships = db.scalars(select(MembershipModel).where(MembershipModel.tenant_id == tenant.id)).all()
    existing = {
        item.user_id: item
        for item in db.scalars(
            select(ViewPermissionModel).where(
                ViewPermissionModel.tenant_id == tenant.id,
                ViewPermissionModel.view_id == view_id,
            )
        ).all()
    }
    for membership in memberships:
        if membership.role == "owner":
            can_read = True
            can_write = True
        else:
            role = role_map.get(membership.role_key or "member")
            can_read = role.default_table_can_read if role else True
            can_write = role.default_table_can_write if role else False
            if can_write:
                can_read = True
        current = existing.get(membership.user_id)
        if current:
            current.can_read = can_read
            current.can_write = can_write
        else:
            db.add(
                ViewPermissionModel(
                    tenant_id=tenant.id,
                    view_id=view_id,
                    user_id=membership.user_id,
                    can_read=can_read,
                    can_write=can_write,
                    created_at=now_utc_naive(),
                )
            )
    db.commit()
    write_audit_log(
        db,
        action="apply_view_permissions_role_defaults",
        result="success",
        request=request,
        user_id=operator.id,
        tenant_id=tenant.id,
        resource_type="view",
        resource_id=view_id,
    )
    return get_view_permissions(view_id, request, operator, tenant, db)


@app.get("/tables/{table_id}/reference-members", response_model=list[ReferenceMemberOut])
def get_table_reference_members(
    table_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> list[ReferenceMemberOut]:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="read",
    )
    user_ids = sorted(_get_table_reference_member_ids(db, tenant.id, table_id))
    if not user_ids:
        return []
    users = db.scalars(select(UserModel).where(UserModel.id.in_(user_ids))).all()
    return [ReferenceMemberOut(userId=item.id, username=item.username) for item in users]


@app.get("/tables/{table_id}/fields", response_model=list[FieldOut])
def get_fields(
    table_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> list[FieldOut]:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="read",
    )
    fields = db.scalars(
        select(FieldModel)
        .where(FieldModel.table_id == table_id, FieldModel.tenant_id == tenant.id)
        .order_by(FieldModel.sort_order.asc())
    ).all()
    return [to_field_out(field) for field in fields]


@app.post("/tables/{table_id}/fields", response_model=FieldOut)
def create_field(
    table_id: str,
    payload: FieldCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> FieldOut:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    if payload.type in {"singleSelect", "multiSelect"} and not payload.options:
        raise HTTPException(status_code=400, detail="单选/多选字段必须提供预设选项")
    field_count = db.scalar(
        select(func.count()).select_from(FieldModel).where(FieldModel.table_id == table_id, FieldModel.tenant_id == tenant.id)
    ) or 0
    created = FieldModel(
        id=_next_id("fld_dynamic"),
        tenant_id=tenant.id,
        table_id=table_id,
        name=payload.name,
        type=payload.type,
        width=payload.width,
        options_json=[item.model_dump() for item in payload.options] if payload.options else None,
        sort_order=int(field_count),
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return to_field_out(created)


@app.get("/tables/{table_id}/views", response_model=list[ViewOut])
def get_views(
    table_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> list[ViewOut]:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="read",
    )
    views = db.scalars(
        select(ViewModel).where(ViewModel.table_id == table_id, ViewModel.tenant_id == tenant.id)
    ).all()
    views = _filter_views_for_user(db, tenant.id, user.id, views)
    views = sorted(views, key=lambda item: (int((item.config_json or {}).get("order", 0)), item.id))
    return [to_view_out(view) for view in views]


@app.post("/tables/{table_id}/views", response_model=ViewOut)
def create_view(
    table_id: str,
    payload: ViewCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> ViewOut:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    existing_views = db.scalars(
        select(ViewModel).where(ViewModel.table_id == table_id, ViewModel.tenant_id == tenant.id)
    ).all()
    next_order = max((int((view.config_json or {}).get("order", 0)) for view in existing_views), default=-1) + 1
    config_json = payload.config.model_dump() if payload.config else dict(DEFAULT_VIEW_CONFIG)
    if "order" not in config_json:
        config_json["order"] = next_order
    if "isEnabled" not in config_json:
        config_json["isEnabled"] = True

    created = ViewModel(
        id=_next_id("viw"),
        tenant_id=tenant.id,
        table_id=table_id,
        name=payload.name,
        type=payload.type,
        config_json=config_json,
    )
    db.add(created)
    db.flush()
    db.add(
        ViewPermissionModel(
            tenant_id=tenant.id,
            view_id=created.id,
            user_id=user.id,
            can_read=True,
            can_write=True,
            created_at=now_utc_naive(),
        )
    )
    db.commit()
    db.refresh(created)
    return to_view_out(created)


@app.post("/tables/{table_id}/views/import", response_model=ImportViewBundleOut)
def import_view_bundle(
    table_id: str,
    payload: ImportViewBundleIn,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> ImportViewBundleOut:
    return _import_view_bundle_for_table(table_id, payload, request, db, user, tenant)


@app.post("/views/import", response_model=ImportViewBundleOut)
def import_view_bundle_legacy(
    payload: ImportViewBundleLegacyIn,
    request: Request,
    table_id: str | None = Query(default=None, alias="tableId"),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> ImportViewBundleOut:
    resolved_table_id = (table_id or payload.tableId or "").strip()
    if not resolved_table_id:
        raise HTTPException(status_code=400, detail="缺少 tableId")
    normalized_payload = ImportViewBundleIn(
        viewName=payload.viewName,
        viewType=payload.viewType,
        fields=payload.fields,
        records=payload.records,
    )
    return _import_view_bundle_for_table(resolved_table_id, normalized_payload, request, db, user, tenant)


def _import_view_bundle_for_table(
    table_id: str,
    payload: ImportViewBundleIn,
    request: Request,
    db: Session,
    user: UserModel,
    tenant: TenantModel,
) -> ImportViewBundleOut:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    _ensure_table_button_permission(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        button_key="can_import_records",
    )
    view_name = payload.viewName.strip()
    if not view_name:
        raise HTTPException(status_code=400, detail="视图名称不能为空")
    if not payload.fields:
        raise HTTPException(status_code=400, detail="导入视图至少需要 1 个字段")
    field_names = [item.name.strip() for item in payload.fields]
    if any(not item for item in field_names):
        raise HTTPException(status_code=400, detail="字段名称不能为空")
    if len(set(field_names)) != len(field_names):
        raise HTTPException(status_code=400, detail="字段名称不能重复")

    existing_views = db.scalars(
        select(ViewModel).where(ViewModel.table_id == table_id, ViewModel.tenant_id == tenant.id)
    ).all()
    next_order = max((int((view.config_json or {}).get("order", 0)) for view in existing_views), default=-1) + 1
    created_view = ViewModel(
        id=_next_id("viw"),
        tenant_id=tenant.id,
        table_id=table_id,
        name=view_name,
        type=payload.viewType,
        config_json={**dict(DEFAULT_VIEW_CONFIG), "order": next_order},
    )
    db.add(created_view)
    db.flush()
    db.add(
        ViewPermissionModel(
            tenant_id=tenant.id,
            view_id=created_view.id,
            user_id=user.id,
            can_read=True,
            can_write=True,
            created_at=now_utc_naive(),
        )
    )

    created_fields: list[FieldModel] = []
    field_map_by_name: dict[str, FieldModel] = {}
    for index, field in enumerate(payload.fields):
        name = field.name.strip()
        if field.type in {"singleSelect", "multiSelect"} and not field.options:
            raise HTTPException(status_code=400, detail=f"字段 {name} 为单选/多选时必须提供预设选项")
        created_field = FieldModel(
            id=_next_id("fld_dynamic"),
            tenant_id=tenant.id,
            table_id=table_id,
            name=name,
            type=field.type,
            width=field.width,
            options_json=[item.model_dump() for item in field.options] if field.options else None,
            sort_order=index,
        )
        db.add(created_field)
        created_fields.append(created_field)
        field_map_by_name[name] = created_field

    db.flush()
    fields_by_id = {item.id: item for item in created_fields}
    allowed_member_ids = _get_table_reference_member_ids(db, tenant.id, table_id)
    for row in payload.records:
        record = RecordModel(
            id=_next_id("rec"),
            tenant_id=tenant.id,
            table_id=table_id,
            created_at=now_utc_naive(),
            updated_at=now_utc_naive(),
        )
        db.add(record)
        initial_values = {
            field_map_by_name[field.name.strip()].id: row.get(field.name.strip())
            for field in payload.fields
            if field.name.strip() in field_map_by_name
        }
        upsert_record_values(db, record, fields_by_id, initial_values, allowed_member_ids)

    db.commit()
    return ImportViewBundleOut(
        viewId=created_view.id,
        viewName=created_view.name,
        fieldIds=[item.id for item in created_fields],
        recordCount=len(payload.records),
    )


@app.patch("/views/{view_id}", response_model=ViewOut)
def patch_view(
    view_id: str,
    payload: ViewPatchIn,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> ViewOut:
    view = _ensure_view_access(
        db,
        view_id=view_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    _ensure_table_access(
        db,
        table_id=view.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    if payload.name is not None:
        view.name = payload.name
    if payload.type is not None:
        view.type = payload.type
    if payload.config is not None:
        view.config_json = payload.config.model_dump()
    db.commit()
    db.refresh(view)
    return to_view_out(view)


@app.delete("/views/{view_id}", status_code=204, response_class=Response)
def delete_view(
    view_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> Response:
    view = _ensure_view_access(
        db,
        view_id=view_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    _ensure_table_access(
        db,
        table_id=view.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    view_count = db.scalar(
        select(func.count()).select_from(ViewModel).where(ViewModel.table_id == view.table_id, ViewModel.tenant_id == tenant.id)
    ) or 0
    if int(view_count) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个视图，不能删除最后一个视图")
    db.delete(view)
    db.commit()
    return Response(status_code=204)


@app.get("/tables/{table_id}/records", response_model=RecordPageOut)
def get_records(
    table_id: str,
    request: Request,
    viewId: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    pageSize: int = Query(default=100, ge=1, le=500),
    filters: str | None = Query(default=None),
    sorts: str | None = Query(default=None),
    filterLogic: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> RecordPageOut:
    query_filters = _parse_json_list(filters, "filters")
    query_sorts = _parse_json_list(sorts, "sorts")
    return _query_records(
        db=db,
        table_id=table_id,
        view_id=viewId,
        cursor=cursor,
        page_size=pageSize,
        query_filters=query_filters,
        query_sorts=query_sorts,
        query_filter_logic=filterLogic,
        request=request,
        user_id=user.id,
        tenant_id=tenant.id,
    )


@app.post("/tables/{table_id}/records/query", response_model=RecordPageOut)
def query_records(
    table_id: str,
    payload: RecordQueryIn,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> RecordPageOut:
    return _query_records(
        db=db,
        table_id=table_id,
        view_id=payload.viewId,
        cursor=payload.cursor,
        page_size=payload.pageSize,
        query_filters=payload.filters,
        query_sorts=payload.sorts,
        query_filter_logic=payload.filterLogic,
        request=request,
        user_id=user.id,
        tenant_id=tenant.id,
    )


def _query_records(
    db: Session,
    table_id: str,
    view_id: str | None,
    cursor: str | None,
    page_size: int,
    query_filters: list[dict[str, Any]] | None,
    query_sorts: list[dict[str, Any]] | None,
    query_filter_logic: str | None,
    request: Request,
    user_id: str,
    tenant_id: str,
) -> RecordPageOut:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant_id,
        user_id=user_id,
        request=request,
        access="read",
    )
    if not view_id and _get_membership_role(db, user_id, tenant_id) != "owner":
        raise HTTPException(status_code=400, detail="非 Owner 查询记录必须指定 viewId")
    view: ViewModel | None = None
    if view_id:
        view = _ensure_view_access(
            db,
            view_id=view_id,
            tenant_id=tenant_id,
            user_id=user_id,
            request=request,
            access="read",
            expected_table_id=table_id,
        )

    stmt = (
        select(RecordModel)
        .where(RecordModel.table_id == table_id, RecordModel.tenant_id == tenant_id)
        .options(joinedload(RecordModel.values))
        .order_by(RecordModel.id.asc())
    )
    records = db.scalars(stmt).unique().all()

    fields = db.scalars(select(FieldModel).where(FieldModel.table_id == table_id, FieldModel.tenant_id == tenant_id)).all()
    fields_by_id = {field.id: field for field in fields}

    view_config = view.config_json if view else {}
    effective_filters = query_filters if query_filters is not None else list(view_config.get("filters", []))
    effective_sorts = query_sorts if query_sorts is not None else list(view_config.get("sorts", []))
    effective_filter_logic = (query_filter_logic or str(view_config.get("filterLogic", "and"))).lower()
    if effective_filter_logic not in {"and", "or"}:
        raise HTTPException(status_code=400, detail="filterLogic 仅支持 and / or")
    records = apply_filters_and_sorts(records, fields_by_id, effective_filters, effective_sorts, effective_filter_logic)

    start = 0
    if cursor:
        try:
            start = int(cursor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="cursor 非法") from exc

    sliced = records[start : start + page_size]
    next_cursor: str | None = None
    if start + page_size < len(records):
        next_cursor = str(start + page_size)

    return RecordPageOut(
        items=[serialize_record(record) for record in sliced],
        nextCursor=next_cursor,
        totalCount=len(records),
    )


@app.patch("/records/{record_id}", response_model=RecordOut)
def patch_record(
    record_id: str,
    payload: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> RecordOut:
    record = _ensure_record_exists(db, record_id, tenant.id, request, user.id)
    _ensure_table_access(
        db,
        table_id=record.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    fields = db.scalars(select(FieldModel).where(FieldModel.table_id == record.table_id, FieldModel.tenant_id == tenant.id)).all()
    fields_by_id = {field.id: field for field in fields}
    allowed_member_ids = _get_table_reference_member_ids(db, tenant.id, record.table_id)
    patch = payload.get("valuesPatch", payload)
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="PATCH 请求体格式错误")
    upsert_record_values(db, record, fields_by_id, patch, allowed_member_ids)
    db.commit()
    db.refresh(record)
    return serialize_record(record)


@app.post("/tables/{table_id}/records", response_model=RecordOut)
def create_record(
    table_id: str,
    request: Request,
    payload: CreateRecordIn | dict[str, Any] | None = None,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> RecordOut:
    _ensure_table_access(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    _ensure_table_button_permission(
        db,
        table_id=table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        button_key="can_create_record",
    )
    record = RecordModel(
        id=_next_id("rec"),
        tenant_id=tenant.id,
        table_id=table_id,
        created_at=now_utc_naive(),
        updated_at=now_utc_naive(),
    )
    db.add(record)
    fields = db.scalars(select(FieldModel).where(FieldModel.table_id == table_id, FieldModel.tenant_id == tenant.id)).all()
    fields_by_id = {field.id: field for field in fields}
    allowed_member_ids = _get_table_reference_member_ids(db, tenant.id, table_id)
    if isinstance(payload, CreateRecordIn):
        initial_values = payload.initialValues
    else:
        body = payload or {}
        initial_values = body.get("initialValues", body)
    if not isinstance(initial_values, dict):
        raise HTTPException(status_code=400, detail="POST 请求体格式错误")
    upsert_record_values(db, record, fields_by_id, initial_values, allowed_member_ids)
    db.commit()
    db.refresh(record)
    return serialize_record(record)


@app.delete("/records/{record_id}", status_code=204, response_class=Response)
def delete_record(
    record_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> Response:
    record = _ensure_record_exists(db, record_id, tenant.id, request, user.id)
    _ensure_table_access(
        db,
        table_id=record.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    _ensure_table_button_permission(
        db,
        table_id=record.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        button_key="can_delete_record",
    )
    db.delete(record)
    db.commit()
    return Response(status_code=204)


@app.delete("/fields/{field_id}", status_code=204, response_class=Response)
def delete_field(
    field_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
) -> Response:
    field = _ensure_field_exists(db, field_id, tenant.id, request, user.id)
    _ensure_table_access(
        db,
        table_id=field.table_id,
        tenant_id=tenant.id,
        user_id=user.id,
        request=request,
        access="write",
    )
    views = db.scalars(select(ViewModel).where(ViewModel.table_id == field.table_id, ViewModel.tenant_id == tenant.id)).all()
    for view in views:
        config = view.config_json or {}
        hidden = [item for item in config.get("hiddenFieldIds", []) if item != field_id]
        field_order = [item for item in config.get("fieldOrderIds", []) if item != field_id]
        column_widths = dict(config.get("columnWidths", {}))
        if field_id in column_widths:
            del column_widths[field_id]
        config["hiddenFieldIds"] = hidden
        config["fieldOrderIds"] = field_order
        config["columnWidths"] = column_widths
        view.config_json = config
    db.delete(field)
    db.commit()
    return Response(status_code=204)


@app.get("/dashboards/current", response_model=DashboardOut)
def get_current_dashboard(
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> DashboardOut:
    dashboard = _get_or_create_dashboard(db, tenant.id)
    return _serialize_dashboard(dashboard)


@app.post("/dashboards/widgets", response_model=DashboardWidgetOut)
def create_dashboard_widget(
    payload: DashboardWidgetCreateIn,
    request: Request,
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> DashboardWidgetOut:
    _ensure_manage_dashboard_allowed(db, user.id, tenant.id)
    dashboard = _get_or_create_dashboard(db, tenant.id)
    if payload.tableId:
        _ensure_table_exists(db, payload.tableId, tenant.id, request, user.id)

    widget = DashboardWidgetModel(
        id=_next_id("dwd"),
        dashboard_id=dashboard.id,
        tenant_id=tenant.id,
        type=payload.type,
        title=payload.title,
        table_id=payload.tableId,
        field_ids_json=payload.fieldIds,
        aggregation=payload.aggregation,
        group_field_id=payload.groupFieldId,
        layout_json=payload.layout.model_dump(),
        config_json=payload.config,
        sort_order=payload.layout.y * 100 + payload.layout.x,
        created_at=now_utc_naive(),
    )
    db.add(widget)
    db.commit()
    db.refresh(widget)
    return _serialize_widget(widget)


@app.patch("/dashboards/widgets/{widget_id}", response_model=DashboardWidgetOut)
def update_dashboard_widget(
    widget_id: str,
    payload: DashboardWidgetPatchIn,
    request: Request,
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> DashboardWidgetOut:
    _ensure_manage_dashboard_allowed(db, user.id, tenant.id)
    widget = _ensure_dashboard_widget_exists(db, widget_id, tenant.id)
    patched_fields = payload.model_fields_set

    if "tableId" in patched_fields:
        if payload.tableId:
            _ensure_table_exists(db, payload.tableId, tenant.id, request, user.id)
        widget.table_id = payload.tableId
    if "title" in patched_fields:
        widget.title = payload.title or "未命名组件"
    if "fieldIds" in patched_fields:
        widget.field_ids_json = payload.fieldIds or []
    if "aggregation" in patched_fields and payload.aggregation:
        widget.aggregation = payload.aggregation
    if "groupFieldId" in patched_fields:
        widget.group_field_id = payload.groupFieldId
    if "layout" in patched_fields and payload.layout is not None:
        widget.layout_json = payload.layout.model_dump()
    if "config" in patched_fields:
        widget.config_json = payload.config or {}
    if "sortOrder" in patched_fields and payload.sortOrder is not None:
        widget.sort_order = payload.sortOrder

    db.commit()
    db.refresh(widget)
    return _serialize_widget(widget)


@app.delete("/dashboards/widgets/{widget_id}")
def delete_dashboard_widget(
    widget_id: str,
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    _ensure_manage_dashboard_allowed(db, user.id, tenant.id)
    widget = _ensure_dashboard_widget_exists(db, widget_id, tenant.id)
    db.delete(widget)
    db.commit()
    return {"ok": True}


@app.post("/dashboards/widgets/{widget_id}/data")
def get_dashboard_widget_data(
    widget_id: str,
    payload: WidgetDataRequest,
    request: Request,
    user: UserModel = Depends(get_current_user),
    tenant: TenantModel = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    widget = _ensure_dashboard_widget_exists(db, widget_id, tenant.id)
    if widget.table_id:
        _ensure_table_access(
            db,
            table_id=widget.table_id,
            tenant_id=tenant.id,
            user_id=user.id,
            request=request,
            access="read",
        )
    return aggregate_widget_data(
        db,
        widget,
        override_aggregation=payload.aggregation,
        override_group_field_id=payload.groupFieldId,
        limit=payload.limit,
    )


def _get_or_create_dashboard(db: Session, tenant_id: str) -> DashboardModel:
    dashboard = db.scalar(
        select(DashboardModel)
        .where(DashboardModel.tenant_id == tenant_id)
        .order_by(DashboardModel.created_at.asc())
    )
    if dashboard:
        return dashboard
    dashboard = DashboardModel(
        id=_next_id("dash"),
        tenant_id=tenant_id,
        name="首页大屏",
        created_at=now_utc_naive(),
    )
    db.add(dashboard)
    db.commit()
    db.refresh(dashboard)
    return dashboard


def _ensure_dashboard_widget_exists(db: Session, widget_id: str, tenant_id: str) -> DashboardWidgetModel:
    widget = db.scalar(
        select(DashboardWidgetModel).where(
            DashboardWidgetModel.id == widget_id,
            DashboardWidgetModel.tenant_id == tenant_id,
        )
    )
    if widget:
        return widget
    raise HTTPException(status_code=404, detail="Widget 不存在")


def _ensure_manage_dashboard_allowed(db: Session, user_id: str, tenant_id: str) -> None:
    membership = _get_membership(db, user_id, tenant_id)
    if not membership:
        raise HTTPException(status_code=403, detail="当前租户无权限")
    if membership.role == "owner" or membership.role_key == "admin":
        return
    raise HTTPException(status_code=403, detail="仅管理员可配置大屏")


def _serialize_widget(widget: DashboardWidgetModel) -> DashboardWidgetOut:
    layout = widget.layout_json or {"x": 0, "y": 0, "w": 4, "h": 3}
    config = widget.config_json or {}
    return DashboardWidgetOut(
        id=widget.id,
        type=widget.type,  # type: ignore[arg-type]
        title=widget.title,
        tableId=widget.table_id,
        fieldIds=widget.field_ids_json or [],
        aggregation=widget.aggregation,  # type: ignore[arg-type]
        groupFieldId=widget.group_field_id,
        layout=layout,
        config=config,
        sortOrder=widget.sort_order,
        createdAt=widget.created_at.isoformat(),
    )


def _serialize_dashboard(dashboard: DashboardModel) -> DashboardOut:
    sorted_widgets = sorted(dashboard.widgets, key=lambda item: (item.sort_order, item.created_at))
    return DashboardOut(
        id=dashboard.id,
        name=dashboard.name,
        widgets=[_serialize_widget(widget) for widget in sorted_widgets],
        createdAt=dashboard.created_at.isoformat(),
    )


def _next_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def _generate_temporary_password() -> str:
    # 通过高熵随机值生成一次性初始口令，避免固定默认密码。
    return secrets.token_urlsafe(12)


def _audit_cross_tenant_access(
    db: Session,
    *,
    request: Request,
    user_id: str,
    tenant_id: str,
    resource_type: str,
    resource_id: str,
) -> None:
    write_audit_log(
        db,
        action="cross_tenant_access",
        result="denied",
        request=request,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type=resource_type,
        resource_id=resource_id,
        detail="tenant_scope_violation",
    )


def _get_membership_role(db: Session, user_id: str, tenant_id: str) -> str | None:
    membership = db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == user_id,
            MembershipModel.tenant_id == tenant_id,
        )
    )
    return membership.role if membership else None


def _get_membership(db: Session, user_id: str, tenant_id: str) -> MembershipModel | None:
    return db.scalar(
        select(MembershipModel).where(
            MembershipModel.user_id == user_id,
            MembershipModel.tenant_id == tenant_id,
        )
    )


def _ensure_builtin_roles(db: Session, tenant_id: str) -> None:
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
        db.flush()


def _ensure_manage_members_allowed(db: Session, user_id: str, tenant_id: str) -> None:
    membership = _get_membership(db, user_id, tenant_id)
    if not membership:
        raise HTTPException(status_code=403, detail="当前租户无成员权限")
    if membership.role == "owner":
        return
    role = db.scalar(
        select(TenantRoleModel).where(
            TenantRoleModel.tenant_id == tenant_id,
            TenantRoleModel.key == membership.role_key,
        )
    )
    if role and role.can_manage_members:
        return
    raise HTTPException(status_code=403, detail="无成员管理权限")


def _ensure_manage_table_permissions_allowed(db: Session, user_id: str, tenant_id: str) -> None:
    membership = _get_membership(db, user_id, tenant_id)
    if not membership:
        raise HTTPException(status_code=403, detail="当前租户无权限")
    if membership.role == "owner":
        return
    role = db.scalar(
        select(TenantRoleModel).where(
            TenantRoleModel.tenant_id == tenant_id,
            TenantRoleModel.key == membership.role_key,
        )
    )
    if role and role.can_manage_permissions:
        return
    raise HTTPException(status_code=403, detail="无表格权限管理权限")


def _to_tenant_role_out(item: TenantRoleModel) -> TenantRoleOut:
    return TenantRoleOut(
        key=item.key,
        name=item.name,
        canManageMembers=item.can_manage_members,
        canManagePermissions=item.can_manage_permissions,
        defaultTableCanRead=item.default_table_can_read,
        defaultTableCanWrite=item.default_table_can_write,
    )


def _grant_permissions_by_role_defaults(db: Session, tenant_id: str, user_id: str, role: TenantRoleModel) -> None:
    table_ids = [
        item.id
        for item in db.scalars(select(TableModel).where(TableModel.tenant_id == tenant_id)).all()
    ]
    for table_id in table_ids:
        perm = db.scalar(
            select(TablePermissionModel).where(
                TablePermissionModel.tenant_id == tenant_id,
                TablePermissionModel.table_id == table_id,
                TablePermissionModel.user_id == user_id,
            )
        )
        can_read = role.default_table_can_read or role.default_table_can_write
        can_write = role.default_table_can_write
        if perm:
            perm.can_read = can_read
            perm.can_write = can_write
            continue
        db.add(
            TablePermissionModel(
                tenant_id=tenant_id,
                table_id=table_id,
                user_id=user_id,
                can_read=can_read,
                can_write=can_write,
                created_at=now_utc_naive(),
            )
        )
    view_ids = [
        item.id
        for item in db.scalars(select(ViewModel).where(ViewModel.tenant_id == tenant_id)).all()
    ]
    for view_id in view_ids:
        perm = db.scalar(
            select(ViewPermissionModel).where(
                ViewPermissionModel.tenant_id == tenant_id,
                ViewPermissionModel.view_id == view_id,
                ViewPermissionModel.user_id == user_id,
            )
        )
        can_read = role.default_table_can_read or role.default_table_can_write
        can_write = role.default_table_can_write
        if perm:
            perm.can_read = can_read
            perm.can_write = can_write
            continue
        db.add(
            ViewPermissionModel(
                tenant_id=tenant_id,
                view_id=view_id,
                user_id=user_id,
                can_read=can_read,
                can_write=can_write,
                created_at=now_utc_naive(),
            )
        )


def _ensure_table_access(
    db: Session,
    *,
    table_id: str,
    tenant_id: str,
    user_id: str,
    request: Request,
    access: str,
) -> TableModel:
    table = _ensure_table_exists(db, table_id, tenant_id, request, user_id)
    role = _get_membership_role(db, user_id, tenant_id)
    if role == "owner":
        return table

    permission = db.scalar(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant_id,
            TablePermissionModel.table_id == table_id,
            TablePermissionModel.user_id == user_id,
        )
    )
    has_access = False
    if permission:
        has_access = permission.can_write if access == "write" else (permission.can_read or permission.can_write)
    if has_access:
        return table

    write_audit_log(
        db,
        action="table_permission_denied",
        result="denied",
        request=request,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type="table",
        resource_id=table_id,
        detail=f"required={access}",
    )
    raise HTTPException(status_code=403, detail="无该表访问权限")


def _ensure_table_button_permission(
    db: Session,
    *,
    table_id: str,
    tenant_id: str,
    user_id: str,
    request: Request,
    button_key: str,
) -> None:
    role = _get_membership_role(db, user_id, tenant_id)
    if role == "owner":
        return
    permission = db.scalar(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant_id,
            TablePermissionModel.table_id == table_id,
            TablePermissionModel.user_id == user_id,
        )
    )
    if not permission:
        raise HTTPException(status_code=403, detail="缺少表格按钮权限配置")
    allowed = bool(getattr(permission, button_key, True))
    if allowed:
        return
    write_audit_log(
        db,
        action="table_button_permission_denied",
        result="denied",
        request=request,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type="table",
        resource_id=table_id,
        detail=f"button={button_key}",
    )
    raise HTTPException(status_code=403, detail="无该表按钮操作权限")


def _get_table_reference_member_ids(db: Session, tenant_id: str, table_id: str) -> set[str]:
    permissions = db.scalars(
        select(TablePermissionModel).where(
            TablePermissionModel.tenant_id == tenant_id,
            TablePermissionModel.table_id == table_id,
        )
    ).all()
    return {
        item.user_id
        for item in permissions
        if item.can_read or item.can_write
    }


def _ensure_table_exists(
    db: Session,
    table_id: str,
    tenant_id: str,
    request: Request,
    user_id: str,
) -> TableModel:
    table = db.scalar(select(TableModel).where(TableModel.id == table_id, TableModel.tenant_id == tenant_id))
    if table:
        return table
    exists_any = db.scalar(select(TableModel).where(TableModel.id == table_id))
    if exists_any:
        _audit_cross_tenant_access(
            db,
            request=request,
            user_id=user_id,
            tenant_id=tenant_id,
            resource_type="table",
            resource_id=table_id,
        )
    raise HTTPException(status_code=404, detail="数据表不存在")


def _ensure_view_exists(
    db: Session,
    view_id: str,
    tenant_id: str,
    request: Request,
    user_id: str,
    expected_table_id: str | None = None,
) -> ViewModel:
    stmt = select(ViewModel).where(ViewModel.id == view_id, ViewModel.tenant_id == tenant_id)
    if expected_table_id:
        stmt = stmt.where(ViewModel.table_id == expected_table_id)
    view = db.scalar(stmt)
    if view:
        return view
    exists_any = db.scalar(select(ViewModel).where(ViewModel.id == view_id))
    if exists_any:
        _audit_cross_tenant_access(
            db,
            request=request,
            user_id=user_id,
            tenant_id=tenant_id,
            resource_type="view",
            resource_id=view_id,
        )
    raise HTTPException(status_code=404, detail="视图不存在")


def _filter_views_for_user(
    db: Session,
    tenant_id: str,
    user_id: str,
    views: list[ViewModel],
) -> list[ViewModel]:
    role = _get_membership_role(db, user_id, tenant_id)
    if role == "owner":
        return views
    view_ids = [item.id for item in views]
    if not view_ids:
        return []
    permissions = db.scalars(
        select(ViewPermissionModel).where(
            ViewPermissionModel.tenant_id == tenant_id,
            ViewPermissionModel.user_id == user_id,
            ViewPermissionModel.view_id.in_(view_ids),
        )
    ).all()
    if not permissions:
        return []
    allowed_ids = {
        item.view_id
        for item in permissions
        if item.can_read or item.can_write
    }
    return [item for item in views if item.id in allowed_ids]


def _ensure_view_access(
    db: Session,
    *,
    view_id: str,
    tenant_id: str,
    user_id: str,
    request: Request,
    access: str,
    expected_table_id: str | None = None,
) -> ViewModel:
    view = _ensure_view_exists(db, view_id, tenant_id, request, user_id, expected_table_id=expected_table_id)
    _ensure_table_access(
        db,
        table_id=view.table_id,
        tenant_id=tenant_id,
        user_id=user_id,
        request=request,
        access="read" if access == "read" else "write",
    )
    role = _get_membership_role(db, user_id, tenant_id)
    if role == "owner":
        return view
    permission = db.scalar(
        select(ViewPermissionModel).where(
            ViewPermissionModel.tenant_id == tenant_id,
            ViewPermissionModel.view_id == view_id,
            ViewPermissionModel.user_id == user_id,
        )
    )
    if not permission:
        write_audit_log(
            db,
            action="view_permission_denied",
            result="denied",
            request=request,
            user_id=user_id,
            tenant_id=tenant_id,
            resource_type="view",
            resource_id=view_id,
            detail=f"required={access};missing_row=true",
        )
        raise HTTPException(status_code=403, detail="无该视图访问权限")
    has_access = permission.can_write if access == "write" else (permission.can_read or permission.can_write)
    if has_access:
        return view
    write_audit_log(
        db,
        action="view_permission_denied",
        result="denied",
        request=request,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type="view",
        resource_id=view_id,
        detail=f"required={access}",
    )
    raise HTTPException(status_code=403, detail="无该视图访问权限")


def _ensure_record_exists(
    db: Session,
    record_id: str,
    tenant_id: str,
    request: Request,
    user_id: str,
) -> RecordModel:
    record = db.scalar(
        select(RecordModel)
        .where(RecordModel.id == record_id, RecordModel.tenant_id == tenant_id)
        .options(joinedload(RecordModel.values))
    )
    if record:
        return record
    exists_any = db.scalar(select(RecordModel).where(RecordModel.id == record_id))
    if exists_any:
        _audit_cross_tenant_access(
            db,
            request=request,
            user_id=user_id,
            tenant_id=tenant_id,
            resource_type="record",
            resource_id=record_id,
        )
    raise HTTPException(status_code=404, detail="记录不存在")


def _ensure_field_exists(
    db: Session,
    field_id: str,
    tenant_id: str,
    request: Request,
    user_id: str,
) -> FieldModel:
    field = db.scalar(select(FieldModel).where(FieldModel.id == field_id, FieldModel.tenant_id == tenant_id))
    if field:
        return field
    exists_any = db.scalar(select(FieldModel).where(FieldModel.id == field_id))
    if exists_any:
        _audit_cross_tenant_access(
            db,
            request=request,
            user_id=user_id,
            tenant_id=tenant_id,
            resource_type="field",
            resource_id=field_id,
        )
    raise HTTPException(status_code=404, detail="字段不存在")


def _parse_json_list(raw: str | None, name: str) -> list[dict[str, Any]] | None:
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{name} 参数不是合法 JSON") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail=f"{name} 参数必须是数组")
    for item in parsed:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"{name} 数组元素必须是对象")
    return parsed
