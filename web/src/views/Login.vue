<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { request } from "../api.js";
import { session } from "../session.js";

const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const captchaId = ref("");
const captchaImage = ref("");
const captchaAnswer = ref("");
const captchaRequired = ref(false);
const captchaLoading = ref(false);
const submitting = ref(false);
const error = ref("");

function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/";
  return value;
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  error.value = "";
  try {
    session.user = await request("/api/login", {
      auth: false,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value, ...(captchaRequired.value ? { captchaId: captchaId.value, captchaAnswer: captchaAnswer.value } : {}) }),
    });
    session.ready = true;
    router.replace(safeNext(route.query.next));
  } catch (err) {
    error.value = err.message || "登录失败";
    if (err.captchaRequired || err.status === 400 && captchaRequired.value) captchaRequired.value = true;
    captchaAnswer.value = "";
    if (captchaRequired.value) await refreshCaptcha();
  } finally {
    submitting.value = false;
  }
}

async function refreshCaptcha() {
  if (captchaLoading.value) return;
  captchaLoading.value = true;
  try {
    const result = await request("/api/captcha", { auth: false });
    captchaId.value = result.id;
    captchaImage.value = result.image;
  } catch (err) {
    captchaImage.value = "";
    if (!error.value) error.value = err.message || "验证码加载失败，请稍后刷新页面";
  } finally {
    captchaLoading.value = false;
  }
}

onMounted(() => {
  document.title = "登录";
});
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <p class="eyebrow">开奖统计</p>
      <h1>登录</h1>
      <p class="lede">福彩3D、排列三、排列五。</p>
      <p class="quiet">登录有效期为 12 小时，到期后需要重新登录。</p>
      <label>账号
        <input v-model="username" name="username" autocomplete="username" required />
      </label>
      <label>密码
        <input v-model="password" name="password" type="password" autocomplete="current-password" required />
      </label>
      <label v-if="captchaRequired">验证码
        <div class="captcha-row"><input v-model="captchaAnswer" name="captcha" autocomplete="off" autocapitalize="characters" maxlength="5" placeholder="输入图片中的 5 位字符" required /><button class="captcha-refresh" type="button" :disabled="captchaLoading" aria-label="刷新验证码" @click="refreshCaptcha"><img v-if="captchaImage" :src="captchaImage" alt="登录验证码，点击可刷新" /><span v-else>{{ captchaLoading ? "加载中" : "刷新图片" }}</span></button></div>
      </label>
      <button class="btn gold" type="submit" :disabled="submitting || captchaLoading || captchaRequired && !captchaId">{{ submitting ? "正在验证…" : "登录" }}</button>
      <p class="form-error">{{ error }}</p>
    </form>
  </div>
</template>
