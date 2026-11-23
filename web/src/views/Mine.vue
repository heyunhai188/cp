<script setup>
import { ref } from "vue";
import { request } from "../api.js";
import PageHeader from "../components/PageHeader.vue";
import { session } from "../session.js";

const oldPassword = ref("");
const newPassword = ref("");
const again = ref("");
const message = ref("");
const error = ref("");
const saving = ref(false);

async function changePassword() {
  error.value = "";
  message.value = "";
  if (newPassword.value !== again.value) {
    error.value = "两次输入的新密码不一致";
    return;
  }
  saving.value = true;
  try {
    await request("/api/me/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPassword.value, newPassword: newPassword.value }),
    });
    session.user.mustChangePassword = false;
    oldPassword.value = "";
    newPassword.value = "";
    again.value = "";
    message.value = "密码已修改";
  } catch (err) {
    error.value = err.message || "修改失败";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader eyebrow="当前账号" :title="session.user?.username || ''" :lede="session.user?.roleName || ''">
    <div class="mine-permissions" aria-label="当前账号权限">
      <span>{{ session.user?.canManage ? "超级管理员" : session.user?.canOperate ? "可操作数据" : "只读查看" }}</span>
      <span>{{ session.user?.canPlay ? "可模拟试玩" : "无试玩权限" }}</span>
    </div>
  </PageHeader>
  <section v-if="session.user?.mustChangePassword" class="panel password-required" role="status">
    <strong>请先设置新密码</strong>
    <p>这是管理员提供的一次性临时密码。修改完成前，其他页面和操作暂不可用。</p>
  </section>
  <nav v-if="!session.user?.mustChangePassword && session.user?.canManage" class="mine-list">
    <RouterLink to="/manage">管理中心</RouterLink>
  </nav>
  <form class="panel" @submit.prevent="changePassword">
    <h2>{{ session.user?.mustChangePassword ? "设置新密码" : "修改密码" }}</h2>
    <p v-if="session.user?.mustChangePassword" class="quiet">新密码不能与临时密码相同。保存后即可继续使用网站。</p>
    <p v-if="error" class="banner">{{ error }}</p>
    <p v-if="message" class="quiet">{{ message }}</p>
    <label>原密码
      <input v-model="oldPassword" type="password" autocomplete="current-password" required>
    </label>
    <label>新密码
      <input v-model="newPassword" type="password" autocomplete="new-password" minlength="6" required>
    </label>
    <label>再输入一次
      <input v-model="again" type="password" autocomplete="new-password" minlength="6" required>
    </label>
    <button class="btn gold" type="submit" :disabled="saving">保存新密码</button>
  </form>
</template>
