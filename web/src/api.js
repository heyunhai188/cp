// 页面只通过这里访问后端。登录态靠同站 cookie，不在前端存密码。
export async function request(url, options = {}) {
  const { auth = true, ...init } = options;
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && auth && !location.pathname.startsWith("/login")) {
    const next = `${location.pathname}${location.search}`;
    location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    error.captchaRequired = Boolean(data.captchaRequired);
    throw error;
  }
  return data;
}
