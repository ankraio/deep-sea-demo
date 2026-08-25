import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const factsPayload = JSON.parse(await readFile(new URL("../public/facts.json", import.meta.url)));

test("facts file holds a non-empty list of facts", () => {
  assert.ok(Array.isArray(factsPayload.facts));
  assert.ok(factsPayload.facts.length >= 10);
});

test("every fact is a sentence of reasonable length", () => {
  for (const fact of factsPayload.facts) {
    assert.equal(typeof fact, "string");
    assert.ok(fact.length > 40, `too short: ${fact}`);
    assert.ok(fact.length < 300, `too long: ${fact}`);
    assert.ok(fact.endsWith("."), `missing full stop: ${fact}`);
  }
});

test("facts are unique", () => {
  const uniqueFacts = new Set(factsPayload.facts);
  assert.equal(uniqueFacts.size, factsPayload.facts.length);
});
