# AGENTS.md — Codex 强制规范

> 本文件为 OpenAI Codex 的行为约束文件，所有规则**必须严格遵守**，无例外。

---

## 一、Git Commit 规范

### 1.1 格式

每条 commit message 必须严格遵循 **Conventional Commits** 规范：

```
<type>(<scope>): <subject>

[body]

[footer]
```

### 1.2 type 类型（必填，小写）

| type       | 说明                                   |
| ---------- | -------------------------------------- |
| `feat`     | 新增功能                               |
| `fix`      | 修复 bug                               |
| `refactor` | 代码重构（既不新增功能也不修复 bug）   |
| `style`    | 代码格式调整（空格、缩进、分号等）     |
| `test`     | 新增或修改测试                         |
| `docs`     | 仅文档变更                             |
| `chore`    | 构建流程、依赖管理、工具配置等杂项变更 |
| `perf`     | 性能优化                               |
| `ci`       | CI/CD 配置变更                         |
| `revert`   | 回滚某次提交                           |

### 1.3 scope 范围（推荐填写，小写）

根据本项目模块使用以下 scope：

- `auth` — 认证 / 鉴权
- `grid` — 表格核心功能
- `field` — 字段管理
- `view` — 视图管理
- `record` — 记录管理
- `permission` — 权限系统
- `tenant` — 租户管理
- `api` — 前后端接口层
- `store` — 前端状态管理（Zustand）
- `db` — 数据库 / Schema 迁移
- `seed` — 种子数据
- `ui` — 纯界面/样式调整
- `deps` — 依赖变更
- `config` — 项目配置文件

### 1.4 subject 主题（必填）

- 使用**中文**描述，简洁明确
- 首字不大写，结尾不加句号
- 不超过 72 个字符
- 使用祈使句（"添加 xxx"，而非"添加了 xxx"）

### 1.5 body 正文（可选）

- 与 subject 之间空一行
- 说明**为什么**做此变更，以及**如何**做到的
- 每行不超过 100 个字符

### 1.6 footer 页脚（可选）

- 关联 Issue：`Closes #123` 或 `Refs #456`
- Breaking change：`BREAKING CHANGE: <说明>`

### 1.7 合法示例

```
feat(field): 新增多选字段类型支持

后端新增 multi_select 字段类型枚举值，前端表格列渲染对应标签组件。

Closes #42
```

```
fix(auth): 修复 refresh token 在 Safari 下无法写入 Cookie 的问题
```

```
refactor(store): 将 gridStore 中的字段操作拆分为独立 slice
```

```
chore(deps): 升级 antd 到 5.x
```

### 1.8 禁止写法

```
# 禁止使用无意义的 message
git commit -m "fix"
git commit -m "update"
git commit -m "wip"
git commit -m "ok"
git commit -m "test123"

# 禁止 type 使用大写或错误拼写
git commit -m "Fix: ..."
git commit -m "Feature: ..."
```

---

## 二、分支命名规范

### 2.1 格式

```
<type>/<短描述>
```

描述使用**小写字母 + 连字符**（kebab-case），不使用下划线或驼峰。

### 2.2 示例

```
feat/multi-select-field
fix/refresh-token-safari
refactor/grid-store-slice
chore/upgrade-antd-v5
docs/api-permission-guide
```

### 2.3 长期分支

| 分支名  | 用途                        |
| ------- | --------------------------- |
| `main`  | 主分支，保持可部署状态      |
| `dev`   | 集成分支，合并功能分支      |

### 2.4 禁止分支名

```
# 禁止
my-branch
temp
test123
wyyd-fix
branch1
```

---

## 三、提交行为规范

### 3.1 原子提交

- 每次提交只做**一件事**
- 不将不相关的变更混入同一个 commit
- 单次 PR 的 commit 数量建议不超过 10 个

### 3.2 不提交到版本控制的内容

以下内容**严禁**出现在 commit 中：

```
# 环境与密钥
.env
.env.local
*.key
*.pem

# 构建产物
app/dist/
backend/__pycache__/
*.pyc

# 本地开发数据库
backend/*.db
backend/*.sqlite

# 编辑器配置（非团队共享部分）
.vscode/settings.json（已在 .gitignore 中）
```

### 3.3 禁止操作

- **禁止** `git push --force` 到 `main` 或 `dev` 分支
- **禁止** `git commit --no-verify` 绕过 hook
- **禁止**直接在 `main` 分支上提交功能代码
- **禁止** `git reset --hard` 丢弃未确认的他人工作

---

## 四、Pull Request 规范

### 4.1 标题

与 commit message 格式相同：

```
feat(grid): 支持行高自定义配置
```

### 4.2 描述模板

```markdown
## 变更说明
<!-- 简要说明本次 PR 做了什么 -->

## 关联 Issue
Closes #

## 测试方式
<!-- 如何验证此变更，步骤、截图或日志 -->

## Checklist
- [ ] 代码已自测
- [ ] 无多余的 console.log / 调试代码
- [ ] 无引入新的 lint 错误
```

### 4.3 合并策略

- 使用 **Squash and Merge** 合并到 `main`，保持主分支历史整洁
- 合并前确保 CI 全部通过

---

## 五、代码审查规范

- Codex 生成的代码在提交前**必须**经过人工确认
- 不得在未审查的情况下自动合并到 `main`
- 对于涉及权限、认证、数据库 Schema 变更的 PR，需额外仔细审查

---

## 六、本项目特定规范

- **后端 Schema 变更**必须在 `backend/app/db.py` 的 `ensure_schema_upgrades()` 中添加对应迁移逻辑，禁止直接 `DROP TABLE` 或破坏性变更
- **前端状态变更**若涉及 `gridStore.ts`，必须在 commit body 中说明影响的 slice 或 action
- **API 新增接口**必须同时更新前端 `app/src/features/grid/api/index.ts` 中的对应调用方法

---

_本规范由项目维护者制定，Codex 在生成代码、提交 commit、创建分支时必须严格遵守以上所有条款。_
