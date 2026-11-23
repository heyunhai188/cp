<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { request } from "../api.js";
import { session } from "../session.js";
import { LOTTERIES } from "../lottery.js";
import SectionTabs from "../components/SectionTabs.vue";

const router = useRouter();
const route = useRoute();
const PANES = [
  { id: "users", label: "账号", hash: "#users" },
  { id: "roles", label: "角色", hash: "#roles" },
  { id: "clear", label: "清理", hash: "#clear-data" },
];
function paneFromHash(hash) {
  return PANES.find((item) => item.hash === hash)?.id || "users";
}
const pane = ref(paneFromHash(route.hash));
watch(() => route.hash, (hash) => { pane.value = paneFromHash(hash); });
function showPane(id) {
  const next = PANES.find((item) => item.id === id);
  pane.value = next.id;
  if (route.hash !== next.hash) router.replace({ hash: next.hash });
}
const roles = ref([]);
const users = ref([]);
const summary = ref(null);
const roleNames = ["管理员", "查询"];
const roleType = ref("管理员");
const roleCanPlay = ref(false);
const username = ref("");
const password = ref("");
const roleId = ref("");
const searchUser = ref("");
const filterRole = ref("");
const error = ref("");
const notice = ref("");
const selectedClear = ref(null);
const clearStep = ref(0);
const clearPhrase = ref("");
const clearing = ref(false);
const clearResult = ref("");
const trimLottery = ref("fc3d");
const trimCount = ref("500");
const trimOpen = ref(false);
const trimStep = ref(0);
const trimPhrase = ref("");
const trimming = ref(false);
const trimResult = ref("");
const trimPhraseText = "删除最旧开奖";
const resetTarget = ref(null);
const resetPasswordShown = ref("");
const resetting = ref(false);

const dataGroups = [
  { id: "playOrders", title: "模拟下注订单", description: "删除所有模拟订单和订单结果，试玩余额保持不变。", phrase: "清空模拟订单", count: (data) => `${data.playOrders} 笔` },
  { id: "forecasts", title: "预测存档与核对记录", description: "删除各彩种按期保存的预测号码和开奖核对依据。当前预测算法不受影响。建议先清预测存档，再清开奖记录。", phrase: "清空预测存档", count: (data) => `${data.forecasts} 份` },
  { id: "allRules", title: "首页全部统计规则", description: "删除首页所有彩种的统计规则，包括系统预设和自定义规则。清理后规则列表为空，不会自动恢复预设规则。", phrase: "清空首页规则", count: (data) => `${data.allRules} 条` },
  { id: "customRules", title: "自定义统计规则", description: "只删除用户创建的统计规则，系统预设规则保留。只需清理自定义内容时选择此项，无需再清首页全部规则。", phrase: "清空自定义规则", count: (data) => `${data.customRules} 条` },
  { id: "playBalances", title: "模拟试玩余额", description: "把所有用户的模拟余额归零，订单记录保留。未开奖的单之后中奖仍会加奖金，撤销仍会退回下单时扣的钱，这些金额会加在清零之后的余额上。", phrase: "清空试玩余额", count: (data) => `${data.playBalances.n} 人 · ${data.playBalances.amount} 元` },
  { id: "accounts", title: "普通用户与自定义角色", description: "删除所有非超级管理员用户、他们的登录会话和模拟订单，并删除自定义角色。唯一超级管理员和内置角色会保留。", phrase: "清空普通用户和角色", count: (data) => `${data.accounts.users} 个用户 · ${data.accounts.roles} 个自定义角色 · ${data.accounts.orders} 笔关联订单` },
  { id: "draws", title: "开奖与同步历史", description: "删除三个彩种的本地开奖记录、同步日志和官网期数缓存。预测核对依赖开奖期号；建议先清预测存档。需要时可重新从官网同步。", phrase: "清空开奖记录", count: (data) => `${data.draws} 期` },
];

