import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("a password matches its hash and a different password does not", () => {
  const stored = hashPassword("correct-horse");
  assert.equal(verifyPassword("correct-horse", stored), true);
  assert.equal(verifyPassword("wrong-horse", stored), false);
  assert.equal(verifyPassword("correct-horse", "plain"), false);
});
