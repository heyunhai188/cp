import { reactive } from "vue";
import { request } from "./api.js";

export const session = reactive({
  user: null,
  ready: false,
});

export async function loadSession() {
  try {
    session.user = await request("/api/me", { auth: false });
  } catch (error) {
    session.user = null;
    if (error.status !== 401) throw error;
  } finally {
    session.ready = true;
  }
  return session.user;
}

export async function logout() {
  await request("/api/logout", { method: "POST", auth: false });
  session.user = null;
}