const trimTarget = computed(() => summary.value?.drawsByLottery?.find((item) => item.code === trimLottery.value) || null);
const trimPeriods = computed(() => {
  const number = Number(trimCount.value);
  return Number.isInteger(number) ? number : 0;
});
const trimRemaining = computed(() => Math.max(0, (trimTarget.value?.count || 0) - trimPeriods.value));
const assignableRoles = computed(() => roles.value.filter((role) => !role.canManage));
const roleTaken = (name) => roles.value.some((role) => role.name === name);
const openRoleType = computed(() => roleNames.find((name) => !roleTaken(name)) || "");
const filteredUsers = computed(() => {
  const needle = searchUser.value.trim().toLowerCase();
  return users.value.filter((user) => {
    const matchesName = !needle || user.username.toLowerCase().includes(needle);
    const matchesRole = !filterRole.value || String(user.roleId) === filterRole.value;
    return matchesName && matchesRole;
  });
});
const roleMemberCount = (roleIdValue) => users.value.filter((user) => user.roleId === roleIdValue).length;

async function load() {
  const [roleData, userData, dataSummary] = await Promise.all([
    request("/api/admin/roles"),
    request("/api/admin/users"),
    request("/api/admin/data-summary"),
  ]);
  roles.value = roleData.roles;
  users.value = userData.users;
  summary.value = dataSummary;
  if (!assignableRoles.value.some((role) => String(role.id) === String(roleId.value))) {
    roleId.value = assignableRoles.value[0] ? String(assignableRoles.value[0].id) : "";
  }
  if (roleTaken(roleType.value)) roleType.value = openRoleType.value || roleType.value;
}

async function addRole() {
  error.value = "";
  notice.value = "";
  try {
    await request("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: roleType.value, canPlay: roleCanPlay.value }),
    });
    roleCanPlay.value = false;
    notice.value = `已创建${roleType.value}角色`;
    await load();
  } catch (err) {
    error.value = err.message || "操作失败";
  }
}

async function addUser() {
  error.value = "";
  notice.value = "";
  try {
    await request("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value, roleId: Number(roleId.value) }),
    });
    const createdName = username.value.trim();
    const createdPassword = password.value;
    notice.value = `用户 ${createdName} 已创建。初始密码是 ${createdPassword}。请现在转告本人，首次登录必须修改。`;
    username.value = "";
    password.value = "";
    await load();
  } catch (err) {
    error.value = err.message || "操作失败";
  }
}

async function toggleRecommend(user) {
  error.value = "";
  try {
    const result = await request(`/api/admin/users/${user.id}/recommend`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !user.canRecommend }),
    });
    const index = users.value.findIndex((item) => item.id === user.id);
    if (index >= 0) users.value[index] = result.user;
    if (session.user?.id === user.id) session.user.canRecommend = result.user.canRecommend;
    notice.value = `${result.user.username}的专家推荐已${result.user.canRecommend ? "开启" : "关闭"}`;
  } catch (err) {
    error.value = err.message || "操作失败";
  }
}

