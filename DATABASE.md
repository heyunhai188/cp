# 数据库结构与清理说明

数据库文件默认为 `data/app.sqlite`，使用 SQLite。表结构由 `src/db.js` 的 `initDatabase()` 创建，后续版本通过 `ensure*Column()` 增加兼容字段。

## 数据表

### `draws`：各彩种开奖记录

| 字段 | 含义 |
| --- | --- |
| `lottery_code` | 彩种代码，如 `fc3d`、`pl3`、`pl5` |
| `issue` | 官方期号 |
| `draw_date` | 开奖日期 |
| `digits` | 开奖号码，逗号分隔保存，保留前导 0 |
| `extra_json` | 扩展 JSON，包含星期、销售额、来源等 |
| `updated_at` | 本地写入或更新的时间 |

主键为 `(lottery_code, issue)`；索引 `idx_draws_recent` 支持按彩种和日期读取最近开奖。`fc3d`、`pl3`、`pl5` 各只保留最新 500 期。`retainNewestDraws` 按 `draw_date`、`issue` 从旧到新删除超出的行，在每次官网同步成功后和服务启动时执行。自开3D不写这张表。

### `self_draws`：账号自己的自开3D

| 字段 | 含义 |
| --- | --- |
| `user_id` | 开奖所属账号 |
| `lottery_code` | 固定为 `self3d` |
| `issue` | 该账号自己的期号 |
| `draw_date` | 开奖日期 |
| `digits` | 开奖号码，逗号分隔 |
| `created_at` | 写入时间 |

主键为 `(user_id, lottery_code, issue)`。只在该账号于试玩页点击开奖时写入，不参与官网同步、500 期保留和预测存档。删除用户，或超级管理员清理所选用户的自开3D时，一并删除。

### `rules`：首页统计规则

字段：`id`（主键）、`lottery_code`、`name`、`definition`（规则 JSON）、`sort_order`、`created_at`、`updated_at`。索引 `idx_rules_lottery` 支持按彩种和顺序读取。清理自定义规则只删除 `sort_order <= 0` 的记录；清理首页全部规则会删除整张表中的规则记录，数据库不会自动重新种入预设规则。

### `forecasts`：逐期预测存档

字段：`id`（主键）、`lottery_code`、`based_issue`、`n`（预测窗口期数）、`k`（每位选号数）、`payload`、`created_at`。`payload` 保存综合直选、综合复式、冷热直选、热号复式和冷号复式。`(lottery_code, based_issue)` 唯一，保证一个彩种的一期只有一份预测存档。开奖核对由此表中的预测与 `draws` 的后续一期开奖计算，核对列表按开奖日期从近到远。服务启动和官网同步成功后，会为最近 15 期中缺少存档的期号补一份，且不覆盖已有行。自开3D不写这张表。

### `expert_picks`：专家推荐

字段：`id`（主键）、`user_id`、`lottery_code`、`based_issue`、`directs`、`compound`、`created_at`、`updated_at`。`(user_id, lottery_code, based_issue)` 唯一。只有 `users.can_recommend = 1` 的账号可以保存。删除用户时一并删除。

### `sync_log`：官网同步日志

字段：`id`（主键）、`lottery_code`、`mode`、`ok`、`message`、`inserted_count`、`updated_count`、`created_at`。清空开奖记录会同时清理同步日志。

### `app_meta`：应用配置与初始化标记

以 `key` 为主键，`value` 保存文本值。主要键包括：

- `seeded:<彩种>`：预设规则初始化标记。
- `remoteTotal:<彩种>`：官网总期数缓存。
- `play_deadline:<彩种>`：模拟投注截止时间。
- `scheduledSync:lastSlot`：最近执行的自动同步时间槽。
- `scheduledSync:completedDate`：三个彩种都已完成的日期。
- `scheduledSync:state:<日期>:<彩种>`：该彩种当日的自动同步结果 JSON，记录是否完成、最近尝试时间和提示。