async function togglePlay(role) {
  error.value = "";
  try {
    await request(`/api/admin/roles/${role.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canPlay: !role.canPlay }),
    });
    notice.value = `${role.name}试玩权限已${role.canPlay ? "关闭" : "开启"}`;
    await load();
  } catch (err) {
    error.value = err.message || "操作失败";
  }
}

async function removeRole(role) {
  if (!window.confirm(`确定删除“${role.name}”角色吗？${roleMemberCount(role.id) ? "该角色仍有用户，删除会被系统拒绝。" : "此操作无法撤销。"}`)) return;
  error.value = "";
  try {
    await request(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    notice.value = `已删除${role.name}角色`;
    await load();
  } catch (err) {
    error.value = err.message || "删除失败";
  }
}

async function removeUser(user) {
  if (!window.confirm(`确定删除用户“${user.username}”吗？`)) return;
  error.value = "";
  try {
    await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
    notice.value = `已删除用户 ${user.username}`;
    await load();
  } catch (err) {
    error.value = err.message || "删除失败";
  }
}

async function submitPasswordReset() {
  if (!resetTarget.value || resetting.value) return;
  resetting.value = true;
  error.value = "";
  try {
    const data = await request(`/api/admin/users/${resetTarget.value.id}/password`, { method: "PUT" });
    resetPasswordShown.value = data.user.password;
  } catch (err) {
    error.value = err.message || "重置密码失败";
  } finally {
    resetting.value = false;
  }
}

function finishPasswordReset() {
  const username = resetTarget.value?.username || "";
  resetTarget.value = null;
  resetPasswordShown.value = "";
  if (username) notice.value = `已重置 ${username} 的密码。临时密码只显示过一次，该用户需要重新登录并修改。`;
}

function closePasswordReset() {
  if (resetting.value) return;
  if (resetPasswordShown.value) finishPasswordReset();
  else resetTarget.value = null;
}

function dismissPasswordReset() {
  if (resetting.value || resetPasswordShown.value) return;
  resetTarget.value = null;
}

function beginClear(group) {
  selectedClear.value = group;
  clearStep.value = 1;
  clearPhrase.value = "";
  clearResult.value = "";
  error.value = "";
}

function closeClear() {
  if (clearing.value) return;
  selectedClear.value = null;
  clearStep.value = 0;
  clearPhrase.value = "";
}

function beginTrim() {
  error.value = "";
  trimResult.value = "";
  trimPhrase.value = "";
  trimStep.value = 1;
  trimOpen.value = true;
}

function closeTrim() {
  if (trimming.value) return;
  trimOpen.value = false;
  trimStep.value = 0;
  trimPhrase.value = "";
}

async function executeTrim() {
  if (trimPhrase.value !== trimPhraseText || trimming.value) return;
  trimming.value = true;
  error.value = "";
  try {
    const result = await request("/api/admin/draws-trim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lottery: trimLottery.value, count: trimPeriods.value, confirmation: trimPhrase.value }),
    });
    summary.value = result.summary;
    trimResult.value = `已删除${result.name}最旧的 ${result.removed} 期，还剩 ${result.remaining} 期。`;
    notice.value = trimResult.value;
  } catch (err) {
    error.value = err.message || "清理失败";
  } finally {
    trimming.value = false;
  }
}

async function executeClear() {
  if (!selectedClear.value || clearPhrase.value !== selectedClear.value.phrase || clearing.value) return;
  clearing.value = true;
  error.value = "";
  try {
    const result = await request("/api/admin/data-clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: selectedClear.value.id, confirmation: clearPhrase.value }),
    });
    summary.value = result.summary;
    clearResult.value = `清理成功：已处理 ${result.affected} 条${selectedClear.value.title}数据。`;
    notice.value = clearResult.value;
  } catch (err) {
    error.value = err.message || "清理失败";
  } finally {
    clearing.value = false;
  }
}

onMounted(async () => {
  if (!session.user?.canManage) {
    router.replace("/");
    return;
  }
  try {
    await load();
  } catch (err) {
    error.value = err.message || "读取失败";
  }
});
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <p v-if="notice" class="admin-notice" role="status">{{ notice }}</p>
  <SectionTabs :tabs="PANES" :model-value="pane" @update:model-value="showPane" />
  <p class="quiet">账号、角色和清理分开。清理仍要二次确认，不能从这里直接删掉。</p>
  <RouterLink class="btn ghost small" to="/play-admin">试玩管理</RouterLink>

  <section v-if="pane === 'roles'" id="roles" class="panel admin-section">
    <div class="admin-section-head"><div><h2>角色权限</h2><p class="quiet">管理员可操作同步、统计规则和预测；查询角色默认只读。试玩权限可单独开关。</p></div><span class="admin-count">{{ roles.length }} 个角色</span></div>
    <div class="table-wrap user-table">
      <table class="data-table">
        <thead>
          <tr><th>角色</th><th>权限</th><th>用户</th><th>试玩</th><th class="wrap">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="role in roles" :key="role.id">
            <td><strong>{{ role.name }}</strong><span v-if="role.canManage" class="admin-badge">唯一超级管理员</span></td>
            <td>{{ role.canManage ? "全部管理" : role.canOperate ? "网站操作" : "只读" }}</td>
            <td>{{ roleMemberCount(role.id) }}</td>
            <td :class="role.canPlay ? 'permission-on' : 'permission-off'">{{ role.canPlay ? "可试玩" : "不可试玩" }}</td>
            <td class="wrap">
              <template v-if="!role.canManage">
                <button class="btn ghost small" type="button" @click="togglePlay(role)">{{ role.canPlay ? "关闭试玩" : "开启试玩" }}</button>
                <button v-if="!role.builtIn" class="text-btn danger-text" type="button" @click="removeRole(role)">删除</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <details class="admin-add-panel">
      <summary>创建角色</summary>
      <form class="admin-form admin-role-form" @submit.prevent="addRole">
        <label>角色类型<select v-model="roleType"><option v-for="name in roleNames" :key="name" :value="name" :disabled="roleTaken(name)">{{ name }}{{ roleTaken(name) ? "（已经有了）" : "" }}</option></select></label>
        <label class="check"><input v-model="roleCanPlay" type="checkbox" /> 允许模拟试玩</label>
        <button class="btn gold" type="submit" :disabled="!openRoleType || roleTaken(roleType)">{{ openRoleType ? `添加${roleType}角色` : "两种角色都已经有了" }}</button>
      </form>
      <p v-if="!openRoleType" class="quiet">管理员和查询都已经有了，不能再创建。</p>
      <p v-else-if="roleTaken('管理员')" class="quiet">管理员已经有了，这里会创建查询角色。</p>
      <p v-else class="quiet">每种普通角色最多创建一个，超级管理员不在此处创建。</p>
    </details>
  </section>

  <section v-if="pane === 'users'" id="users" class="panel admin-section">
    <div class="admin-section-head"><div><h2>用户账号</h2><p class="quiet">创建账号、按账号或角色筛选，并查看试玩权限和余额。</p></div><span class="admin-count">{{ users.length }} 个用户</span></div>
    <details class="admin-add-panel">
      <summary>添加用户</summary>
      <form class="admin-form admin-user-form" @submit.prevent="addUser">
        <label>登录账号<input v-model="username" autocomplete="off" minlength="3" maxlength="20" placeholder="3–20 位字母、数字或下划线" required /></label>
        <label>初始密码<input v-model="password" type="password" autocomplete="new-password" minlength="6" maxlength="64" placeholder="至少 6 位" required /></label>
        <label>分配角色<select v-model="roleId" required><option v-for="role in assignableRoles" :key="role.id" :value="String(role.id)">{{ role.name }}</option></select></label>
        <button class="btn gold" type="submit" :disabled="!roleId">创建用户</button>
      </form>
      <p class="quiet">初始密码仅作临时密码；新用户首次登录后必须修改，修改前不能进入其他页面。</p>
    </details>
    <div class="user-tools"><input v-model="searchUser" type="search" placeholder="搜索账号" aria-label="搜索账号" /><select v-model="filterRole" aria-label="按角色筛选"><option value="">全部角色</option><option v-for="role in roles" :key="role.id" :value="String(role.id)">{{ role.name }}</option></select><span class="quiet">显示 {{ filteredUsers.length }} / {{ users.length }}</span></div>
    <div class="table-wrap user-table">
      <table class="data-table">
        <thead>
          <tr><th>账号</th><th>角色</th><th>权限</th><th>试玩</th><th class="wrap">操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="!filteredUsers.length"><td colspan="5">没有符合条件的用户。</td></tr>
          <tr v-for="user in filteredUsers" :key="user.id">
            <td>
              <strong>{{ user.username }}</strong>
              <span v-if="user.id === session.user?.id" class="admin-badge">当前</span>
              <span v-if="user.mustChangePassword" class="warning-chip">待改密</span>
            </td>
            <td><span class="role-tag">{{ user.roleName }}</span></td>
            <td :class="user.canOperate ? 'permission-on' : 'permission-off'">{{ user.canOperate ? "可操作" : "只读" }}</td>
            <td :class="user.canPlay ? 'permission-on' : 'permission-off'">{{ user.canPlay ? `${user.playBalance} 元` : "无" }}<span :class="user.canRecommend ? 'permission-on' : 'permission-off'"> · {{ user.canRecommend ? "专家" : "非专家" }}</span></td>
            <td class="wrap">
              <button class="btn ghost small" type="button" @click="toggleRecommend(user)">{{ user.canRecommend ? "关闭专家" : "开启专家" }}</button>
              <template v-if="user.id !== session.user?.id && !user.canManage">
                <button class="text-btn" type="button" @click="resetTarget = user; resetPasswordShown = ''">重置密码</button>
                <button class="text-btn danger-text" type="button" @click="removeUser(user)">删除</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="pane === 'clear'" id="clear-data" class="panel admin-section clear-section">
    <div class="admin-section-head"><div><h2>分区清理数据</h2><p class="quiet">每类独立清理。保留超级管理员、用户角色和系统配置。</p></div><span class="warning-chip">不可撤销</span></div>
    <aside class="clear-order-hint"><strong>建议清理顺序</strong><p>模拟订单 → 预测存档 → 首页规则 → 试玩余额 → 普通用户与角色 → 开奖数据。若只清某一类，可直接单独操作。清理全部数据前建议先备份数据库。</p></aside>
    <article v-if="summary" class="clear-card trim-card">
      <div><h3>删除一个彩种最旧的开奖</h3><strong>保留最新开奖</strong></div>
      <p class="quiet">适合撤销「向前补历史」。只删除所选彩种最旧的 N 期，最近的号码、预测存档和试玩订单都留着。三个彩种互不影响。</p>
      <form class="admin-form" @submit.prevent="beginTrim">
        <label>彩种
          <select v-model="trimLottery">
            <option v-for="item in LOTTERIES" :key="item.code" :value="item.code">{{ item.name }} · 现有 {{ summary.drawsByLottery?.find((row) => row.code === item.code)?.count || 0 }} 期</option>
          </select>
        </label>
        <label>删除最旧
          <input v-model="trimCount" inputmode="numeric" aria-label="删除最旧的期数" />
        </label>
        <button class="btn danger-btn" type="submit" :disabled="trimPeriods < 1 || trimPeriods >= (trimTarget?.count || 0)">删除这 {{ trimPeriods || 0 }} 期</button>
      </form>
      <p class="quiet">删除后保留最新 {{ trimRemaining }} 期。期数必须小于该彩种现有期数。</p>
    </article>
    <div v-if="summary" class="clear-grid">
      <article v-for="group in dataGroups" :key="group.id" class="clear-card">
        <div><h3>{{ group.title }}</h3><strong>{{ group.count(summary) }}</strong></div>
        <p class="quiet">{{ group.description }}</p>
        <button class="btn danger-btn" type="button" @click="beginClear(group)">清理此类数据</button>
      </article>
    </div>
  </section>

  <div v-if="resetTarget" class="overlay admin-clear-overlay">
    <div class="scrim" @click="dismissPasswordReset"></div>
    <section class="modal-panel admin-clear-modal" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
      <button class="clear-modal-close" type="button" aria-label="关闭重置密码弹框" :disabled="resetting" @click="closePasswordReset">×</button>
      <p class="eyebrow">用户安全</p><h2 id="reset-password-title">重置 {{ resetTarget.username }} 的密码</h2>
      <template v-if="resetPasswordShown">
        <p class="quiet">临时密码只在这里显示一次。请现在复制转告本人，关闭后不再出现。对方要用这个密码重新登录，并立刻改成自己的密码。</p>
        <p class="clear-impact">临时密码：<strong>{{ resetPasswordShown }}</strong></p>
        <div class="modal-foot"><button class="btn gold" type="button" @click="finishPasswordReset">我已记下</button></div>
      </template>
      <template v-else>
        <p class="quiet">系统会生成一组临时密码。该用户现有登录会立刻失效，下次登录后必须修改。知道旧密码的人不能再抢先登录。</p>
        <p v-if="error" class="clear-error" role="alert">{{ error }}</p>
        <div class="modal-foot"><button class="btn ghost" type="button" :disabled="resetting" @click="resetTarget = null">取消</button><button class="btn gold" type="button" :disabled="resetting" @click="submitPasswordReset">{{ resetting ? "生成中…" : "生成临时密码" }}</button></div>
      </template>
    </section>
  </div>

  <div v-if="trimOpen" class="overlay admin-clear-overlay">
    <div class="scrim" @click="closeTrim"></div>
    <section class="modal-panel admin-clear-modal" role="dialog" aria-modal="true" aria-labelledby="trim-title">
      <p class="eyebrow">第 {{ trimStep }} / 2 步确认</p>
      <button class="clear-modal-close" type="button" aria-label="关闭清理确认弹框" :disabled="trimming" @click="closeTrim">×</button>
      <h2 id="trim-title">{{ trimResult ? "清理结果" : trimStep === 1 ? "准备删除最旧开奖" : "最后确认：删除最旧开奖" }}</h2>
      <p class="lede">删除{{ trimTarget?.name }}最旧的 {{ trimPeriods }} 期，保留最新 {{ trimRemaining }} 期。</p>
      <p v-if="trimResult" class="clear-success" role="status">{{ trimResult }}</p>
      <p v-if="error" class="clear-error" role="alert">{{ error }}</p>
      <template v-if="trimResult">
        <div class="modal-foot"><button class="btn gold" type="button" @click="closeTrim">关闭</button></div>
      </template>
      <template v-else-if="trimStep === 1">
        <p class="quiet">这些旧开奖删除后不能从本机恢复，需要时可以再从官网向前补。下一步需要输入指定确认文字。</p>
        <div class="modal-foot"><button class="btn ghost" type="button" @click="closeTrim">取消</button><button class="btn danger-btn" type="button" @click="trimStep = 2">我已核对，继续</button></div>
      </template>
      <template v-else>
        <label class="clear-confirm-label">请输入 <b>{{ trimPhraseText }}</b>
          <input v-model="trimPhrase" autocomplete="off" :placeholder="trimPhraseText" />
        </label>
        <div class="modal-foot"><button class="btn ghost" type="button" :disabled="trimming" @click="closeTrim">取消</button><button class="btn danger-btn" type="button" :disabled="trimming || trimPhrase !== trimPhraseText" @click="executeTrim">{{ trimming ? "清理中…" : "确认永久清理" }}</button></div>
      </template>
    </section>
  </div>

  <div v-if="selectedClear" class="overlay admin-clear-overlay">
    <div class="scrim" @click="closeClear"></div>
    <section class="modal-panel admin-clear-modal" role="dialog" aria-modal="true" aria-labelledby="clear-title">
      <p class="eyebrow">第 {{ clearStep }} / 2 步确认</p>
      <button class="clear-modal-close" type="button" aria-label="关闭清理确认弹框" :disabled="clearing" @click="closeClear">×</button>
      <h2 id="clear-title">{{ clearStep === 1 ? `准备清理${selectedClear.title}` : clearResult ? "清理结果" : `最后确认：${selectedClear.title}` }}</h2>
      <p class="lede">{{ selectedClear.description }}</p>
      <p class="clear-impact">当前影响：<strong>{{ selectedClear.count(summary) }}</strong></p>
      <p v-if="clearResult" class="clear-success" role="status">{{ clearResult }}</p>
      <p v-if="error" class="clear-error" role="alert">{{ error }}</p>
      <template v-if="clearResult">
        <div class="modal-foot"><button class="btn gold" type="button" @click="closeClear">关闭</button></div>
      </template>
      <template v-else-if="clearStep === 1">
        <p class="quiet">清理操作无法撤销。请先核对分类和影响范围，下一步需要输入指定确认文字。</p>
        <div class="modal-foot"><button class="btn ghost" type="button" @click="closeClear">取消</button><button class="btn danger-btn" type="button" @click="clearStep = 2">我已核对，继续</button></div>
      </template>
      <template v-else>
        <label class="clear-confirm-label">请输入 <b>{{ selectedClear.phrase }}</b>
          <input v-model="clearPhrase" autocomplete="off" :placeholder="selectedClear.phrase" />
        </label>
        <div class="modal-foot"><button class="btn ghost" type="button" :disabled="clearing" @click="closeClear">取消</button><button class="btn danger-btn" type="button" :disabled="clearing || clearPhrase !== selectedClear.phrase" @click="executeClear">{{ clearing ? "清理中…" : "确认永久清理" }}</button></div>
      </template>
    </section>
  </div>
</template>