自动同步按彩种分别记录完成状态。清空开奖记录会删掉 `remoteTotal:` 缓存，不删除常规站点配置；其他配置和标记由分区清理保留。

### `roles`：角色定义

字段：`id`（主键）、`name`（唯一名称）、`is_admin`（超级管理员角色标记）、`built_in`（内置角色标记）、`created_at`、`can_play`（模拟试玩权限）、`can_operate`（网站数据操作权限）。`can_play`、`can_operate` 是对旧库的迁移字段。唯一索引 `idx_roles_single_superadmin` 保证最多一个超级管理员角色；账号创建接口不允许把用户分配给该角色。

### `users`：用户账号与试玩余额

字段：`id`（主键）、`username`（唯一账号）、`password_hash`、`role_id`、`play_balance`（模拟余额）、`must_change_password`（是否必须修改临时密码，0/1）、`can_recommend`（是否可写专家推荐，0/1，默认 0）、`created_at`。`role_id` 逻辑关联 `roles.id`。创建用户或管理员重置密码后会把 `must_change_password` 置为 1；首次登录修改密码成功后置为 0。升级旧库时会自动添加这些字段，旧账号默认不受影响。

### `sessions`：登录会话

字段：`token`（主键）、`user_id`、`expires_at`、`created_at`。`user_id` 逻辑关联 `users.id`；会话在服务端校验，最长 12 小时。重置密码会删除该用户全部会话。用户自己修改密码时，保留当前这次登录，其他设备上的会话删除。删除用户时，一并删除该用户的会话和模拟订单。

### `play_orders`：模拟下注订单

字段：`id`（主键）、`user_id`、`lottery_code`、`based_issue`、`selection`（每个位置选号的 JSON）、`bets`（组合注数）、`stake`（扣款金额）、`multiple`、`target_issue`、`ahead`、`target_date`、`deadline_at`（下单时保存的撤销截止时间）、`cancelled_at`、`settled_at`、`prize_credited`、`prize_amount`（兑奖金额，未兑为 -1）、`created_at`。`user_id` 逻辑关联 `users.id`。官方彩种结算依赖 `draws`；`lottery_code = self3d` 的订单依赖该用户的 `self_draws`。扣款与写单在一个数据库事务中完成；余额调整不会取消订单，也不改历史盈亏。

### `user_play_prizes`：按账号覆盖的模拟单注奖金

字段：`user_id`、`lottery_code`、`prize`。主键为 `(user_id, lottery_code)`。没有记录时使用该彩种的默认定额；自开3D默认单注 1040 元。

> 当前表之间主要由应用代码维护逻辑关联，没有声明 SQLite 外键约束。删除账号、开奖或订单时应通过后台分区操作，以免留下孤立记录。

## 后台分区清理与建议顺序

清理页面会先显示影响数量；每个分区需要先确认，再输入指定短语二次确认。若打算清理多类数据，建议按以下顺序：

1. **模拟下注订单**：先删除订单，避免账号删除时一并删除关联订单而让清理范围不直观；试玩余额保留。
2. **预测存档与核对记录**：先于开奖记录清理，因为核对依赖开奖期号。
3. **首页全部统计规则**：删除所有彩种的预设和自定义规则；清理后规则为空，不会自动恢复。若只想删自定义规则，改用“自定义统计规则”，预设规则会保留。
4. **模拟试玩余额**：清零所有用户余额，保留账号和订单。
5. **普通用户与自定义角色**：删除普通用户、其会话、关联订单和自定义角色；保留唯一超级管理员及内置角色。
6. **开奖与同步历史**：最后清空官网开奖记录、同步日志和官网总期数缓存。该操作不删除 `self_draws`、预测存档，所以如需同时清预测，应先执行第 2 步。自开3D的开奖和订单在试玩运营台按用户删除，未兑奖的注会先退回余额。

各分区可独立使用，不必每次都依照完整顺序。执行前请核对确认弹框中的影响说明；不可撤销的数据建议先备份 `data/app.sqlite`。
